import { afterEach, describe, expect, it, vi } from "vitest";
import { installExport, OSS_COMPONENT, type Routes } from "./harness";
import { ORG, page, SITE_ORG, siteAnswers, sitePage } from "./recorded";

// CE-UI-5a: on identuum-idp-ce, which serves neither organization claim links
// (D-022) nor self-registration (D-021), the console offers neither — no
// button, no section, no page that calls a route CE does not mount. CE says so
// with capabilities.claim_links and capabilities.self_registration false; a
// binary that reports neither key (identuum-idp-oss v0.9.0) keeps both.

afterEach(() => vi.unstubAllGlobals());

const component = (extra: Record<string, boolean>) => ({
  "GET /api/v1/component": {
    json: { ...OSS_COMPONENT, capabilities: { ...OSS_COMPONENT.capabilities, ...extra } },
  },
});
const CE = component({ claim_links: false, self_registration: false });
const called = (calls: Array<{ path: string }>, re: RegExp) => calls.filter((c) => re.test(c.path));

describe("claim links", () => {
  const ORG_PATH = `/api/v1/organizations/${SITE_ORG}`;
  const recordedOrg = (siteAnswers[`GET ${ORG_PATH}`] as { json: Record<string, unknown> }).json;
  // An active organization without an administrator: the claim's own state.
  const unclaimed: Routes = {
    [`GET ${ORG_PATH}`]: {
      json: { ...recordedOrg, active: true, is_claimed: false, can_assign_admin: false },
    },
  };

  it("an IdP that reports no key keeps Issue claim link", async () => {
    const { html } = await sitePage(`/site-admin/organizations/${SITE_ORG}`, unclaimed);
    expect(html).toContain("Issue claim link");
  });

  it("claim_links false hides it", async () => {
    const { html } = await sitePage(`/site-admin/organizations/${SITE_ORG}`, {
      ...unclaimed,
      ...CE,
    });
    expect(html).not.toContain("Issue claim link");
    expect(html).not.toContain("claim link");
  });
});

describe("self-registration", () => {
  const REG = `GET /api/v1/organizations/${ORG}/registration`;
  const SIGNUP =
    /\/api\/v1\/(settings\/self-registration|auth\/register\/|organizations\/[^/]+\/registrations?$)/;

  it("site Settings: no switch, and the switch is never asked for", async () => {
    const { html, env } = await sitePage("/site-admin/settings", {
      "GET /api/v1/settings/self-registration": { json: { enabled: false } },
      ...CE,
    });
    expect(html).not.toContain('data-testid="instance-self-registration"');
    expect(called(env.calls, SIGNUP)).toEqual([]);
  });

  it("site Settings without the key keeps the switch", async () => {
    const { html } = await sitePage("/site-admin/settings", {
      "GET /api/v1/settings/self-registration": { json: { enabled: false } },
    });
    expect(html).toContain('data-testid="instance-self-registration"');
  });

  it("organization settings: no section, nothing asked", async () => {
    const { html, env } = await page("/org-admin/settings", { [REG]: { json: {} }, ...CE });
    expect(html).not.toContain('data-testid="org-self-registration"');
    expect(called(env.calls, SIGNUP)).toEqual([]);
  });

  it("users: no pending list, nothing asked", async () => {
    const { html, env } = await page("/org-admin/users", CE);
    expect(html).not.toContain('data-testid="pending-registrations"');
    expect(called(env.calls, SIGNUP)).toEqual([]);
  });

  it("the public sign-up page reads not available and asks nothing", async () => {
    const env = installExport("/register/acme", {
      "GET /api/v1/auth/register/acme": { json: { open: true } },
      ...CE,
    });
    const { html } = await env.render();
    expect(html).toContain("Sign-up is not available");
    expect(html).not.toContain('data-testid="register-form"');
    expect(called(env.calls, SIGNUP)).toEqual([]);
  });

  it("the public sign-up page without the key asks the IdP", async () => {
    const env = installExport("/register/acme", {
      "GET /api/v1/auth/register/acme": { json: { open: true } },
    });
    const { html } = await env.render();
    expect(html).toContain('data-testid="register-form"');
  });
});

describe("the CE-hidden surfaces already gated (service accounts, public clients, API resources, scope templates)", () => {
  const ceFalse = component({
    service_accounts: false,
    public_clients: false,
    api_resources: false,
    scope_templates: false,
    claim_links: false,
    self_registration: false,
  });

  it("the org_admin navigation links none of them", async () => {
    const { html } = await page("/org-admin", ceFalse);
    for (const href of [
      "/org-admin/service-accounts",
      "/org-admin/api-resources",
      "/org-admin/scope-templates",
    ]) {
      expect(html, href).not.toContain(`href="${href}"`);
    }
  });

  it("the application form offers no public-client choice", async () => {
    const { html } = await page("/org-admin/applications/new", ceFalse);
    expect(html.toLowerCase()).not.toContain("public client");
  });

  it("organization settings: no scope-templates section and no self-registration wording", async () => {
    const { html, env } = await page("/org-admin/settings", ceFalse);
    expect(html).not.toContain("Scope templates");
    expect(html.toLowerCase()).not.toContain("self-registration");
    expect(called(env.calls, /scope-templates/)).toEqual([]);
  });

  it("organization settings without the keys keep the domains card's self-registration wording", async () => {
    const { html } = await page("/org-admin/settings", {});
    expect(html).toContain("Verified domains gate self-registration");
  });
});
