/**
 * UI-0913-A (early part, before the OSS contract lands): the writer's own
 * red-first tests for what the prepared tests (ui-0913-a-*.test.ts*) do not
 * cover: the D2 policy panel and its action, the D4 conflict banner and its
 * action, Q7 per role, U3, U9, O20 and UI-0913-C-REVIEW F1/F2.
 * SECURITY: every value is a fixture; no token, cookie or secret appears.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: { phase: "idle" } as unknown,
  role: "org_admin",
  profile: null as unknown,
  mailCeremonies: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
}));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true, public_base_url: "https://idp.example" } }),
  idpBaseUrl: () => "http://idp.test",
}));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: h.role, user: { role: h.role } }),
}));
vi.mock("@/lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({
    mode: "idp_only",
    components: { idp: { usable: true, capabilities: { webauthn: true } }, ag: null },
  }),
}));
vi.mock("@/lib/mail-capabilities", async (orig) => ({
  ...(await orig<object>()),
  mailCeremoniesAvailable: async () => h.mailCeremonies,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/account/settings",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useActionState: () => [h.state, () => {}, false],
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  h.state = { phase: "idle" };
  h.role = "org_admin";
  h.profile = null;
  h.mailCeremonies = true;
});

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

type Call = { url: string; method: string; body: string };

/** fetch: the own-organization read, then the given answer to the write. */
function stubIdp(write: [number, unknown]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method, body: String(init?.body ?? "") });
      if (method === "GET") {
        return new Response(
          JSON.stringify({ organization: { id: "org-1", auth_policy: "mixed" } }),
          { status: 200 }
        );
      }
      const [status, body] = write;
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    })
  );
  return calls;
}

function policyForm(value: string): FormData {
  const f = new FormData();
  f.set("auth_policy", value);
  return f;
}

// ── D2: the policy panel ────────────────────────────────────────────────────

describe("D2: the sign-in policy panel", () => {
  async function panel(props: Partial<Record<string, unknown>>) {
    const { PolicyPanel } = await import("../app/org-admin/settings/sign-in-providers-section");
    return renderToStaticMarkup(
      <PolicyPanel
        current="mixed"
        choice="mixed"
        activeProviders={1}
        confirming={false}
        pending={false}
        onChoose={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
        action={() => {}}
        {...props}
      />
    );
  }

  it("offers three choices, one plain line each", async () => {
    const t = text(await panel({}));
    for (const words of [
      "Password only",
      "The sign-in page shows no provider button.",
      "Password or a sign-in provider",
      "Sign-in provider only",
      "Members cannot use a password; administrators still can.",
    ]) {
      expect(t).toContain(words);
    }
    expect(await panel({})).toMatch(
      /<input[^>]*checked=""[^>]*value="mixed"|value="mixed"[^>]*checked=""/
    );
  });

  it("provider-only is disabled, with the reason, when no provider is active", async () => {
    const html = await panel({ activeProviders: 0 });
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="idp_only"/);
    expect(text(html)).toContain("Add a sign-in provider first.");
    const ok = await panel({ activeProviders: 1 });
    expect(ok).not.toMatch(/<input[^>]*disabled=""[^>]*value="idp_only"/);
    expect(text(ok)).not.toContain("Add a sign-in provider first.");
  });

  it("an organization already on provider-only can keep it without a provider", async () => {
    const html = await panel({ current: "idp_only", choice: "idp_only", activeProviders: 0 });
    expect(html).not.toMatch(/<input[^>]*disabled=""[^>]*value="idp_only"/);
  });

  it("moving to or from provider-only asks first; other moves do not", async () => {
    const { policyNeedsConfirm } = await import(
      "../app/org-admin/settings/sign-in-providers-section"
    );
    expect(policyNeedsConfirm("mixed", "idp_only")).toBe(true);
    expect(policyNeedsConfirm("idp_only", "local_only")).toBe(true);
    expect(policyNeedsConfirm("local_only", "mixed")).toBe(false);
    expect(policyNeedsConfirm("idp_only", "idp_only")).toBe(false);
    // Save only opens the question; Continue submits.
    const asking = await panel({ choice: "idp_only" });
    expect(asking).toMatch(/<button type="button"[^>]*>Save<\/button>/);
    const question = text(await panel({ choice: "idp_only", confirming: true }));
    expect(question).toContain(
      "Members who only have a password will not be able to sign in. Continue?"
    );
    expect(await panel({ choice: "idp_only", confirming: true })).toMatch(
      /<button type="submit"[^>]*>Continue<\/button>/
    );
    expect(await panel({ choice: "local_only" })).toMatch(
      /<button type="submit"[^>]*>Save<\/button>/
    );
  });

  it("a refusal shows inline and keeps the choice", async () => {
    const html = await panel({ choice: "local_only", error: "The server did not answer." });
    expect(html).toMatch(/role="alert"[^>]*>The server did not answer\.</);
    expect(html).toMatch(/checked=""[^>]*value="local_only"|value="local_only"[^>]*checked=""/);
  });

  it("a saved policy says so and the line follows it", async () => {
    h.state = { phase: "saved", policy: "local_only" };
    const { SignInProvidersSection } = await import(
      "../app/org-admin/settings/sign-in-providers-section"
    );
    const html = renderToStaticMarkup(
      <SignInProvidersSection
        result={{ ok: true, identity_providers: [], count: 0 }}
        authPolicy="mixed"
        publicBase="https://idp.example"
      />
    );
    expect(html).toMatch(/role="status"[^>]*>Sign-in policy saved\.</);
    expect(text(html)).toContain("Members sign in with: password only.");
  });
});

