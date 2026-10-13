/**
 * UI-0912-AB-FIX (review UI-0912-AB-REVIEW F2-F5, F10): the sign-in providers
 * on Settings and its Add and Edit pages.
 *
 * - F2: a successful save does not re-render the page that saved. In Next a
 *   revalidatePath inside the action re-renders /new, which then has a
 *   provider and swaps the form for the "already has a provider" alert, so
 *   the form never opens Settings. (Browser half: e2e/org-admin-settings.spec.ts.)
 * - F3: a server that does not send auth_policy is "could not be read" (B-06),
 *   never "password only" with a false B-05 hint.
 * - F4: DELETE answered 404 (another tab removed it) is a removal.
 * - F5: a failed organization read on Settings, Add and Edit names its cause
 *   (A-30..A-32), not B-33 and not nothing.
 * - F10: no IdP configured is not "the server did not answer"; a refusal that
 *   starts with a capital word reads in lower case mid-sentence.
 *
 * SECURITY: every value is a fixture.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  idpEnabled: true,
  revalidated: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    idp: { enabled: h.idpEnabled, public_base_url: "https://idp.example" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_admin", user: { role: "org_admin" } }),
}));
vi.mock("@/lib/server-runtime-state", () => ({ getServerRuntimeState: async () => null }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    h.revalidated.push(p);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/org-admin/settings",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  h.idpEnabled = true;
  h.revalidated = [];
});

const ORG = { id: "org-1", name: "Acme", org_slug: "acme", auth_policy: "mixed" };
const WIRE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Example SSO",
  slug: "example-sso",
  type: "oidc",
  active: true,
  updated_at: "2026-10-02T10:00:00Z",
  config: { issuer_url: "https://accounts.example", client_id: "cid", email_domains: ["a.test"] },
};

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** fetch by path: the own-organization read, the provider, anything else empty. */
function stubIdp(opts: { org?: [number, unknown]; provider?: [number, unknown] }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/organizations/current")) {
        const [status, body] = opts.org ?? [200, ORG];
        return new Response(JSON.stringify(body), { status });
      }
      if (u.endsWith("/identity-provider")) {
        const [status, body] = opts.provider ?? [200, { identity_provider: WIRE }];
        return new Response(JSON.stringify(body), { status });
      }
      return new Response("{}", { status: 404 });
    })
  );
}

function providerForm(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    name: "Example SSO",
    slug: "example-sso",
    issuer_url: "https://accounts.example",
    client_id: "cid",
    client_secret: "fixture-secret",
    email_domains: "a.test",
    ...extra,
  }))
    fd.set(k, v);
  return fd;
}

describe("F2: a successful save leaves the page that saved as it is", () => {
  it("create and update do not ask Next to re-render; the form opens Settings itself", async () => {
    stubIdp({});
    const { saveOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await saveOidcProviderAction({ phase: "idle" }, providerForm())).toEqual({
      phase: "saved",
      result: "saved",
    });
    expect(
      await saveOidcProviderAction({ phase: "idle" }, providerForm({ mode: "update" }))
    ).toEqual({ phase: "saved", result: "updated" });
    expect(h.revalidated).toEqual([]);
  });
});

// UI-0913-A (D2): an absent policy is the IdP's permissive default, and the
// card says so in words (it said "could not be read" until v0.9.13).
describe("F3: an absent sign-in policy is not 'password only'", () => {
  it("the own-organization read keeps it empty, and the card reads it as the default", async () => {
    const { auth_policy: _absent, ...withoutPolicy } = ORG;
    stubIdp({ org: [200, withoutPolicy] });
    const { getOwnOrganizationResult } = await import("@/lib/idp-admin-client");
    const org = await getOwnOrganizationResult();
    expect(org.ok && org.org.auth_policy).toBe("");

    const { SignInProvidersSection } = await import(
      "../app/org-admin/settings/sign-in-providers-section"
    );
    const html = renderToStaticMarkup(
      <SignInProvidersSection
        result={{
          ok: true,
          identity_providers: [
            {
              id: WIRE.id,
              name: WIRE.name,
              slug: WIRE.slug,
              type: "oidc",
              priority: 0,
              active: true,
              email_domains: ["a.test"],
              allow_external_domains: false,
              created_at: WIRE.updated_at,
              updated_at: WIRE.updated_at,
            },
          ],
          count: 1,
        }}
        authPolicy={org.ok ? org.org.auth_policy : null}
        publicBase="https://idp.example"
      />
    );
    expect(text(html)).toContain("Members sign in with: password or a sign-in provider (default).");
    expect(text(html)).not.toContain("password only");
    expect(text(html)).not.toContain("will not offer this provider");
  });
});

