/**
 * OSS-FINAL (owner ruling D-016): a site_admin re-issues a pending
 * organization admin's activation from the organization's page.
 *
 * Since OSS-RC (OSS 9538439) a VALID pending activation keeps
 * can_assign_admin false, so the only console path to
 * POST /api/v1/organizations/:id/resend-activation (assign-admin) was hidden
 * in exactly the lost-link case. "Pending" is what OSS's 409
 * activation_pending guard reads: the organization is inactive, not deleted,
 * and none of its org_admins has ever verified.
 *
 *   re-issue  POST /api/v1/organizations/:id/resend-activation
 *             → 200 {activation_token, admin_email, expires_at,
 *                    activation_url | activation_url_unavailable}
 *             | 404 not found / no org_admin | 409 organization already active
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://ui.test",
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
  toPublicConfig: () => ({
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../lib/server-session", () => ({
  getServerSession: async () => ({ role: "site_admin", user: { role: "site_admin" } }),
}));

type Answer = { status: number; body?: unknown };
let idpAnswers: Record<string, Answer> = {};
const idpFetch = vi.fn(async (url: string, init: RequestInit = {}) => {
  const key = `${(init.method ?? "GET").toUpperCase()} ${new URL(url).pathname}`;
  const a = idpAnswers[key] ?? { status: 404, body: {} };
  return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
});
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: (url: string, init?: RequestInit) => idpFetch(url, init),
}));

beforeEach(() => {
  idpAnswers = {};
  idpFetch.mockClear();
});

const ORG_ID = "0198b2d0-0000-7000-8000-0000000000cc";
const TOKEN = "b".repeat(64);
const ORG_PATH = `/api/v1/organizations/${ORG_ID}`;
const admin = (verified: boolean) => ({
  id: "0198b2d0-0000-7000-8000-0000000000dd",
  email: "boss@acme.test",
  role: "org_admin",
  mfa_enabled: false,
  email_verified: verified,
  active: true,
  deleted: false,
});
const detail = async (org: Record<string, unknown>, admins: unknown[] | null) => {
  idpAnswers[`GET ${ORG_PATH}`] = {
    status: 200,
    body: {
      id: ORG_ID,
      name: "Acme",
      domain: "acme.test",
      active: false,
      deleted: false,
      is_claimed: true,
      can_assign_admin: false,
      ...org,
    },
  };
  if (admins)
    idpAnswers[`GET ${ORG_PATH}/admin-recovery-candidates`] = { status: 200, body: { admins } };
  const Page = (await import("../app/site-admin/organizations/[id]/page")).default;
  return renderToStaticMarkup(
    (await Page({ params: Promise.resolve({ id: ORG_ID }) })) as React.ReactElement
  );
};

describe("the organization's page offers Re-issue activation link only while it is pending", () => {
  it("a pending organization (valid activation) offers it", async () => {
    expect(await detail({}, [admin(false)])).toContain("Re-issue activation link");
  });
  it("a pending organization whose activation expired offers it", async () => {
    expect(await detail({ can_assign_admin: true }, [admin(false)])).toContain(
      "Re-issue activation link"
    );
  });
  it("an active organization does not", async () => {
    expect(await detail({ active: true }, [admin(true)])).not.toContain("Re-issue activation link");
  });
  it("a deleted organization does not", async () => {
    expect(await detail({ deleted: true }, [admin(false)])).not.toContain(
      "Re-issue activation link"
    );
  });
  it("a deactivated organization whose administrator activated does not", async () => {
    expect(await detail({}, [admin(true)])).not.toContain("Re-issue activation link");
  });
  it("nothing is offered when the administrators could not be loaded", async () => {
    expect(await detail({}, null)).not.toContain("Re-issue activation link");
  });
});

describe("re-issuing through the IdP", () => {
  const issue = async (answer: Answer) => {
    idpAnswers[`POST ${ORG_PATH}/resend-activation`] = answer;
    const { reissueActivationAction } = await import(
      "../app/site-admin/organizations/[id]/reissue-activation-actions"
    );
    const f = new FormData();
    f.set("org_id", ORG_ID);
    return reissueActivationAction({ phase: "idle" }, f);
  };
  it("returns the link, the token and the expiry once", async () => {
    const state = await issue({
      status: 200,
      body: {
        activation_token: TOKEN,
        admin_email: "boss@acme.test",
        expires_at: "2026-09-30T10:00:00Z",
        activation_url: `http://ui.test/activate?token=${TOKEN}`,
      },
    });
    expect(state).toMatchObject({
      phase: "issued",
      activation: {
        adminEmail: "boss@acme.test",
        activationToken: TOKEN,
        activationUrl: `http://ui.test/activate?token=${TOKEN}`,
        expiresAt: "2026-09-30T10:00:00Z",
      },
    });
  });
  it("carries activation_url_unavailable when the IdP could not build a link", async () => {
    const state = await issue({
      status: 200,
      body: {
        activation_token: TOKEN,
        admin_email: "boss@acme.test",
        expires_at: "2026-09-30T10:00:00Z",
        activation_url_unavailable: "IDENTUUM_IDP_UI_PUBLIC_BASE_URL is not set",
      },
    });
    expect(state).toMatchObject({
      phase: "issued",
      activation: { activationUrlUnavailable: "IDENTUUM_IDP_UI_PUBLIC_BASE_URL is not set" },
    });
  });
  it("a 409 is said plainly", async () => {
    const state = await issue({ status: 409, body: { error: "organization already active" } });
    expect(state).toMatchObject({ phase: "idle" });
    expect((state as { error?: string }).error).toMatch(/already active/i);
  });
});

describe("the once-only activation panel", () => {
  const panel = async (a: Record<string, unknown>) => {
    const { ActivationIssuedPanel } = await import("../components/shared/activation-issued-panel");
    return renderToStaticMarkup(
      <ActivationIssuedPanel
        activation={{
          adminEmail: "boss@acme.test",
          activationToken: TOKEN,
          expiresAt: "2026-09-30T10:00:00Z",
          ...a,
        }}
      />
    );
  };
  it("shows the link with Copy, the raw token underneath and the expiry", async () => {
    const html = await panel({ activationUrl: `http://ui.test/activate?token=${TOKEN}` });
    expect(html).toContain(`value="http://ui.test/activate?token=${TOKEN}"`);
    expect(html).toContain("Copy");
    expect(html.indexOf(TOKEN, html.indexOf("value=") + 80)).toBeGreaterThan(0);
    expect(html).toContain('dateTime="2026-09-30T10:00:00.000Z"');
    expect(html).toMatch(/earlier link stops working/i);
    expect(html).toMatch(/not be shown again/i);
  });
  it("shows the server's reason when there is no link, and still the token", async () => {
    const html = await panel({
      activationUrlUnavailable: "IDENTUUM_IDP_UI_PUBLIC_BASE_URL is not set",
    });
    expect(html).toContain("IDENTUUM_IDP_UI_PUBLIC_BASE_URL is not set");
    expect(html).not.toContain("/activate?token=");
    expect(html).toContain(TOKEN);
  });
});

describe("the console says what D-016 says", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8").replace(/\s+/g, " ");
  it("Reactivate's 409 points to Re-issue activation link", async () => {
    idpAnswers[`PUT ${ORG_PATH}`] = { status: 409, body: { error: "activation_pending" } };
    const { reactivateOrgAction } = await import(
      "../app/site-admin/organizations/[id]/reactivate/actions"
    );
    const f = new FormData();
    f.set("org_id", ORG_ID);
    const state = await reactivateOrgAction({}, f);
    expect(state.error).toContain("Re-issue activation link");
  });
  for (const [file, stale] of [
    [
      "app/site-admin/organizations/[id]/assign-admin/form-client.tsx",
      "the activation email is re-sent",
    ],
    [
      "app/site-admin/organizations/[id]/assign-admin/form-client.tsx",
      "the activation email was re-sent",
    ],
    ["lib/idp-admin-client.ts", "sends an activation email"],
    ["app/activate/page.tsx", "Check your email for the activation message"],
    ["app/claim/page.tsx", "Check your email for an invitation"],
  ] as const) {
    it(`${file} no longer says "${stale}"`, () => {
      expect(src(file)).not.toContain(stale);
    });
  }
});