describe("D2: the policy action", () => {
  it("saves the choice with PUT auth_policy", async () => {
    const calls = stubIdp([200, { id: "org-1", name: "Acme" }]);
    const { updateAuthPolicyAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await updateAuthPolicyAction({ phase: "idle" }, policyForm("idp_only"))).toEqual({
      phase: "saved",
      policy: "idp_only",
    });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe("http://idp.test/api/v1/organizations/org-1");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ auth_policy: "idp_only" });
  });

  it.each([
    [
      403,
      { error: "forbidden_field" },
      "Only an administrator of this organization can change this.",
    ],
    [
      400,
      {
        error: "no_active_identity_provider",
        message:
          "Members can only sign in with a provider. Add an active provider before you choose this sign-in policy.",
      },
      "Members can only sign in with a provider. Add an active provider before you choose this sign-in policy.",
    ],
    [400, { error: "no_active_identity_provider" }, "Add a sign-in provider first."],
    [
      400,
      {
        error: "invalid request",
        message: "auth_policy must be one of local_only, idp_only, mixed",
      },
      "auth_policy must be one of local_only, idp_only, mixed",
    ],
    [500, { error: "internal error" }, "The server did not answer. Nothing was changed."],
    [503, "upstream down", "The server did not answer. Nothing was changed."],
  ])("%i %j -> %s", async (status, body, words) => {
    stubIdp([status, body]);
    const { updateAuthPolicyAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await updateAuthPolicyAction({ phase: "idle" }, policyForm("mixed"))).toEqual({
      phase: "idle",
      error: words,
    });
  });

  it("a value outside the three is refused without calling the IdP", async () => {
    const calls = stubIdp([200, {}]);
    const { updateAuthPolicyAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await updateAuthPolicyAction({ phase: "idle" }, policyForm("anything"))).toEqual({
      phase: "idle",
      error: "Choose how members sign in.",
    });
    expect(calls).toHaveLength(0);
  });

  it("the site_admin is sent away and the IdP is not called", async () => {
    h.role = "site_admin";
    const calls = stubIdp([200, {}]);
    const { updateAuthPolicyAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    await expect(updateAuthPolicyAction({ phase: "idle" }, policyForm("mixed"))).rejects.toThrow(
      /^redirect:/
    );
    expect(calls).toHaveLength(0);
  });

  it("the site_admin's organization page says the change is the organization's own", () => {
    expect(src("src/app/site-admin/organizations/[id]/page.tsx")).toContain(
      "Only the organization&apos;s own administrator can change this."
    );
  });
});

