/**
 * OSS-CLAIM-UI (D-022): a site_admin issues an organization claim link from
 * the organization's page.
 *
 *   POST /api/v1/organizations/:id/claim {email?}   (identuum-idp-oss d5bdc00)
 *     201 {claim_url, expires_at, email_bound}
 *     409 {"error":"organization_not_claimable"} | {"error":"claim_url_unavailable"}
 *     403 not a site_admin · 404 unknown organization
 *
 * Offered only while the organization is active, not deleted and has no
 * administrator (the IdP counts a pending, invited admin as one). The link is
 * shown once from the action's in-memory state; nothing stores or logs it.
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

const ORG_ID = "0198b2d0-0000-7000-8000-0000000000ee";
const ORG_PATH = `/api/v1/organizations/${ORG_ID}`;
const CLAIM_PATH = `POST ${ORG_PATH}/claim`;
const LINK = `http://ui.test/claim?token=${"c".repeat(64)}`;

const page = async (org: Record<string, unknown>) => {
  idpAnswers[`GET ${ORG_PATH}`] = {
    status: 200,
    body: {
      id: ORG_ID,
      name: "Shell",
      domain: "shell.test",
      active: true,
      is_claimed: false,
      ...org,
    },
  };
  const Page = (await import("../app/site-admin/organizations/[id]/page")).default;
  return renderToStaticMarkup(
    (await Page({ params: Promise.resolve({ id: ORG_ID }) })) as React.ReactElement
  );
};

describe("item 1: offered only for an active, not deleted organization with no admin", () => {
  it("is offered for an active organization with no admin", async () => {
    expect(await page({})).toContain("Issue claim link");
  });
  it.each([
    ["an admin (or a pending, invited one)", { is_claimed: true }],
    ["an inactive organization", { active: false }],
    ["a deleted organization", { deleted: true }],
    ["unknown admin state", { is_claimed: undefined }],
  ])("is hidden for %s", async (_label, org) => {
    expect(await page(org)).not.toContain("Issue claim link");
  });
});

const issue = async (body: Record<string, string>) => {
  const { issueClaimAction } = await import(
    "../app/site-admin/organizations/[id]/issue-claim-actions"
  );
  const fd = new FormData();
  fd.set("org_id", ORG_ID);
  for (const [k, v] of Object.entries(body)) fd.set(k, v);
  return issueClaimAction({ phase: "idle" }, fd);
};

describe("item 2: the issue", () => {
  it("returns the link once, its expiry and whether it is bound, and sends the email", async () => {
    idpAnswers[CLAIM_PATH] = {
      status: 201,
      body: { claim_url: LINK, expires_at: "2026-10-03T12:00:00Z", email_bound: true },
    };
    const s = await issue({ email: " owner@shell.test " });
    expect(s).toEqual({
      phase: "issued",
      claim: { claimUrl: LINK, expiresAt: "2026-10-03T12:00:00Z", emailBound: true },
    });
    const init = idpFetch.mock.calls.find((c) => String(c[0]).endsWith("/claim"))?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ email: "owner@shell.test" });
  });

  it("an empty email sends none; a malformed one is refused before the IdP", async () => {
    idpAnswers[CLAIM_PATH] = {
      status: 201,
      body: { claim_url: LINK, expires_at: "2026-10-03T12:00:00Z", email_bound: false },
    };
    await issue({ email: "" });
    const init = idpFetch.mock.calls.find((c) => String(c[0]).endsWith("/claim"))?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({});
    idpFetch.mockClear();
    const bad = await issue({ email: "not-an-email" });
    expect(bad.phase).toBe("idle");
    expect(idpFetch).not.toHaveBeenCalled();
  });

  it("shows the link with Copy and its expiry, says it is shown once", async () => {
    const { IssuedClaimPanel } = await import(
      "../app/site-admin/organizations/[id]/issue-claim-button"
    );
    const html = renderToStaticMarkup(
      <IssuedClaimPanel
        claim={{ claimUrl: LINK, expiresAt: "2026-10-03T12:00:00Z", emailBound: true }}
      />
    );
    expect(html).toContain(LINK);
    expect(html).toContain("Copy");
    expect(html).toMatch(/dateTime="2026-10-03T12:00:00(\.000)?Z"/);
    expect(html).toMatch(/not be shown again/);
    expect(html).toMatch(/bound to the email/);
  });

  it("the form says what an email does; a second issue warns that the earlier link stops working", async () => {
    const { ClaimIssueForm } = await import(
      "../app/site-admin/organizations/[id]/issue-claim-button"
    );
    const first = renderToStaticMarkup(
      <ClaimIssueForm orgId={ORG_ID} reissue={false} pending={false} action={() => {}} />
    );
    expect(first).toMatch(/bound to it/);
    expect(first).toMatch(/mailed only when email delivery is configured/);
    const again = renderToStaticMarkup(
      <ClaimIssueForm orgId={ORG_ID} reissue pending={false} action={() => {}} />
    );
    expect(again).toMatch(/link issued before stops working/);
  });

  it("the ui never stores or logs the link", () => {
    for (const f of ["issue-claim-button.tsx", "issue-claim-actions.ts"]) {
      const src = readFileSync(
        resolve(__dirname, "..", "app", "site-admin", "organizations", "[id]", f),
        "utf8"
      );
      expect(src, f).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie/);
    }
  });
});

describe("item 3: each refusal says what is wrong", () => {
  it.each([
    [409, { error: "organization_not_claimable" }, /already has an administrator/],
    [409, { error: "claim_url_unavailable" }, /IDENTUUM_IDP_UI_PUBLIC_BASE_URL/],
    [500, {}, /Could not issue the claim link/],
    [404, {}, /Could not issue the claim link/],
  ])("%i %j", async (status, body, message) => {
    idpAnswers[CLAIM_PATH] = { status, body };
    const s = await issue({});
    expect(s.phase).toBe("idle");
    expect(s.phase === "idle" && s.error).toMatch(message);
  });

  it("the error is announced as role=alert", () => {
    const src = readFileSync(
      resolve(
        __dirname,
        "..",
        "app",
        "site-admin",
        "organizations",
        "[id]",
        "issue-claim-button.tsx"
      ),
      "utf8"
    );
    const block = src.slice(src.indexOf("state.error && ("), src.indexOf("{state.error}"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('role="alert"');
  });
});
