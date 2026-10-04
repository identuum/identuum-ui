/**
 * A refused create/update keeps what the admin typed.
 *
 * React 19 resets an uncontrolled `<form action>` after every submission,
 * so a refused save (for example 403 invalid_mfa_code on the first-party
 * authenticator code) used to empty the create form and revert the edit
 * form to the stored values. The actions now hand the submitted values back
 * in the error state and the forms render them as their defaults, so the
 * reset restores them. The authenticator code (mfa_code) is never handed
 * back and its input never has a default.
 *
 * SECURITY: every code and value here is a synthetic fixture.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: { phase: "idle" } as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_admin", user: { role: "org_admin" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
// The forms read their state from useActionState; the render tests set it.
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useActionState: () => [h.state, () => {}, false],
}));

afterEach(() => {
  vi.unstubAllGlobals();
  h.state = { phase: "idle" };
});

const CLIENT_ID = "01990000-0000-7000-8000-0000000000c1";
const CODE = "135792";

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function submitted(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("name", "Payroll portal");
  fd.set("redirect_uris", "https://rp.example.test/cb\nhttps://rp.example.test/renew");
  fd.set("post_logout_redirect_uris", "https://rp.example.test/bye");
  fd.set("allowed_audiences", "https://api.example.test");
  fd.set("scope", "openid email");
  fd.set("skip_consent", "on");
  fd.set("mfa_code", CODE);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

const TYPED = {
  name: "Payroll portal",
  redirect_uris: "https://rp.example.test/cb\nhttps://rp.example.test/renew",
  post_logout_redirect_uris: "https://rp.example.test/bye",
  allowed_audiences: "https://api.example.test",
  scope: "openid email",
  skip_consent: true,
};

describe("the actions hand back what was typed on a refusal, never the code", () => {
  it("create refused for a wrong authenticator code", async () => {
    stubFetch(403, { error: "invalid_mfa_code" });
    const { createApplicationAction } = await import("../app/org-admin/applications/actions");
    const { MFA_CODE_INVALID_MESSAGE } = await import("@/lib/idp-admin-client");
    const state = await createApplicationAction({ phase: "idle" }, submitted({ is_public: "on" }));
    expect(state.phase).toBe("error");
    if (state.phase !== "error") return;
    expect(state.error).toBe(MFA_CODE_INVALID_MESSAGE);
    expect(state.values).toEqual({ ...TYPED, is_public: true });
    expect("mfa_code" in state.values).toBe(false);
    expect(JSON.stringify(state)).not.toContain(CODE);
  });

  it("create refused by the console's own check keeps the input too", async () => {
    const spy = stubFetch(201, {});
    const { createApplicationAction } = await import("../app/org-admin/applications/actions");
    const state = await createApplicationAction(
      { phase: "idle" },
      submitted({ redirect_uris: "javascript:alert(1)" })
    );
    expect(spy).not.toHaveBeenCalled();
    expect(state.phase === "error" && state.values.redirect_uris).toBe("javascript:alert(1)");
    expect(state.phase === "error" && state.values.is_public).toBe(false);
    expect(JSON.stringify(state)).not.toContain(CODE);
  });

  it("update refused for a scope the admin does not hold", async () => {
    stubFetch(400, { error: "invalid_scope" });
    const { updateApplicationAction } = await import("../app/org-admin/applications/actions");
    const { CLIENT_SCOPE_NOT_HELD_MESSAGE } = await import("@/lib/idp-admin-client");
    const state = await updateApplicationAction(CLIENT_ID, { phase: "idle" }, submitted());
    expect(state.phase).toBe("error");
    if (state.phase !== "error") return;
    expect(state.error).toBe(CLIENT_SCOPE_NOT_HELD_MESSAGE);
    expect(state.values).toEqual(TYPED);
    expect(JSON.stringify(state)).not.toContain(CODE);
  });

  it("update refused for a wrong authenticator code keeps the edits", async () => {
    stubFetch(403, { error: "invalid_mfa_code" });
    const { updateApplicationAction } = await import("../app/org-admin/applications/actions");
    const state = await updateApplicationAction(CLIENT_ID, { phase: "idle" }, submitted());
    expect(state.phase === "error" && state.values).toEqual(TYPED);
    expect(JSON.stringify(state)).not.toContain(CODE);
  });

  it("a successful save hands back no typed values", async () => {
    stubFetch(200, { id: CLIENT_ID, client_id: "cid", name: "Payroll portal" });
    const { updateApplicationAction } = await import("../app/org-admin/applications/actions");
    const state = await updateApplicationAction(CLIENT_ID, { phase: "idle" }, submitted());
    expect(state.phase).toBe("success");
    expect("values" in state).toBe(false);
  });
});

function codeInput(html: string): string {
  return html.match(/<input[^>]*name="mfa_code"[^>]*>/)?.[0] ?? "";
}

describe("the forms render a refused submission's values as their defaults", () => {
  it("the create form shows what was typed and an empty code field", async () => {
    h.state = {
      phase: "error",
      error: "The authenticator code was not accepted.",
      values: { ...TYPED, is_public: true },
    };
    const { CreateApplicationForm } = await import(
      "../app/org-admin/applications/new/create-application-form"
    );
    const html = renderToStaticMarkup(<CreateApplicationForm publicClients />);
    expect(html).toMatch(/name="name"[^>]*value="Payroll portal"/);
    expect(html).toContain("https://rp.example.test/cb\nhttps://rp.example.test/renew</textarea>");
    expect(html).toContain("https://rp.example.test/bye</textarea>");
    expect(html).toContain("https://api.example.test</textarea>");
    expect(html).toMatch(/name="scope"[^>]*value="openid email"/);
    expect(html).toMatch(/name="is_public"[^>]*checked/);
    expect(html).toMatch(/name="skip_consent"[^>]*checked/);
    expect(codeInput(html)).not.toBe("");
    expect(codeInput(html)).not.toMatch(/value=/);
  });

  it("the create form starts empty", async () => {
    const { CreateApplicationForm } = await import(
      "../app/org-admin/applications/new/create-application-form"
    );
    const html = renderToStaticMarkup(<CreateApplicationForm publicClients />);
    expect(html).not.toMatch(/name="name"[^>]*value=/);
    expect(html).not.toMatch(/name="skip_consent"[^>]*checked/);
  });

  const editProps = {
    clientId: CLIENT_ID,
    initialName: "Stored name",
    initialClientID: "cid",
    initialIsPublic: false,
    initialSkipConsent: false,
    initialAuthMethod: "client_secret_basic",
    initialRedirectURIs: ["https://stored.example.test/cb"],
    initialPostLogoutRedirectURIs: [],
    initialAllowedAudiences: [],
    initialScope: "openid",
  };

  it("the edit form keeps the admin's edits, not the stored values", async () => {
    h.state = { phase: "error", error: "The authenticator code was not accepted.", values: TYPED };
    const { EditApplicationForm } = await import(
      "../app/org-admin/applications/[id]/edit/edit-application-form"
    );
    const html = renderToStaticMarkup(<EditApplicationForm {...editProps} />);
    expect(html).toMatch(/name="name"[^>]*value="Payroll portal"/);
    expect(html).toContain("https://rp.example.test/cb\nhttps://rp.example.test/renew</textarea>");
    expect(html).not.toContain("https://stored.example.test/cb");
    expect(html).toMatch(/name="scope"[^>]*value="openid email"/);
    expect(html).toMatch(/name="skip_consent"[^>]*checked/);
    expect(codeInput(html)).not.toBe("");
    expect(codeInput(html)).not.toMatch(/value=/);
  });

  it("the edit form starts from the stored values", async () => {
    const { EditApplicationForm } = await import(
      "../app/org-admin/applications/[id]/edit/edit-application-form"
    );
    const html = renderToStaticMarkup(<EditApplicationForm {...editProps} />);
    expect(html).toMatch(/name="name"[^>]*value="Stored name"/);
    expect(html).toContain("https://stored.example.test/cb</textarea>");
    expect(html).not.toMatch(/name="skip_consent"[^>]*checked/);
  });
});