describe("Q-B3: the last-provider explanation is tied to Remove…", () => {
  it("Remove… is described by the explanation under provider-only", async () => {
    const { SignInProvidersSection } = await import(
      "../app/org-admin/settings/sign-in-providers-section"
    );
    const html = renderToStaticMarkup(
      <SignInProvidersSection
        result={{
          ok: true,
          count: 1,
          identity_providers: [
            {
              id: "p-1",
              name: "Example SSO",
              slug: "example-sso",
              type: "oidc",
              priority: 0,
              active: true,
              email_domains: ["a.test"],
              allow_external_domains: false,
              created_at: "2026-10-01T10:00:00Z",
              updated_at: "2026-10-01T10:00:00Z",
            },
          ],
        }}
        authPolicy="idp_only"
        publicBase="https://idp.example"
      />
    );
    const id = html.match(/aria-describedby="([^"]+)"[^>]*>Remove…</)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`id="${id}"[^>]*>This is the only active sign-in provider`));
  });
});

// ── D4: the conflict banner ─────────────────────────────────────────────────

describe("D4: someone changed the application since the form opened", () => {
  const STAMP = "2026-10-13T09:15:42.123456Z";
  const FRESH = "2026-10-13T09:20:01.654321Z";
  const TYPED = {
    name: "Typed name",
    redirect_uris: "https://typed.example/cb",
    post_logout_redirect_uris: "",
    allowed_audiences: "",
    scope: "openid",
    skip_consent: false,
  };
  const PROPS = {
    clientId: "0198b2d0-0000-7000-8000-0000000000aa",
    initialName: "Stored name",
    initialClientID: "app-1",
    initialIsPublic: true,
    initialSkipConsent: false,
    initialAuthMethod: "none",
    initialRedirectURIs: ["https://stored.example/cb"],
    initialPostLogoutRedirectURIs: [],
    initialAllowedAudiences: [],
    initialScope: "openid",
  };

  async function form(extra: Record<string, unknown> = {}) {
    const { EditApplicationForm } = await import(
      "../app/org-admin/applications/[id]/edit/edit-application-form"
    );
    return renderToStaticMarkup(<EditApplicationForm {...PROPS} {...extra} />);
  }

  it("the form sends back the updated_at it read, exactly", async () => {
    expect(await form({ initialUpdatedAt: STAMP })).toContain(
      `<input type="hidden" name="expect_updated_at" value="${STAMP}"/>`
    );
  });

  it("an IdP without updated_at (identuum-idp-ce): nothing is sent", async () => {
    expect(await form()).not.toContain("expect_updated_at");
  });

  it("on client_changed: the banner, both buttons, and the typed values kept", async () => {
    h.state = {
      phase: "error",
      error: "Someone changed this application since you opened it. Nothing was saved.",
      values: TYPED,
      changed: { latestUpdatedAt: FRESH },
    };
    const html = await form({ initialUpdatedAt: STAMP });
    expect(html).toMatch(
      /role="alert"[^>]*data-testid="client-changed"[\s\S]*Someone changed this application since you opened it\. Nothing was saved\./
    );
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Load the latest version<\/button>/);
    expect(html).toMatch(
      new RegExp(
        `<button[^>]*type="submit" value="${FRESH}" name="save_anyway_updated_at"[^>]*>Save my version anyway</button>`
      )
    );
    expect(html).toContain('value="Typed name"');
    expect(html).toContain("https://typed.example/cb");
    expect(html).not.toContain("Stored name");
    // The banner says it once; no second red line repeats it.
    expect(html.match(/Someone changed this application/g)).toHaveLength(1);
  });

  it("without a fresh read only 'Load the latest version' is offered", async () => {
    h.state = { phase: "error", error: "x", values: TYPED, changed: {} };
    const html = await form({ initialUpdatedAt: STAMP });
    expect(html).toContain("Load the latest version");
    expect(html).not.toContain("Save my version anyway");
  });

  function appForm(extra: Record<string, string> = {}): FormData {
    const f = new FormData();
    f.set("name", "Typed name");
    f.set("redirect_uris", "https://typed.example/cb");
    f.set("expect_updated_at", STAMP);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  it("the action maps 409 client_changed, with the fresh updated_at", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ url: String(url), method, body: String(init?.body ?? "") });
        if (method === "PUT") {
          return new Response(JSON.stringify({ error: "client_changed", message: "x" }), {
            status: 409,
          });
        }
        return new Response(
          JSON.stringify({
            id: PROPS.clientId,
            client_id: "app-1",
            name: "Other",
            updated_at: FRESH,
          }),
          { status: 200 }
        );
      })
    );
    const { updateApplicationAction } = await import("../app/org-admin/applications/actions");
    const out = await updateApplicationAction(PROPS.clientId, { phase: "idle" }, appForm());
    expect(out).toMatchObject({
      phase: "error",
      error: "Someone changed this application since you opened it. Nothing was saved.",
      values: { name: "Typed name" },
      changed: { latestUpdatedAt: FRESH },
    });
    expect(JSON.parse(calls[0].body).expect_updated_at).toBe(STAMP);
  });

  it("'Save my version anyway' sends the fresh updated_at instead", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: String(init?.body ?? ""),
        });
        return new Response(
          JSON.stringify({ id: PROPS.clientId, client_id: "app-1", name: "Typed name" }),
          {
            status: 200,
          }
        );
      })
    );
    const { updateApplicationAction } = await import("../app/org-admin/applications/actions");
    const out = await updateApplicationAction(
      PROPS.clientId,
      { phase: "idle" },
      appForm({ save_anyway_updated_at: FRESH })
    );
    expect(out.phase).toBe("success");
    expect(JSON.parse(calls[0].body).expect_updated_at).toBe(FRESH);
  });

  it("the duplicate 409 keeps its own words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict" }), { status: 409 }))
    );
    const { updateApplicationAction } = await import("../app/org-admin/applications/actions");
    const out = await updateApplicationAction(PROPS.clientId, { phase: "idle" }, appForm());
    expect(out).toMatchObject({
      error: "A client with this configuration already exists in your organization.",
    });
    expect(out).not.toHaveProperty("changed");
  });
});

