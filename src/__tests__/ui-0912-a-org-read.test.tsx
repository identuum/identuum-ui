/**
 * UI-0912-A, part A1 (OSS v0.9.12 C3): the provider page's organization read.
 *
 * Before, every failure of GET /api/v1/organizations/current became ONE line,
 * "Your organization could not be read. Try again.", whatever the cause. Two
 * causes were found, and each test below covers exactly one of them:
 *
 *   H1 — the access token died while the tab stayed open. identuum-idp-oss
 *        has no `token_expired`: the boundary retries the dead cookie
 *        anonymously and the guard answers 401 `no_credential`, which the
 *        export's bff() did not renew. Covered by ui-0912-a-renewal.test.ts
 *        only.
 *   H2 — the first request after a restart hit a stale connection and threw.
 *        Covered by the getOwnOrganizationResult retry tests only.
 *
 * The provider actions then say what happened, keep what was typed and never
 * hand back the client secret. SECURITY: every value here is a fixture.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: { phase: "idle" } as unknown }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
}));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://idp.test",
}));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_admin", user: { role: "org_admin" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  // UI-0912-B: the provider form returns to Settings after a save.
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useActionState: () => [h.state, () => {}, false],
}));

afterEach(() => {
  vi.unstubAllGlobals();
  h.state = { phase: "idle" };
});

const ORG = { id: "01990000-0000-7000-8000-0000000000a1", name: "Acme", domain: "acme.test" };
const SECRET = "fixture-secret-never-echoed";

function answer(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

describe("H2: the organization read is retried once after a network failure", () => {
  it("a thrown first request is retried and the organization is read", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(answer(200, ORG));
    vi.stubGlobal("fetch", fetch);
    const { getOwnOrganizationResult } = await import("@/lib/idp-admin-client");
    const result = await getOwnOrganizationResult();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.org.id).toBe(ORG.id);
    expect(fetch).toHaveBeenCalledTimes(2);
    // Each attempt carries its own timeout.
    expect(fetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetch.mock.calls[1][1].signal).not.toBe(fetch.mock.calls[0][1].signal);
  });

  it("two network failures are 'unavailable', after exactly one retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetch);
    const { getOwnOrganizationResult } = await import("@/lib/idp-admin-client");
    expect(await getOwnOrganizationResult()).toEqual({ ok: false, status: 0, kind: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "session"],
    [403, "forbidden"],
    [502, "unavailable"],
    [503, "unavailable"],
    [504, "unavailable"],
    [404, "other"],
    [500, "other"],
  ])("HTTP %i is '%s' and is not retried", async (status, kind) => {
    const fetch = vi.fn(async () => answer(status));
    vi.stubGlobal("fetch", fetch);
    const { getOwnOrganizationResult } = await import("@/lib/idp-admin-client");
    expect(await getOwnOrganizationResult()).toEqual({ ok: false, status, kind });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("getOwnOrganization() keeps its org-or-null answer for its other callers", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(answer(200, ORG))
    );
    const { getOwnOrganization } = await import("@/lib/idp-admin-client");
    expect((await getOwnOrganization())?.id).toBe(ORG.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(503))
    );
    expect(await getOwnOrganization()).toBeNull();
  });
});

function typed(): FormData {
  const fd = new FormData();
  fd.set("mode", "create");
  fd.set("name", "Example SSO");
  fd.set("slug", "example-sso");
  fd.set("issuer_url", "https://accounts.example");
  fd.set("client_id", "cid-fixture");
  fd.set("client_secret", SECRET);
  fd.set("scopes", "openid email");
  fd.set("email_domains", "example.com");
  return fd;
}

const TYPED = {
  name: "Example SSO",
  slug: "example-sso",
  issuer_url: "https://accounts.example",
  client_id: "cid-fixture",
  scopes: "openid email",
  email_domains: "example.com",
  allow_external_domains: false,
};

/** The organization read answers `org`; every other call answers 500. */
function orgReadAnswers(org: () => Promise<Response>) {
  const fetch = vi.fn(async (url: string) =>
    String(url).endsWith("/api/v1/organizations/current") ? org() : answer(500)
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("the provider actions say why the organization could not be read", () => {
  it.each([
    [
      "the server did not answer",
      () => Promise.reject(new TypeError("fetch failed")),
      "The server did not answer. Nothing was saved. Try again in a moment.",
      "The server did not answer. Nothing was removed. Try again in a moment.",
    ],
    [
      "503",
      async () => answer(503),
      "The server did not answer. Nothing was saved. Try again in a moment.",
      "The server did not answer. Nothing was removed. Try again in a moment.",
    ],
    [
      "403",
      async () => answer(403),
      "You do not have permission to change this organization's sign-in settings.",
      "You do not have permission to change this organization's sign-in settings.",
    ],
    [
      "500",
      async () => answer(500),
      "Your organization could not be read. Nothing was saved. Try again.",
      "Your organization could not be read. Nothing was removed. Try again.",
    ],
  ])("%s", async (_cause, org, saveText, removeText) => {
    const { saveOidcProviderAction, deleteOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    orgReadAnswers(org);
    const saved = await saveOidcProviderAction({ phase: "idle" }, typed());
    expect(saved).toMatchObject({ phase: "idle", error: saveText });
    orgReadAnswers(org);
    const removed = await deleteOidcProviderAction({ phase: "idle" }, new FormData());
    expect(removed).toMatchObject({ phase: "idle", error: removeText });
  });

  it("401 sends the browser to the sign-in page with the expiry reason", async () => {
    const { saveOidcProviderAction, deleteOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    orgReadAnswers(async () => answer(401));
    await expect(saveOidcProviderAction({ phase: "idle" }, typed())).rejects.toThrow(
      "redirect:/login?reason=session_expired"
    );
    await expect(deleteOidcProviderAction({ phase: "idle" }, new FormData())).rejects.toThrow(
      "redirect:/login?reason=session_expired"
    );
  });
});

describe("a failed save keeps what was typed, never the client secret", () => {
  it.each([
    ["the organization read failed", async () => answer(503)],
    ["the provider save was refused", async () => answer(200, ORG)],
  ])("%s", async (_cause, org) => {
    const { saveOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    orgReadAnswers(org);
    const state = await saveOidcProviderAction({ phase: "idle" }, typed());
    expect(state.phase).toBe("idle");
    if (state.phase !== "idle") return;
    expect(state.error).toBeTruthy();
    expect(state.values).toEqual(TYPED);
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it("the console's own field check keeps the input too", async () => {
    const { saveOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    const fd = typed();
    fd.set("name", "");
    const state = await saveOidcProviderAction({ phase: "idle" }, fd);
    expect(state).toMatchObject({ phase: "idle", error: "Check the fields below." });
    if (state.phase !== "idle") return;
    expect(state.values).toEqual({ ...TYPED, name: "" });
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it("the form shows the handed-back values and an empty secret field", async () => {
    const { ProviderForm } = await import(
      "../app/org-admin/settings/sign-in-providers/provider-form"
    );
    h.state = {
      phase: "idle",
      error: "The server did not answer. Nothing was saved. Try again in a moment.",
      values: { ...TYPED, allow_external_domains: true },
    };
    const html = renderToStaticMarkup(<ProviderForm provider={null} publicBase="" />);
    for (const v of ["Example SSO", "example-sso", "https://accounts.example", "cid-fixture"]) {
      expect(html).toContain(`value="${v}"`);
    }
    expect(html).toContain('value="openid email"');
    expect(html).toContain('value="example.com"');
    expect(html).toMatch(/name="allow_external_domains"[^>]*checked/);
    expect(html).toMatch(/name="client_secret"[^>]*value=""/);
    expect(html).not.toContain(SECRET);
  });
});
