/**
 * UI-0913-B (early part, before OSS-0913-B lands): D3 Applications card and
 * tab over the OSS-0913-A contract (GET/DELETE /api/v1/me/consents), the D9
 * reset-link refusal words, the G2 password_expired sign-in words and the
 * V2-002 duplicate-domain line. Started from the prep's red file
 * (_scratch/ui-0913-b-prep/tests/ui-0913-b-red.test.tsx); the Applications
 * tab is a tab of /account/settings, like Sessions, so it needs no new
 * export route.
 * SECURITY: every value is a fixture; no reset URL, token or cookie appears.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: { phase: "idle" } as unknown,
  createOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({
    mode: "idp_only",
    components: { idp: { usable: true, capabilities: { admin_reset_link: true } }, ag: null },
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
const idpFetch = vi.fn();
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: (...args: unknown[]) => idpFetch(...args),
}));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "site_admin", user: { role: "site_admin" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  usePathname: () => "/account/settings",
  useSearchParams: () => new URLSearchParams("tab=applications"),
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useActionState: () => [h.state, () => {}, false],
}));

afterEach(() => {
  idpFetch.mockReset();
  h.createOrganization.mockReset();
  h.state = { phase: "idle" };
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/idp-admin-client");
  vi.resetModules();
});

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("D9: the reset-link refusals OSS-0913-B adds read in plain words (item 3)", () => {
  it.each([
    [
      "user_not_activated",
      409,
      "This person has not activated the account yet. Send an invitation instead.",
    ],
    ["no_local_password", 409, "This person signs in with a provider and has no password here."],
    [
      "local_password_not_allowed",
      409,
      "Members of this organization can only sign in with a provider.",
    ],
    [
      "reset_link_unavailable",
      409,
      "This server cannot create reset links yet. Ask the operator to set the console address.",
    ],
  ])("%s", async (code, status, words) => {
    idpFetch.mockResolvedValueOnce(json(status, { error: code, message: "x" }));
    const { createPasswordResetLink } = await import("../lib/idp-admin-client");
    const out = await createPasswordResetLink("0198b2d0-0000-7000-8000-0000000000bb");
    expect(out).toEqual({ ok: false, status, message: words });
  });

  it("control: user_disabled keeps today's words", async () => {
    idpFetch.mockResolvedValueOnce(json(409, { error: "user_disabled" }));
    const { createPasswordResetLink } = await import("../lib/idp-admin-client");
    const out = await createPasswordResetLink("0198b2d0-0000-7000-8000-0000000000bb");
    expect(out).toEqual({
      ok: false,
      status: 409,
      message: "Enable the user before creating a reset link.",
    });
  });

  it("the link has a Done button that mounts the form afresh, dropping the link", async () => {
    h.state = { phase: "success", resetUrl: "https://ui.test/reset-link#fixture" };
    const { ResetLinkButton } = await import("../app/org-admin/users/[id]/reset-link-button");
    const html = renderToStaticMarkup(<ResetLinkButton userId="u-1" />);
    expect(html).toContain(">Done<");
    // The click itself is proven in the browser check; here: the remount key.
    expect(src("src/app/org-admin/users/[id]/reset-link-button.tsx")).toMatch(
      /<ResetLinkForm key=\{round\}[^>]*onDone=\{\(\) => setRound/
    );
  });

  it("an OSS binary lets the reset-link route through; the capability gates the button", () => {
    expect(src("export/src/edition.ts")).not.toContain("recovery\\/reset-link");
  });
});

describe("G2: an expired admin-set password reads plainly at sign-in (item 3b)", () => {
  it("login() does not turn 401 password_expired into 'Invalid credentials'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: "password_expired",
          message: "This password has expired. Ask your administrator for a new reset link.",
        }),
      })
    );
    const { login } = await import("../lib/idp-client");
    const err = (await login({ email: "m@acme.example", password: "x", remember_me: false }).catch(
      (e) => e
    )) as Error;
    expect(err.message).toBe("PASSWORD_EXPIRED");
  });
  it("the password form has words for it and never the code", () => {
    const form = src("src/components/auth/password-form.tsx");
    expect(form).toContain(
      "This password has expired. Ask your administrator for a new reset link."
    );
    expect(form).toContain('err.message === "PASSWORD_EXPIRED"');
  });
});

const LIST = {
  consents: [
    {
      client_id: "app-1",
      name: "Example App",
      scopes: ["openid", "email", "profile", "offline_access", "custom:read"],
      first_granted_at: "2026-10-01T10:00:00Z",
      last_granted_at: "2026-10-05T10:00:00Z",
    },
  ],
  access_token_lifetime_seconds: 3600,
};

describe("D3: the consent client (items 1-2)", () => {
  it("lists own consents from GET /api/v1/me/consents with the lifetime", async () => {
    idpFetch.mockResolvedValueOnce(json(200, LIST));
    const { listOwnConsents } = await import("../lib/idp-account-client");
    const out = await listOwnConsents();
    expect(idpFetch.mock.calls[0][0]).toBe("http://idp.test/api/v1/me/consents");
    expect(out).toEqual({
      ok: true,
      accessTokenLifetimeSeconds: 3600,
      consents: [
        {
          clientId: "app-1",
          name: "Example App",
          scopes: ["openid", "email", "profile", "offline_access", "custom:read"],
          firstGrantedAt: "2026-10-01T10:00:00Z",
        },
      ],
    });
  });

  it.each([
    [404, true],
    [501, true],
    [503, false],
    [500, false],
  ])("a list answer of %i is unavailable=%s (CE has no consent routes)", async (status, un) => {
    idpFetch.mockResolvedValueOnce(json(status, { error: "x" }));
    const { listOwnConsents } = await import("../lib/idp-account-client");
    expect(await listOwnConsents()).toEqual({ ok: false, status, unavailable: un });
  });

  it.each([
    [204, null, "removed"],
    [404, { error: "not_found" }, "gone"],
    [404, null, "unavailable"],
    [503, { error: "temporarily_unavailable" }, "failed"],
    [500, { error: "internal_error" }, "failed"],
  ])("DELETE answer %i %j -> %s", async (status, body, outcome) => {
    idpFetch.mockResolvedValueOnce(
      body === null ? new Response(null, { status }) : json(status, body)
    );
    const { revokeOwnConsent } = await import("../lib/idp-account-client");
    const out = await revokeOwnConsent("app/1");
    expect(idpFetch.mock.calls[0][0]).toBe("http://idp.test/api/v1/me/consents/app%2F1");
    expect((idpFetch.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    expect(out.outcome).toBe(outcome);
  });
});

describe("D3: words", () => {
  it("scope words: known scopes in plain words, unknown as sent", async () => {
    const { scopeWords } = await import("../lib/consent-words");
    expect(scopeWords(["email", "profile", "offline_access", "custom:read"])).toEqual([
      "your email address",
      "your name",
      "stay signed in",
      "custom:read",
    ]);
  });

  it.each([
    [3600, "1 hour"],
    [7200, "2 hours"],
    [900, "15 minutes"],
    [60, "1 minute"],
    [45, "45 seconds"],
  ])("lifetime %i s reads %s", async (s, words) => {
    const { lifetimeWords } = await import("../lib/consent-words");
    expect(lifetimeWords(s)).toBe(words);
  });

  it("the confirm text names the app and the lifetime from the answer", async () => {
    const { removeConfirmText } = await import("../lib/consent-words");
    expect(removeConfirmText("Example App", 900)).toBe(
      "Example App will have to ask you again next time. It may keep working for up to 15 minutes."
    );
  });
});

describe("D3: the Applications tab (item 2)", () => {
  const consent = {
    clientId: "app-1",
    name: "Example App",
    scopes: ["email", "offline_access", "custom:read"],
    firstGrantedAt: "2026-10-01T10:00:00Z",
  };

  it("a row shows the name, what the app can see and when it was allowed", async () => {
    const { ApplicationsSection } = await import("../app/account/settings/applications-section");
    const html = renderToStaticMarkup(
      <ApplicationsSection
        result={{ ok: true, consents: [consent], accessTokenLifetimeSeconds: 3600 }}
      />
    );
    expect(html).toContain("Example App");
    expect(html).toContain("Can see: your email address, stay signed in, custom:read");
    expect(html).toContain("Allowed on");
    expect(html).toContain('dateTime="2026-10-01T10:00:00.000Z"');
    expect(html).toContain(">Remove access<");
    // 44 px tap target (Button size lg is h-11).
    expect(html).toMatch(/h-11[^>]*>Remove access</);
  });

  it("no applications: says so", async () => {
    const { ApplicationsSection } = await import("../app/account/settings/applications-section");
    const html = renderToStaticMarkup(
      <ApplicationsSection result={{ ok: true, consents: [], accessTokenLifetimeSeconds: 3600 }} />
    );
    expect(html).toContain("You have not allowed any applications yet.");
  });

  it("a list error reads plainly; CE says the feature is not here", async () => {
    const { ApplicationsSection } = await import("../app/account/settings/applications-section");
    const err = renderToStaticMarkup(
      <ApplicationsSection result={{ ok: false, status: 503, unavailable: false }} />
    );
    expect(err).toContain("Your applications could not be loaded. Try again.");
    const ce = renderToStaticMarkup(
      <ApplicationsSection result={{ ok: false, status: 404, unavailable: true }} />
    );
    expect(ce).toContain("Not available on this server.");
    expect(ce).not.toContain("could not be loaded");
  });

  it("after removal the row is gone and a status line says so", async () => {
    h.state = { phase: "removed" };
    const { ApplicationRow } = await import("../app/account/settings/applications-section");
    const html = renderToStaticMarkup(<ApplicationRow consent={consent} lifetimeSeconds={3600} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Access removed for Example App.");
    expect(html).not.toContain("Can see:");
    expect(html).not.toContain(">Remove access<");
  });

  it("404 on remove: the app no longer has access, and the row is gone", async () => {
    h.state = { phase: "gone" };
    const { ApplicationRow } = await import("../app/account/settings/applications-section");
    const html = renderToStaticMarkup(<ApplicationRow consent={consent} lifetimeSeconds={3600} />);
    expect(html).toContain("This app no longer has access.");
    expect(html).not.toContain("Can see:");
  });

  it("a remove failure shows on the row, and the row stays", async () => {
    h.state = { phase: "error", error: "Access could not be removed. Try again." };
    const { ApplicationRow } = await import("../app/account/settings/applications-section");
    const html = renderToStaticMarkup(<ApplicationRow consent={consent} lifetimeSeconds={3600} />);
    expect(html).toContain("Access could not be removed. Try again.");
    expect(html).toContain("Can see:");
    expect(html).toContain(">Remove access<");
  });

  it("the action maps the DELETE outcomes and never takes a user id", async () => {
    const { removeApplicationAccessAction } = await import(
      "../app/account/settings/application-actions"
    );
    const fd = (id: string) => {
      const f = new FormData();
      f.set("client_id", id);
      return f;
    };
    idpFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await removeApplicationAccessAction({ phase: "idle" }, fd("app-1"))).toEqual({
      phase: "removed",
    });
    idpFetch.mockResolvedValueOnce(json(404, { error: "not_found" }));
    expect(await removeApplicationAccessAction({ phase: "idle" }, fd("app-1"))).toEqual({
      phase: "gone",
    });
    idpFetch.mockResolvedValueOnce(json(503, { error: "temporarily_unavailable" }));
    expect(await removeApplicationAccessAction({ phase: "idle" }, fd("app-1"))).toEqual({
      phase: "error",
      error: "Access could not be removed. Try again.",
    });
    idpFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await removeApplicationAccessAction({ phase: "idle" }, fd("app-1"))).toEqual({
      phase: "error",
      error: "Not available on this server.",
    });
    expect(await removeApplicationAccessAction({ phase: "idle" }, fd(""))).toEqual({
      phase: "error",
      error: "Access could not be removed. Try again.",
    });
    expect(idpFetch).toHaveBeenCalledTimes(4);
  });

  it("the settings page has an Applications tab; the member menu has the item", () => {
    expect(src("src/app/account/settings/page.tsx")).toContain(
      '{ label: "Applications", value: "applications" }'
    );
    expect(src("src/components/shared/member-nav.tsx")).toMatch(
      /label: "Applications", href: "\/account\/settings\?tab=applications"/
    );
  });
});

describe("D3: the Overview card (item 1)", () => {
  it("the Overview no longer says there is no Applications card", () => {
    expect(src("src/app/dashboard/page.tsx")).not.toContain("No Applications card (owner Q4 b)");
  });

  it.each([
    [0, "You have not allowed any applications yet."],
    [1, "You have allowed 1 application."],
    [3, "You have allowed 3 applications."],
  ])("%i applications", async (n, words) => {
    const { ApplicationFacts } = await import("../app/dashboard/application-facts");
    const consents = Array.from({ length: n }, (_, i) => ({
      clientId: `app-${i}`,
      name: `App ${i}`,
      scopes: [],
      firstGrantedAt: "2026-10-01T10:00:00Z",
    }));
    const html = renderToStaticMarkup(
      <ApplicationFacts result={{ ok: true, consents, accessTokenLifetimeSeconds: 3600 }} />
    );
    expect(html).toContain(words);
  });

  it("a CE server: not available; an error: the card says it could not load", async () => {
    const { ApplicationFacts } = await import("../app/dashboard/application-facts");
    expect(
      renderToStaticMarkup(
        <ApplicationFacts result={{ ok: false, status: 404, unavailable: true }} />
      )
    ).toContain("Not available on this server.");
    expect(
      renderToStaticMarkup(
        <ApplicationFacts result={{ ok: false, status: 500, unavailable: false }} />
      )
    ).toContain("We could not load this right now.");
  });

  it("the card links to the Applications tab with Review", () => {
    expect(src("src/app/dashboard/page.tsx")).toMatch(
      /title="Applications"\s+href="\/account\/settings\?tab=applications"\s+link="Review"/
    );
  });
});

describe("V2-002: a duplicate domain shows the domain line", () => {
  it("OSS answers 400 invalid request for a taken domain: the domain field says so", async () => {
    vi.doMock("@/lib/idp-admin-client", () => ({
      createOrganization: h.createOrganization,
    }));
    h.createOrganization.mockResolvedValueOnce({ ok: false, status: 400, conflict: false });
    const { createOrgAction } = await import("../app/site-admin/organizations/new/actions");
    const f = new FormData();
    f.set("name", "Acme duplicate");
    f.set("domain", "acme.example");
    const out = await createOrgAction({}, f);
    expect(out.fieldErrors?.domain).toBe(
      "This domain may already belong to another organization. Check it, or use another domain."
    );
    expect(out.error ?? "").not.toContain("The backend returned an error");
  });
});