// ── Q7, U3, O20: the email row ──────────────────────────────────────────────

describe("Q7: the account settings Profile tab shows the email row per role", () => {
  const PROFILE = {
    email: "admin@acme.test",
    name: "Ada Admin",
    role: "org_admin",
    email_verified: true,
    email_verified_via: "admin_set",
    email_proven: false,
  };

  async function profileTab(): Promise<string> {
    vi.doMock("@/lib/idp-admin-client", () => ({ getOwnProfile: async () => h.profile }));
    vi.doMock("@/lib/idp-account-client", () => ({
      getOwnMfaStatus: async () => ({ ok: false, unavailable: true }),
      listOwnSessions: async () => ({ ok: true, sessions: [] }),
      sendOwnVerificationEmail: async () => ({ outcome: "sent" }),
    }));
    const Page = (await import("@/app/account/settings/page")).default;
    return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tab: "profile" }) }));
  }

  it("org_admin, not proven: the status and the Send verification email button", async () => {
    h.profile = PROFILE;
    const html = await profileTab();
    expect(html).toContain('data-testid="account-email-status"');
    expect(html).toContain("Not verified yet");
    expect(html).toContain("Send verification email");
  });

  it("org_admin, proven: the status only", async () => {
    h.profile = { ...PROFILE, email_verified_via: "email_link", email_proven: true };
    const html = await profileTab();
    expect(html).toContain("Verified by email");
    expect(html).not.toContain("Send verification email");
  });

  it("site_admin: the status line only, never the button", async () => {
    h.role = "site_admin";
    h.profile = { ...PROFILE, role: "site_admin", email_verified_via: "setup" };
    const html = await profileTab();
    expect(html).toContain("Not verified yet");
    expect(html).not.toContain("Send verification email");
    expect(html).not.toContain("This server cannot send email");
  });

  it("identuum-idp-ce (no fields): no row", async () => {
    h.profile = { email: "admin@acme.test", role: "org_admin", email_verified: true };
    expect(await profileTab()).not.toContain("account-email-status");
  });
});

