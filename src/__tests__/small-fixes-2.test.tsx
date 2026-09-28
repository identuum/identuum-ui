/**
 * SMALL-FIXES-2 (identuum-ui): four client reads that disagreed with what the
 * IdPs return, measured against identuum-idp-oss internal/handlers:
 *
 * 5. POST /api/v1/clients/:id/secret/regenerate answers
 *    {"client": safeClient, "client_secret"} (clients.go
 *    HandleRegenerateClientSecret; identuum-idp-ce the same, CE-UI-3b), so
 *    id, client_id and name are read from the nested client.
 * 6. POST /api/v1/service-accounts/:id/disable|enable answers 204 with no
 *    body (service_accounts.go HandleSetActiveServiceAccount); the unlink
 *    PUT /api/v1/clients/:id answers safeClient (id, client_id, name,
 *    is_public, organization_id, service_account_id, scope, redirect_uris,
 *    …, created_at, updated_at) — no previously_linked_* and no active, and
 *    the client list rows are the same safeClient.
 * 7. identuum-idp-ce's resend-activation names admin_email_unavailable when
 *    the re-issued claim is bound to no email; the success panel says so
 *    instead of "issued for , the pending administrator".
 * 8. The sign-in TOTP step answers a 429 with a rate-limit message, not
 *    "Invalid verification code".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let reply: () => Response = () => new Response(null, { status: 500 });
const calls: Array<{ url: string; method: string }> = [];
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: (init.method ?? "GET").toUpperCase() });
    return reply();
  }),
}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://ui.test",
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

afterEach(() => {
  calls.length = 0;
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SAFE_CLIENT = {
  id: "0190f000-0000-7000-8000-00000000c11e",
  client_id: "cid-live",
  name: "Live App",
  is_public: false,
  organization_id: "0190f000-0000-7000-8000-0000000000a1",
  scope: "openid",
  redirect_uris: ["https://rp.example.test/cb"],
  created_at: "2026-09-28T10:00:00Z",
  updated_at: "2026-09-28T10:00:00Z",
};
const SA = "0190f000-0000-7000-8000-0000000005a1";

describe("5. rotateOrganizationClientSecret reads the nested client", () => {
  it("fills id, client_id and name from {client, client_secret}", async () => {
    reply = () => json(200, { client: SAFE_CLIENT, client_secret: "s3cret-once" });
    const { rotateOrganizationClientSecret } = await import("../lib/idp-admin-client");
    const r = await rotateOrganizationClientSecret(SAFE_CLIENT.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      id: SAFE_CLIENT.id,
      client_id: "cid-live",
      name: "Live App",
      client_secret: "s3cret-once",
    });
  });
});

describe("6. service-account client reads take what the IdP returns", () => {
  it("disable accepts OSS's 204: ok, inactive, the account asked about", async () => {
    reply = () => new Response(null, { status: 204 });
    const { disableServiceAccount, enableServiceAccount } = await import("../lib/idp-admin-client");
    const d = await disableServiceAccount("org-1", SA);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.data.active).toBe(false);
      expect(d.data.service_account_id).toBe(SA);
    }
    const e = await enableServiceAccount("org-1", SA);
    expect(e.ok).toBe(true);
    if (e.ok) expect(e.data.active).toBe(true);
  });

  it("unlink reads the safeClient the PUT returns", async () => {
    reply = () => json(200, SAFE_CLIENT);
    const { unlinkServiceAccountFromOAuthClient } = await import("../lib/idp-admin-client");
    const r = await unlinkServiceAccountFromOAuthClient("org-1", SA, SAFE_CLIENT.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      organization_id: SAFE_CLIENT.organization_id,
      service_account_id: SA,
      previously_linked_oauth_client_uuid: SAFE_CLIENT.id,
      previously_linked_oauth_client_identifier: "cid-live",
    });
  });

  it("the linked-clients list carries no active flag no IdP sends, and the card shows none", async () => {
    reply = () =>
      json(200, {
        clients: [
          { ...SAFE_CLIENT, service_account_id: SA },
          {
            ...SAFE_CLIENT,
            id: "other",
            service_account_id: "0190f000-0000-7000-8000-0000000005a2",
          },
        ],
      });
    const { listServiceAccountOAuthClients } = await import("../lib/idp-admin-client");
    const r = await listServiceAccountOAuthClients("org-1", SA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.oauth_clients).toHaveLength(1);
    expect(r.oauth_clients[0]).not.toHaveProperty("active");
    const card = readFileSync(
      resolve(
        __dirname,
        "..",
        "app",
        "org-admin",
        "service-accounts",
        "[id]",
        "link-to-oauth-client-card.tsx"
      ),
      "utf-8"
    );
    expect(card).not.toContain("client.active");
  });
});

describe("7. the assign-admin panel names an unbound invitation", () => {
  it("assignOrgAdmin carries admin_email_unavailable", async () => {
    reply = () =>
      json(200, {
        success: true,
        activation_token: "t",
        expires_at: "2026-09-30T10:00:00Z",
        admin_email_unavailable: "bound to no email",
      });
    const { assignOrgAdmin } = await import("../lib/idp-admin-client");
    const r = await assignOrgAdmin({ orgId: SAFE_CLIENT.organization_id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.adminEmail).toBe("");
      expect(r.adminEmailUnavailable).toBe("bound to no email");
    }
  });

  it("the success panel shows the reason, not an empty recipient", async () => {
    const { SuccessPanel } = await import(
      "../app/site-admin/organizations/[id]/assign-admin/form-client"
    );
    const html = renderToStaticMarkup(
      <SuccessPanel
        orgName="Acme"
        success={{
          orgId: "o",
          adminEmail: "",
          adminEmailUnavailable: "bound to no email",
          activationToken: "t",
          expiresAt: "2026-09-30T10:00:00Z",
        }}
      />
    );
    expect(html).toContain("bound to no email");
    expect(html).not.toMatch(/issued for\s*<span[^>]*><\/span>/);
  });
});

describe("8. the TOTP step names a rate limit", () => {
  it("429 is a rate-limit message; other failures stay the code message", async () => {
    const { mfaLoginErrorMessage } = await import("../components/auth/mfa-form");
    const { ApiError } = await import("../lib/ui-api");
    expect(mfaLoginErrorMessage(new ApiError(429, "Invalid verification code"))).toMatch(
      /too many attempts/i
    );
    expect(mfaLoginErrorMessage(new ApiError(401, "Invalid verification code"))).toBe(
      "Invalid verification code. Try again."
    );
  });
});
