/**
 * UI-0912-B (OSS v0.9.12 C5): the organization's sign-in providers are listed
 * on the Settings page. Add and Edit open their own page and come back to
 * Settings; Remove happens in place. Each result is one plain line, and no
 * line asks for a reload. SECURITY: every value here is a fixture; the
 * secret-shaped values exist only to prove they never reach the HTML.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: { phase: "idle" } as unknown }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
}));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true, public_base_url: "https://idp.example" } }),
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
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useActionState: () => [h.state, () => {}, false],
}));

afterEach(() => {
  vi.unstubAllGlobals();
  h.state = { phase: "idle" };
});

const SECRET = "fixture-secret-never-rendered";
const ID = "11111111-1111-4111-8111-111111111111";
const WIRE = {
  id: ID,
  name: "Example SSO",
  slug: "example-sso",
  type: "oidc",
  active: true,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-02T10:00:00Z",
  config: {
    issuer_url: "https://accounts.example",
    client_id: "cid-fixture",
    client_secret: SECRET,
    private_key: SECRET,
    scopes: ["openid", "email"],
    email_domains: ["example.com", "example.org"],
    allow_external_domains: false,
  },
};

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

async function providers(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
  const { listOrganizationIdentityProviders } = await import("@/lib/idp-admin-client");
  return listOrganizationIdentityProviders("org-1");
}

async function card(
  result: Awaited<ReturnType<typeof providers>>,
  authPolicy: string | null = "mixed"
) {
  const { SignInProvidersSection } = await import(
    "../app/org-admin/settings/sign-in-providers-section"
  );
  return renderToStaticMarkup(
    <SignInProvidersSection
      result={result}
      authPolicy={authPolicy}
      publicBase="https://idp.example"
    />
  );
}

describe("T-B1: the Settings card lists the providers", () => {
  it("no provider: the empty line and an enabled Add provider", async () => {
    const html = await card(await providers({ success: true, identity_provider: null }));
    const t = text(html);
    expect(html).toContain('id="sign-in-providers"');
    expect(t).toContain("Sign-in providers");
    expect(t).toContain(
      "Let members sign in with an outside account, such as Google or Microsoft Entra ID."
    );
    expect(t).toContain("No sign-in provider yet. Members sign in with a password.");
    expect(html).toMatch(
      /<a[^>]*href="\/org-admin\/settings\/sign-in-providers\/new"[^>]*>Add provider<\/a>/
    );
    expect(t).not.toContain("This edition supports one sign-in provider.");
  });

  it("one provider: every column, the redirect URI with Copy, and Edit and Remove…", async () => {
    const html = await card(await providers({ success: true, identity_provider: WIRE }));
    const t = text(html);
    for (const col of [
      "Name",
      "Type",
      "Short identifier",
      "Status",
      "Email domains",
      "Updated",
      "Redirect URI",
    ]) {
      expect(t).toContain(col);
    }
    expect(t).toContain("Example SSO");
    expect(t).toContain("OpenID Connect");
    expect(t).toContain("example-sso");
    expect(t).toContain("Active");
    expect(t).toContain("example.com, example.org");
    expect(t).toContain(`https://idp.example/api/v1/auth/idp/${ID}/callback`);
    expect(t).toContain("Register this address with the provider.");
    expect(html).toMatch(/<button[^>]*>Copy<\/button>/);
    expect(html).toContain(`href="/org-admin/settings/sign-in-providers/${ID}/edit"`);
    expect(html).toMatch(/<button[^>]*>Remove…<\/button>/);
  });

  it("every domain allowed reads Any domain; an inactive provider reads Inactive", async () => {
    const html = await card(
      await providers({
        identity_provider: {
          ...WIRE,
          active: false,
          config: { ...WIRE.config, email_domains: [], allow_external_domains: true },
        },
      })
    );
    expect(text(html)).toContain("Any domain");
    expect(text(html)).toContain("Inactive");
  });
});

describe("T-B2: one provider exists, so Add provider is disabled with the reason", () => {
  it("the reason is visible text, linked by aria-describedby", async () => {
    const html = await card(await providers({ identity_provider: WIRE }));
    const add = html.match(/<button[^>]*>Add provider<\/button>/)?.[0] ?? "";
    expect(add).toMatch(/disabled=""/);
    const describedBy = add.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toMatch(
      new RegExp(`id="${describedBy}"[^>]*>This edition supports one sign-in provider\\.<`)
    );
    expect(html).not.toContain('href="/org-admin/settings/sign-in-providers/new"');
  });
});

describe("T-B3: the sign-in policy in words, with a hint only when it matters", () => {
  // UI-0913-A (D2): the Change button sits next to the line, so the hint no
  // longer sends the administrator to an administrator.
  const HINT = "The sign-in page will not offer this provider until the policy allows it.";
  const NONE_HINT =
    "No provider is set up, so members cannot sign in with one yet. Add a provider.";

  it.each([
    ["local_only", "Members sign in with: password only."],
    ["mixed", "Members sign in with: password or a sign-in provider."],
    ["idp_only", "Members sign in with: a sign-in provider only."],
    [null, "The sign-in policy could not be read."],
    ["something_new", "The sign-in policy could not be read."],
  ])("%s", async (policy, line) => {
    const t = text(await card(await providers({ identity_provider: null }), policy));
    expect(t).toContain(line);
  });

  it("password only with a provider shows the hint; with none it does not", async () => {
    const t = text(await card(await providers({ identity_provider: WIRE }), "local_only"));
    expect(t).toContain(HINT);
    expect(t).not.toContain("An organization administrator can change the policy.");
    expect(
      text(await card(await providers({ identity_provider: null }), "local_only"))
    ).not.toContain("The sign-in page will not offer");
  });

  it("provider only with none shows the other hint; mixed shows neither", async () => {
    expect(text(await card(await providers({ identity_provider: null }), "idp_only"))).toContain(
      NONE_HINT
    );
    const t = text(await card(await providers({ identity_provider: WIRE }), "mixed"));
    expect(t).not.toContain("The sign-in page will not offer");
    expect(t).not.toContain("No provider is set up");
  });
});

describe("T-B4: no secret reaches the card, and its controls are exactly Add, Edit, Remove…", () => {
  it("the HTML carries no secret value and no secret field name", async () => {
    const html = await card(await providers({ identity_provider: WIRE }));
    expect(html).not.toContain(SECRET);
    for (const name of ["client_secret", "private_key", "access_token", "refresh_token"]) {
      expect(html).not.toContain(name);
    }
    expect(html).not.toContain("cid-fixture");
  });

  // UI-0913-A (D2): the sign-in policy's Change joins; it opens a panel and
  // changes nothing by itself.
  it("the mutation controls are Add provider, Change, Edit and Remove… (Copy changes nothing)", async () => {
    const html = await card(await providers({ identity_provider: WIRE }));
    const controls = [...html.matchAll(/<(a|button)\b[^>]*>([^<]*)<\/\1>/g)].map((m) => m[2]);
    expect(controls.sort()).toEqual(["Add provider", "Change", "Copy", "Edit", "Remove…"].sort());
    expect(html).not.toMatch(/<form/);
  });
});

describe("T-B5: remove in place", () => {
  it("after a removal the card says so and shows the empty list", async () => {
    h.state = { phase: "deleted" };
    const html = await card(await providers({ identity_provider: null }));
    const t = text(html);
    expect(html).toMatch(/role="status"[^>]*>[^<]*Provider removed\./);
    expect(t).toContain("No sign-in provider yet. Members sign in with a password.");
    expect(html).toContain('href="/org-admin/settings/sign-in-providers/new"');
  });

  it("a failed removal keeps the row and says so", async () => {
    h.state = { phase: "idle", error: "The provider was not removed. Try again." };
    const html = await card(await providers({ identity_provider: WIRE }));
    expect(html).toMatch(/role="alert"[^>]*>The provider was not removed\. Try again\.</);
    expect(text(html)).toContain("Example SSO");
  });

  it("the remove dialog asks plainly and offers Remove provider and Cancel", async () => {
    const { RemoveProviderDialog } = await import(
      "../app/org-admin/settings/sign-in-providers-section"
    );
    const html = renderToStaticMarkup(
      <RemoveProviderDialog
        name="Example SSO"
        pending={false}
        onCancel={() => {}}
        action={() => {}}
      />
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(text(html)).toContain("Remove Example SSO?");
    expect(text(html)).toContain(
      "Members who sign in with it will need another way to sign in. Their accounts stay."
    );
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Remove provider<\/button>/);
    expect(html).toMatch(/<button[^>]*>Cancel<\/button>/);
  });

  it("a removal the IdP refuses answers the plain line, not the server text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/organizations/current"))
          return new Response(JSON.stringify({ id: "org-1" }), { status: 200 });
        expect(init?.method).toBe("DELETE");
        return new Response(JSON.stringify({ error: "internal" }), { status: 500 });
      })
    );
    const { deleteOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    expect(await deleteOidcProviderAction({ phase: "idle" }, new FormData())).toEqual({
      phase: "idle",
      error: "The provider was not removed. Try again.",
    });
  });

  it("no provider surface asks for a reload", () => {
    const files = [
      "../app/org-admin/settings/sign-in-providers-section.tsx",
      "../app/org-admin/settings/sign-in-providers/provider-form.tsx",
      "../app/org-admin/settings/sign-in-providers/actions.ts",
      "../app/org-admin/settings/sign-in-providers/new/page.tsx",
      "../app/org-admin/settings/sign-in-providers/[id]/edit/page.tsx",
      "../app/org-admin/identity-provider/page.tsx",
    ];
    for (const f of files) {
      expect(readFileSync(resolve(__dirname, f), "utf8"), f).not.toMatch(/Reload the page/i);
    }
  });
});

describe("T-B6: the saved or updated line shows once on Settings", () => {
  function memoryStorage() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }

  it("saved and updated each give their line once; a second read gives nothing", async () => {
    const { rememberProviderResult, takeProviderResult } = await import(
      "../app/org-admin/settings/sign-in-providers/result-flash"
    );
    const s = memoryStorage();
    rememberProviderResult(s, "saved");
    expect(takeProviderResult(s)).toBe("Provider saved.");
    expect(takeProviderResult(s)).toBeNull();
    rememberProviderResult(s, "updated");
    expect(takeProviderResult(s)).toBe("Provider updated.");
    expect(takeProviderResult(s)).toBeNull();
  });

  it("an unknown stored value shows nothing", async () => {
    const { takeProviderResult } = await import(
      "../app/org-admin/settings/sign-in-providers/result-flash"
    );
    const s = memoryStorage();
    s.setItem("identuum.sign-in-providers.result", "<script>");
    expect(takeProviderResult(s)).toBeNull();
  });

  it("the card shows a remembered line as a status", async () => {
    const html = renderToStaticMarkup(
      await (async () => {
        const { SignInProvidersSection } = await import(
          "../app/org-admin/settings/sign-in-providers-section"
        );
        return (
          <SignInProvidersSection
            result={await providers({ identity_provider: WIRE })}
            authPolicy="mixed"
            publicBase="https://idp.example"
            initialResult="Provider saved."
          />
        );
      })()
    );
    expect(html).toMatch(/role="status"[^>]*>[^<]*Provider saved\./);
  });
});

describe("T-B7: the Add and Edit pages", () => {
  const ORG = { id: "org-1", name: "Acme" };

  it("a save the IdP refuses keeps the typed values and names the reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/organizations/current"))
          return new Response(JSON.stringify(ORG), { status: 200 });
        return new Response(JSON.stringify({ error: "issuer discovery failed" }), { status: 400 });
      })
    );
    const { saveOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      name: "Example SSO",
      slug: "example-sso",
      issuer_url: "https://accounts.example",
      client_id: "cid-fixture",
      client_secret: SECRET,
      email_domains: "example.com",
    }))
      fd.set(k, v);
    const state = await saveOidcProviderAction({ phase: "idle" }, fd);
    expect(state).toMatchObject({
      phase: "idle",
      error: "The provider was not saved: issuer discovery failed.",
    });
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it("a second provider refused with 409 says to edit or remove the first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/organizations/current"))
          return new Response(JSON.stringify(ORG), { status: 200 });
        return new Response(JSON.stringify({ error: "already exists" }), { status: 409 });
      })
    );
    const { saveOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      name: "n",
      slug: "s",
      issuer_url: "https://i.example",
      client_id: "c",
      client_secret: SECRET,
      email_domains: "example.com",
    }))
      fd.set(k, v);
    expect(await saveOidcProviderAction({ phase: "idle" }, fd)).toMatchObject({
      error: "This organization already has a sign-in provider. Edit or remove it first.",
    });
  });

  it("a successful save says which result to show on Settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/organizations/current"))
          return new Response(JSON.stringify(ORG), { status: 200 });
        return new Response(JSON.stringify({ identity_provider: WIRE }), { status: 200 });
      })
    );
    const { saveOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      mode: "update",
      name: "n",
      slug: "s",
      issuer_url: "https://i.example",
      client_id: "c",
      email_domains: "example.com",
    }))
      fd.set(k, v);
    expect(await saveOidcProviderAction({ phase: "idle" }, fd)).toEqual({
      phase: "saved",
      result: "updated",
    });
  });

  it("the form has Cancel back to Settings and the new create note", async () => {
    const { ProviderForm } = await import(
      "../app/org-admin/settings/sign-in-providers/provider-form"
    );
    const html = renderToStaticMarkup(<ProviderForm provider={null} publicBase="" />);
    expect(text(html)).toContain(
      "After you save, the redirect URI appears in the list on the Settings page."
    );
    expect(html).toMatch(/<a[^>]*href="\/org-admin\/settings#sign-in-providers"[^>]*>Cancel<\/a>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save provider<\/button>/);
    expect(html).not.toContain("Remove provider");
  });
});