describe("U3 and O20: the send row", () => {
  it("U3: 'cannot send' is one live region that does not repeat the badge", async () => {
    h.state = { outcome: "not_configured" };
    const { SendVerificationEmail } = await import("@/app/dashboard/send-verification-email");
    const html = renderToStaticMarkup(<SendVerificationEmail address="a@acme.test" />);
    expect(html).toMatch(
      /role="status" aria-live="polite" tabindex="-1"[^>]*>This server cannot send email, so ask your administrator\.</
    );
    expect(html).not.toContain("Not verified yet");
    expect(html).not.toContain("Send verification email");
  });

  it("U3: before any answer the same live region is already there", async () => {
    const { SendVerificationEmail } = await import("@/app/dashboard/send-verification-email");
    const html = renderToStaticMarkup(<SendVerificationEmail address="a@acme.test" />);
    expect(html).toMatch(/role="status" aria-live="polite"/);
    expect(html).toContain("Send verification email");
  });

  it("O20: the no-email sentinel address is never offered the button", async () => {
    const { EmailStatus } = await import("@/app/dashboard/email-status");
    const status = { label: "Not verified yet", proven: false };
    const sentinel = renderToStaticMarkup(
      <EmailStatus
        status={status}
        address="noemail+0198b2d0@no-email.internal"
        mailReady
        offerSend
      />
    );
    expect(sentinel).toContain("Not verified yet");
    expect(sentinel).not.toContain("Send verification email");
    const real = renderToStaticMarkup(
      <EmailStatus status={status} address="a@acme.test" mailReady offerSend />
    );
    expect(real).toContain("Send verification email");
  });
});

// ── U9, F1, F2: focus and menus ─────────────────────────────────────────────

