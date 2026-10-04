/**
 * OSS-FIN-2 (owner ruling D-018(b)): an org_admin marks its own
 * organization's confidential application first-party (skip_consent) on the
 * create and edit forms, and the detail page shows it — each with a one-line
 * warning. The IdP's refusal for a public client reads as safe copy.
 *
 * And a user created with a password before D-017 (active, unverified, no
 * invite) gets "Send invitation" on its page where the IdP mounts the invite.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

afterEach(() => vi.unstubAllGlobals());

const WARNING = "Users will not be asked to consent to this application";

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("the application forms carry First-party (skip consent)", () => {
  it("the create form offers the checkbox with its warning", async () => {
    const { CreateApplicationForm } = await import(
      "../app/org-admin/applications/new/create-application-form"
    );
    const html = renderToStaticMarkup(<CreateApplicationForm publicClients />);
    expect(html).toContain('name="skip_consent"');
    expect(html).toContain("First-party (skip consent)");
    expect(html).toContain(WARNING);
  });

  const editProps = {
    clientId: "01990000-0000-7000-8000-0000000000c1",
    initialName: "App",
    initialClientID: "cid",
    initialAuthMethod: "client_secret_basic",
    initialRedirectURIs: ["https://rp.example.test/cb"],
    initialPostLogoutRedirectURIs: [],
    initialAllowedAudiences: [],
    initialScope: "openid",
  };
  it("the edit form pre-checks it for a first-party confidential client", async () => {
    const { EditApplicationForm } = await import(
      "../app/org-admin/applications/[id]/edit/edit-application-form"
    );
    const html = renderToStaticMarkup(
      <EditApplicationForm {...editProps} initialIsPublic={false} initialSkipConsent />
    );
    expect(html).toMatch(/name="skip_consent"[^>]*checked/);
    expect(html).toContain(WARNING);
  });
  it("the edit form offers no first-party option for a public client", async () => {
    const { EditApplicationForm } = await import(
      "../app/org-admin/applications/[id]/edit/edit-application-form"
    );
    const html = renderToStaticMarkup(
      <EditApplicationForm {...editProps} initialIsPublic initialSkipConsent={false} />
    );
    expect(html).not.toContain('name="skip_consent"');
  });
});

describe("the wire helpers send and read skip_consent", () => {
  it("create sends skip_consent true and reads it back", async () => {
    const spy = stubFetch(201, {
      client: { id: "i", client_id: "c", name: "n", is_public: false, skip_consent: true },
      client_secret: "fixture-secret-not-real",
    });
    const { createOrganizationClient } = await import("@/lib/idp-admin-client");
    const r = await createOrganizationClient({
      name: "n",
      redirect_uris: ["https://rp.example.test/cb"],
      skip_consent: true,
    });
    const sent = JSON.parse(
      String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    );
    expect(sent.skip_consent).toBe(true);
    expect(r.ok && r.data.skip_consent).toBe(true);
  });
  it("create leaves skip_consent out when not asked", async () => {
    const spy = stubFetch(201, { client: { id: "i", client_id: "c", name: "n" } });
    const { createOrganizationClient } = await import("@/lib/idp-admin-client");
    await createOrganizationClient({ name: "n", redirect_uris: ["https://rp.example.test/cb"] });
    const sent = JSON.parse(
      String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    );
    expect("skip_consent" in sent).toBe(false);
  });
  it("update sends the flag either way", async () => {
    const spy = stubFetch(200, { id: "i", client_id: "c", name: "n", skip_consent: false });
    const { updateOrganizationClient } = await import("@/lib/idp-admin-client");
    const r = await updateOrganizationClient("01990000-0000-7000-8000-0000000000c1", {
      skip_consent: false,
    });
    const sent = JSON.parse(
      String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    );
    expect(sent.skip_consent).toBe(false);
    expect(r.ok && r.data.skip_consent).toBe(false);
  });
  it("the IdP's public-client refusal reads as safe copy", async () => {
    stubFetch(400, {
      error: "invalid_request",
      error_description: "skip_consent requires a confidential client",
    });
    const { createOrganizationClient, SKIP_CONSENT_PUBLIC_MESSAGE } = await import(
      "@/lib/idp-admin-client"
    );
    const r = await createOrganizationClient({
      name: "n",
      redirect_uris: ["http://127.0.0.1/cb"],
      is_public: true,
      skip_consent: true,
    });
    expect(!r.ok && r.message).toBe(SKIP_CONSENT_PUBLIC_MESSAGE);
    stubFetch(400, { error: "invalid request" });
    const other = await createOrganizationClient({ name: "n", redirect_uris: ["x"] });
    expect(!other.ok && other.message).not.toBe(SKIP_CONSENT_PUBLIC_MESSAGE);
  });
});

// D-026: turning first-party on needs the org admin's authenticator code, the
// IdP's refusals read as safe copy, and the console shows a "Skips consent"
// badge on an application that has it.
describe("D-026: first-party takes the admin's authenticator code", () => {
  it("both forms carry the code field beside the checkbox", async () => {
    const { CreateApplicationForm } = await import(
      "../app/org-admin/applications/new/create-application-form"
    );
    expect(renderToStaticMarkup(<CreateApplicationForm publicClients />)).toMatch(
      /name="mfa_code"[^>]*autoComplete="one-time-code"|autoComplete="one-time-code"[^>]*name="mfa_code"/
    );
  });

  it("create and update send mfa_code only together with skip_consent true", async () => {
    const { createOrganizationClient, updateOrganizationClient } = await import(
      "@/lib/idp-admin-client"
    );
    const sentBody = (spy: ReturnType<typeof stubFetch>) =>
      JSON.parse(String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body));

    let spy = stubFetch(201, { client: { id: "i", client_id: "c", name: "n" } });
    await createOrganizationClient({
      name: "n",
      redirect_uris: ["https://rp.example.test/cb"],
      skip_consent: true,
      mfa_code: "123456",
    });
    expect(sentBody(spy).mfa_code).toBe("123456");

    spy = stubFetch(201, { client: { id: "i", client_id: "c", name: "n" } });
    await createOrganizationClient({
      name: "n",
      redirect_uris: ["https://rp.example.test/cb"],
      mfa_code: "123456",
    });
    expect("mfa_code" in sentBody(spy)).toBe(false);

    spy = stubFetch(200, { id: "i", client_id: "c", name: "n", skip_consent: true });
    await updateOrganizationClient("01990000-0000-7000-8000-0000000000c1", {
      skip_consent: true,
      mfa_code: "654321",
    });
    expect(sentBody(spy).mfa_code).toBe("654321");

    spy = stubFetch(200, { id: "i", client_id: "c", name: "n", skip_consent: false });
    await updateOrganizationClient("01990000-0000-7000-8000-0000000000c1", {
      skip_consent: false,
      mfa_code: "654321",
    });
    expect("mfa_code" in sentBody(spy)).toBe(false);
  });

  it("the IdP's code refusals read as safe copy, on create and on update", async () => {
    const m = await import("@/lib/idp-admin-client");
    const cases: Array<[number, unknown, string]> = [
      [400, { error: "mfa_code_required" }, m.MFA_CODE_REQUIRED_MESSAGE],
      [400, { error: "mfa_not_enrolled" }, m.MFA_NOT_ENROLLED_MESSAGE],
      [403, { error: "invalid_mfa_code" }, m.MFA_CODE_INVALID_MESSAGE],
      [
        400,
        {
          error: "invalid_request",
          error_description:
            "skip_consent is not available for an app created through dynamic client registration",
        },
        m.SKIP_CONSENT_DYNAMIC_MESSAGE,
      ],
    ];
    for (const [status, body, want] of cases) {
      stubFetch(status, body);
      const created = await m.createOrganizationClient({
        name: "n",
        redirect_uris: ["https://rp.example.test/cb"],
        skip_consent: true,
        mfa_code: "123456",
      });
      expect(!created.ok && created.message).toBe(want);
      stubFetch(status, body);
      const updated = await m.updateOrganizationClient("01990000-0000-7000-8000-0000000000c1", {
        skip_consent: true,
        mfa_code: "123456",
      });
      expect(!updated.ok && updated.message).toBe(want);
    }
    // A plain 403 stays a permission message.
    stubFetch(403, { error: "forbidden" });
    const denied = await m.updateOrganizationClient("01990000-0000-7000-8000-0000000000c1", {
      name: "x",
    });
    expect(!denied.ok && denied.message).toBe(
      "You do not have permission to update this application."
    );
  });

  it("the wrong-code copy does not promise the next code will work", async () => {
    // The IdP refuses even a correct code once several wrong codes were
    // spent in 15 minutes, with the same 403 invalid_mfa_code.
    const { MFA_CODE_INVALID_MESSAGE } = await import("@/lib/idp-admin-client");
    expect(MFA_CODE_INVALID_MESSAGE).not.toMatch(/wait for the next code/i);
    expect(MFA_CODE_INVALID_MESSAGE).toMatch(/current code from your authenticator app/);
    expect(MFA_CODE_INVALID_MESSAGE).toMatch(/refused for up to 15 minutes/);
  });

  it("the application list and detail show a Skips consent badge only for such an app", async () => {
    vi.resetModules();
    const client = {
      id: "01990000-0000-7000-8000-0000000000c1",
      client_id: "cid",
      name: "App",
      is_public: false,
      skip_consent: true,
      redirect_uris: ["https://rp.example.test/cb"],
      post_logout_redirect_uris: [],
      allowed_audiences: [],
      scope: "openid",
      token_endpoint_auth_method: "client_secret_basic",
      jwks_uri: "",
      token_endpoint_auth_signing_alg: "",
      organization_id: null,
      created_at: "",
    };
    let current = client;
    vi.doMock("@/lib/server-runtime-state", () => ({
      getServerRuntimeState: async () => ({
        components: { idp: { capabilities: { org_audit: false } } },
      }),
    }));
    vi.doMock("@/lib/idp-admin-client", async (orig) => ({
      ...(await orig<object>()),
      getOrganizationClientById: async () => ({ ok: true, data: current }),
    }));
    const Page = (await import("../app/org-admin/applications/[id]/page")).default;
    const render = async () =>
      renderToStaticMarkup(await Page({ params: Promise.resolve({ id: client.id }) }));
    expect(await render()).toContain("Skips consent");
    current = { ...client, skip_consent: false };
    expect(await render()).not.toContain("Skips consent");
    vi.doUnmock("@/lib/server-runtime-state");
    vi.doUnmock("@/lib/idp-admin-client");
  });
});

describe("the detail page shows First-party (skip consent)", () => {
  it("renders Yes with the warning for a first-party client and No otherwise", async () => {
    vi.resetModules();
    const client = {
      id: "01990000-0000-7000-8000-0000000000c1",
      client_id: "cid",
      name: "App",
      is_public: false,
      skip_consent: true,
      redirect_uris: ["https://rp.example.test/cb"],
      post_logout_redirect_uris: [],
      allowed_audiences: [],
      scope: "openid",
      token_endpoint_auth_method: "client_secret_basic",
      jwks_uri: "",
      token_endpoint_auth_signing_alg: "",
      organization_id: null,
      created_at: "",
    };
    let current = client;
    vi.doMock("@/lib/server-runtime-state", () => ({
      getServerRuntimeState: async () => ({
        components: { idp: { capabilities: { org_audit: false } } },
      }),
    }));
    vi.doMock("@/lib/idp-admin-client", async (orig) => ({
      ...(await orig<object>()),
      getOrganizationClientById: async () => ({ ok: true, data: current }),
    }));
    const Page = (await import("../app/org-admin/applications/[id]/page")).default;
    let html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: client.id }) }));
    expect(html).toContain("First-party (skip consent)");
    expect(html).toContain(WARNING);
    current = { ...client, skip_consent: false };
    html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: client.id }) }));
    expect(html).toContain("First-party (skip consent)");
    expect(html).not.toContain(WARNING);
    vi.doUnmock("@/lib/server-runtime-state");
    vi.doUnmock("@/lib/idp-admin-client");
  });
});

describe("a pre-D-017 user is offered Send invitation", () => {
  const base = {
    id: "u",
    email: "old@example.test",
    role: "org_user",
    active: true,
    deleted: false,
    banned: false,
    mfa_enabled: false,
    invitation_pending: false,
  };
  it("an active unverified user gets invite-unverified where user_invite is true", async () => {
    const { deriveOrgAdminUserActions } = await import(
      "../app/org-admin/users/[id]/user-detail-actions"
    );
    const old = { ...base, email_verified: false };
    expect(
      deriveOrgAdminUserActions(old as never, 1, null, { userInvite: true }).actions
    ).toContain("invite-unverified");
    expect(deriveOrgAdminUserActions(old as never, 1, null, {}).actions).not.toContain(
      "invite-unverified"
    );
    const verified = { ...base, email_verified: true };
    expect(
      deriveOrgAdminUserActions(verified as never, 1, null, { userInvite: true }).actions
    ).not.toContain("invite-unverified");
  });
  it("the button says Send invitation", async () => {
    const { ReissueInviteButton } = await import(
      "../app/org-admin/users/[id]/reissue-invite-button"
    );
    expect(renderToStaticMarkup(<ReissueInviteButton userId="u" firstInvite />)).toContain(
      "Send invitation"
    );
    expect(renderToStaticMarkup(<ReissueInviteButton userId="u" />)).toContain(
      "Re-issue invitation"
    );
  });
});

// The IdP refuses an app scope from its own catalogue that the admin does not
// hold with 400 {"error":"invalid_scope"} (requireClientScopeWithinActor).
describe("an app scope the admin does not hold", () => {
  it("reads as its own safe copy on create and on update", async () => {
    const m = await import("@/lib/idp-admin-client");
    stubFetch(400, { error: "invalid_scope" });
    const created = await m.createOrganizationClient({
      name: "n",
      redirect_uris: ["https://rp.example.test/cb"],
      scope: "openid admin:write",
    });
    expect(!created.ok && created.invalid).toBe(true);
    expect(!created.ok && created.message).toBe(m.CLIENT_SCOPE_NOT_HELD_MESSAGE);
    stubFetch(400, { error: "invalid_scope" });
    const updated = await m.updateOrganizationClient("01990000-0000-7000-8000-0000000000c1", {
      scope: "openid admin:write",
    });
    expect(!updated.ok && updated.invalid).toBe(true);
    expect(!updated.ok && updated.message).toBe(m.CLIENT_SCOPE_NOT_HELD_MESSAGE);
    expect(m.CLIENT_REFUSAL_MESSAGES).toContain(m.CLIENT_SCOPE_NOT_HELD_MESSAGE);
    expect(m.CLIENT_SCOPE_NOT_HELD_MESSAGE).toMatch(/permission your role does not hold/);
  });

  it("any other 400 keeps the generic copy", async () => {
    const m = await import("@/lib/idp-admin-client");
    stubFetch(400, { error: "invalid_request", error_description: "invalid_scope" });
    const r = await m.createOrganizationClient({
      name: "n",
      redirect_uris: ["https://rp.example.test/cb"],
    });
    expect(!r.ok && r.message).not.toBe(m.CLIENT_SCOPE_NOT_HELD_MESSAGE);
  });
});
