/**
 * CE-UI-2a: two account-settings faults the OSS dev loop showed.
 *
 * 1. /account/settings?tab=sessions read "Could not load sessions" for a
 *    site_admin. The IdP answers GET /api/v1/sessions 403 for site_admin by
 *    design (identuum-idp-oss internal/handlers/sessions.go
 *    HandleListOwnSessions), and the page treated that 403 as a failure.
 *    It now shows the administrator notice e2e/account-settings.spec.ts
 *    documents.
 * 2. getOwnProfile read `data.user`, but GET /api/v1/profile answers the
 *    user object at the top level on both editions (identuum-idp-oss
 *    HandleGetProfile; CE api_v1_account_handlers.go). So the profile tab
 *    always rendered empty, and saving it sent "" — which clears — for every
 *    field.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const profileBody = {
  id: "0198b2d0-0000-7000-8000-0000000000aa",
  email: "ada@example.test",
  name: "Ada Lovelace",
  role: "org_admin",
  organization_name: "Analytical",
  mfa_enabled: true,
  email_verified: true,
  given_name: "Ada",
  website: "https://ada.example",
  phone_number: "+905551112233",
};
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: vi.fn(async () => new Response(JSON.stringify(profileBody), { status: 200 })),
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

describe("the sessions tab for an account the IdP refuses (403)", () => {
  it("renders the administrator notice, not the load error", async () => {
    const { SessionsSection } = await import("../app/account/settings/sessions-section");
    const html = renderToStaticMarkup(
      <SessionsSection sessions={[]} unavailable={false} error={false} forbidden />
    );
    expect(html).toContain("Session management is not available for administrator accounts");
    expect(html).not.toContain("Could not load sessions");
  });
});

describe("the claim page never leaks its token in a Referer", () => {
  it("declares Referrer-Policy no-referrer", async () => {
    vi.doMock("../app/claim/actions", () => ({ validateClaimToken: vi.fn() }));
    const { metadata } = await import("../app/claim/page");
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("getOwnProfile reads GET /api/v1/profile's top-level user", () => {
  it("returns the saved name and profile fields", async () => {
    const { getOwnProfile } = await import("../lib/idp-admin-client");
    const p = await getOwnProfile();
    expect(p).not.toBeNull();
    expect(p).toMatchObject({
      email: "ada@example.test",
      name: "Ada Lovelace",
      role: "org_admin",
      organization_name: "Analytical",
      mfa_enabled: true,
      given_name: "Ada",
      website: "https://ada.example",
      phone_number: "+905551112233",
      family_name: null,
    });
  });
});