describe("F4: a provider another tab already removed", () => {
  it("DELETE answered 404 is a removal: the card says removed and re-reads", async () => {
    stubIdp({ provider: [404, { error: "identity provider not found" }] });
    const { deleteOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await deleteOidcProviderAction({ phase: "idle" }, new FormData())).toEqual({
      phase: "deleted",
    });
    expect(h.revalidated).toEqual(["/org-admin/settings"]);
  });

  it("any other refusal still keeps the row and says so (B-31)", async () => {
    stubIdp({ provider: [500, { error: "boom" }] });
    const { deleteOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await deleteOidcProviderAction({ phase: "idle" }, new FormData())).toEqual({
      phase: "idle",
      error: "The provider was not removed. Try again.",
    });
  });
});

describe("F5: a failed organization read names its cause", () => {
  const cases: [number, string][] = [
    [503, "The server did not answer. Try again in a moment."],
    [403, "You do not have permission to see or change this organization's settings."],
    [500, "Your organization could not be read. Try again."],
  ];

  it.each(cases)("Settings, org read %i: one line says why", async (status, line) => {
    stubIdp({ org: [status, { error: "x" }] });
    const { default: OrgAdminSettingsPage } = await import("../app/org-admin/settings/page");
    const html = renderToStaticMarkup(await OrgAdminSettingsPage());
    expect(html).toMatch(/role="alert"[^>]*data-testid="org-read-failure"/);
    expect(text(html)).toContain(line);
  });

  it("Settings, org read 401: the sign-in page", async () => {
    stubIdp({ org: [401, { error: "unauthorized" }] });
    const { default: OrgAdminSettingsPage } = await import("../app/org-admin/settings/page");
    await expect(OrgAdminSettingsPage()).rejects.toThrow("redirect:/login?reason=session_expired");
  });

  it("Settings, org read fine: no such line", async () => {
    stubIdp({});
    const { default: OrgAdminSettingsPage } = await import("../app/org-admin/settings/page");
    const html = renderToStaticMarkup(await OrgAdminSettingsPage());
    expect(html).not.toContain("org-read-failure");
  });

  it.each(cases)("Add and Edit, org read %i: that cause, not B-33", async (status, line) => {
    stubIdp({ org: [status, { error: "x" }] });
    const { default: NewPage } = await import(
      "../app/org-admin/settings/sign-in-providers/new/page"
    );
    const { default: EditPage } = await import(
      "../app/org-admin/settings/sign-in-providers/[id]/edit/page"
    );
    for (const html of [
      renderToStaticMarkup(await NewPage()),
      renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: WIRE.id }) })),
    ]) {
      expect(text(html)).toContain(line);
      expect(text(html)).not.toContain("The sign-in providers could not be read.");
    }
  });
});

describe("F10: the right cause and a sentence that reads", () => {
  it("no IdP configured is not 'the server did not answer'", async () => {
    h.idpEnabled = false;
    const { getOwnOrganizationResult } = await import("@/lib/idp-admin-client");
    expect(await getOwnOrganizationResult()).toMatchObject({ ok: false, kind: "other" });
  });

  it("a refusal starting 'The IdP…' reads 'not saved: the IdP…'", async () => {
    stubIdp({ provider: [400, { error: "The IdP is not reachable." }] });
    const { saveOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await saveOidcProviderAction({ phase: "idle" }, providerForm())).toMatchObject({
      error: "The provider was not saved: the IdP is not reachable.",
    });
  });

  it("a refusal starting with an acronym keeps it", async () => {
    stubIdp({ provider: [400, { error: "OIDC discovery failed" }] });
    const { saveOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await saveOidcProviderAction({ phase: "idle" }, providerForm())).toMatchObject({
      error: "The provider was not saved: OIDC discovery failed.",
    });
  });
});