describe("U9: a click on the remove dialog's backdrop does not release the focus trap", () => {
  it("focus moving to nothing is taken back; a move to an element is left alone", async () => {
    const { focusLeftDialog } = await import("../app/org-admin/settings/sign-in-providers-section");
    expect(focusLeftDialog(null)).toBe(true);
    // Cancel hands focus back to "Remove…" (UI-0912-AB-FIX): not taken back.
    expect(focusLeftDialog({})).toBe(false);
  });

  it("the dialog uses it on blur", () => {
    expect(src("src/app/org-admin/settings/sign-in-providers-section.tsx")).toMatch(
      /onBlur=\{\(e\) => \{\s*if \(focusLeftDialog\(e\.relatedTarget\)\)/
    );
  });
});

describe("F1: the drawer closed by widening keeps focus in the sidebar", () => {
  function env() {
    const focused: string[] = [];
    const stop = (name: string) => ({ focus: () => focused.push(name) });
    return {
      focused,
      env: {
        stops: () => [stop("first")],
        active: () => null,
        menuButton: () => stop("menu"),
        body: { style: { overflow: "" } },
        close: () => {},
      },
    };
  }

  it("release() returns focus to Menu; release(false) leaves it", async () => {
    const { openDrawer } = await import("@/components/shared/shell-drawer");
    const a = env();
    openDrawer(a.env).release();
    expect(a.focused).toEqual(["first", "menu"]);
    const b = env();
    openDrawer(b.env).release(false);
    expect(b.focused).toEqual(["first"]);
  });

  it("the frame releases without the return when it closed for width", () => {
    expect(src("src/components/shared/shell-frame.tsx")).toMatch(
      /drawer\.release\(!closedForWidth\.current\)/
    );
  });
});

describe("F2: the account menu holds only its items", () => {
  it("the address and its rule sit before role=menu, not inside it", () => {
    const s = src("src/components/shared/account-menu.tsx");
    const menu = s.indexOf('role="menu"');
    const address = s.indexOf('data-testid="account-email"');
    expect(menu).toBeGreaterThan(-1);
    expect(address).toBeGreaterThan(-1);
    expect(address).toBeLessThan(menu);
  });
});

// ── UI-0913-A-EARLY-FIX: F2..F5 of UI-0913-A-EARLY-REVIEW ───────────────────

describe("EARLY-FIX F2: the policy question says what happens in its direction", () => {
  async function asking(current: string, choice: string) {
    const { PolicyPanel } = await import("../app/org-admin/settings/sign-in-providers-section");
    return text(
      renderToStaticMarkup(
        <PolicyPanel
          current={current}
          choice={choice as "mixed"}
          activeProviders={1}
          confirming={true}
          pending={false}
          onChoose={() => {}}
          onConfirm={() => {}}
          onCancel={() => {}}
          action={() => {}}
        />
      )
    );
  }
  const TO_PROVIDER = "Members who only have a password will not be able to sign in. Continue?";

  it("to provider-only: password members lose access", async () => {
    expect(await asking("mixed", "idp_only")).toContain(TO_PROVIDER);
  });

  it("from provider-only to password only: provider members lose access", async () => {
    const t = await asking("idp_only", "local_only");
    expect(t).toContain(
      "Members who sign in only with a provider will not be able to sign in. Continue?"
    );
    expect(t).not.toContain(TO_PROVIDER);
  });

  it("from provider-only to both: password members can sign in again", async () => {
    const t = await asking("idp_only", "mixed");
    expect(t).toContain("Members will be able to sign in with a password again. Continue?");
    expect(t).not.toContain(TO_PROVIDER);
  });
});

describe("EARLY-FIX F3: focus moves to the question when Save opens it", () => {
  it("the question can take focus and the panel moves focus to it", () => {
    const s = src("src/app/org-admin/settings/sign-in-providers-section.tsx");
    expect(s).toMatch(/ref=\{questionRef\}[^>]*tabIndex=\{-1\}/);
    expect(s).toMatch(/if \(confirming\) questionRef\.current\?\.focus\(\);/);
  });
});

describe("EARLY-FIX F4: the card's line names the last thing that happened", () => {
  it("a removal after a policy save says the removal", async () => {
    const { cardStatus } = await import("../app/org-admin/settings/sign-in-providers-section");
    expect(cardStatus({ policySaved: true, removed: true, last: "remove", saved: null })).toBe(
      "Provider removed."
    );
    expect(cardStatus({ policySaved: true, removed: true, last: "policy", saved: null })).toBe(
      "Sign-in policy saved."
    );
    expect(cardStatus({ policySaved: false, removed: false, last: null, saved: "Saved." })).toBe(
      "Saved."
    );
  });
});

describe("EARLY-FIX F5: the conflict banner takes focus; tap targets are 44 px", () => {
  const PROPS = {
    clientId: "0198b2d0-0000-7000-8000-0000000000aa",
    initialName: "Stored name",
    initialClientID: "app-1",
    initialIsPublic: true,
    initialSkipConsent: false,
    initialAuthMethod: "none",
    initialRedirectURIs: ["https://stored.example/cb"],
    initialPostLogoutRedirectURIs: [],
    initialAllowedAudiences: [],
    initialScope: "openid",
    initialUpdatedAt: "2026-10-13T09:15:42.123456Z",
  };

  it("the banner can take focus, the form moves focus to it, and both buttons are h-11", async () => {
    h.state = {
      phase: "error",
      error: "x",
      values: { name: "Typed name", redirect_uris: "https://typed.example/cb" },
      changed: { latestUpdatedAt: "2026-10-13T09:20:01.654321Z" },
    };
    const { EditApplicationForm } = await import(
      "../app/org-admin/applications/[id]/edit/edit-application-form"
    );
    const html = renderToStaticMarkup(<EditApplicationForm {...PROPS} />);
    expect(html).toMatch(/role="alert" tabindex="-1" data-testid="client-changed"/);
    for (const name of ["Load the latest version", "Save my version anyway"]) {
      const button = html.match(new RegExp(`<button[^>]*>${name}</button>`))?.[0] ?? "";
      expect(button).toContain("h-11");
      expect(button).not.toContain("h-8");
    }
    expect(src("src/app/org-admin/applications/[id]/edit/edit-application-form.tsx")).toMatch(
      /if \(changed\) bannerRef\.current\?\.focus\(\);/
    );
  });

  it("each policy choice is at least 44 px high", async () => {
    const { PolicyPanel } = await import("../app/org-admin/settings/sign-in-providers-section");
    const html = renderToStaticMarkup(
      <PolicyPanel
        current="mixed"
        choice="mixed"
        activeProviders={1}
        confirming={false}
        pending={false}
        onChoose={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
        action={() => {}}
      />
    );
    const labels = html.match(/<label[^>]*>/g) ?? [];
    expect(labels).toHaveLength(3);
    for (const l of labels) expect(l).toContain("min-h-11");
  });
});
