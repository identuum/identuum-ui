// target: src/__tests__/ui-0913-a-screens.test.tsx
/**
 * UI-0913-A red-first (prep, UI-0913-AB-PREP; read at identuum-ui 5577201).
 * Screen-level pins for D2 (incl. Q-B3), O19/D7 words, Q7 and D10-UI.
 * Names marked "proposed" do not exist at 5577201; the writer may rename them
 * and keep the assertion. SECURITY: fixtures only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: { phase: "idle" } as unknown,
  pathname: "/account/settings",
  tab: "passkeys" as string | null,
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
  getServerSession: async () => ({ role: "org_admin", user: { role: "org_admin" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(h.tab ? `tab=${h.tab}` : ""),
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useActionState: () => [h.state, () => {}, false],
}));

afterEach(() => {
  vi.unstubAllGlobals();
  h.state = { phase: "idle" };
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

const WIRE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Example SSO",
  slug: "example-sso",
  type: "oidc",
  active: true,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-02T10:00:00Z",
  config: { issuer_url: "https://accounts.example", client_id: "cid", scopes: ["openid"] },
};

async function card(provider: unknown, authPolicy: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ identity_provider: provider }), { status: 200 })
    )
  );
  const { listOrganizationIdentityProviders } = await import("@/lib/idp-admin-client");
  const result = await listOrganizationIdentityProviders("org-1");
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

describe("D2: the policy line and the old hint (item 2)", () => {
  it("'' reads as the permissive default, not 'could not be read'", async () => {
    const { policyLine } = await import("../app/org-admin/settings/sign-in-providers-section");
    expect(policyLine("")).toBe("Members sign in with: password or a sign-in provider (default).");
  });

  it("the hint no longer tells the administrator to ask an administrator", async () => {
    const { policyHint } = await import("../app/org-admin/settings/sign-in-providers-section");
    expect(policyHint("local_only", 1) ?? "").not.toContain(
      "An organization administrator can change the policy."
    );
  });

  it("the card offers a Change control for the policy", async () => {
    const html = await card(WIRE, "mixed");
    expect(html).toMatch(/<button\b[^>]*>Change<\/button>/);
  });
});

describe("Q-B3: under provider-only the provider's Remove explains before the click", () => {
  const WHY =
    "This is the only active sign-in provider, and members can only sign in with a provider. Change the sign-in policy first, or add another provider.";
  it("idp_only with its one provider shows the explanation", async () => {
    expect(text(await card(WIRE, "idp_only"))).toContain(WHY);
  });
  it("control: mixed does not show it", async () => {
    expect(text(await card(WIRE, "mixed"))).not.toContain(WHY);
  });
  it("a 409 last_active_identity_provider on remove reads the same words", async () => {
    // proposed: the remove action maps the OSS 409 to WHY (today: "not removed").
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "DELETE") {
          return new Response(
            JSON.stringify({ error: "last_active_identity_provider", message: "x" }),
            { status: 409 }
          );
        }
        return new Response(
          JSON.stringify({ organization: { id: "org-1", auth_policy: "idp_only" } }),
          { status: 200 }
        );
      })
    );
    const { deleteOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    const out = (await deleteOidcProviderAction({ phase: "idle" }, new FormData())) as {
      error?: string;
    };
    expect(out.error).toBe(WHY);
  });
});

describe("O19 and D7: the sign-in refusals in plain words (item 2a)", () => {
  it.each([
    ["invitation_pending", "Accept your invitation first. Use the link in your invitation email."],
    ["registration_pending", "Your account is waiting for an administrator's approval."],
    ["email_not_shared", "The sign-in provider did not share your email address."],
  ])("%s", async (code, words) => {
    // proposed module and export; the mapping point itself is QUESTION Q-A1.
    const mod = (await import("../lib/sign-in-refusals")) as {
      upstreamRefusalText: (c: string) => string | null;
    };
    expect(mod.upstreamRefusalText(code)).toBe(words);
  });
});

describe("Q7: the org_admin account page offers the verification row (item 4)", () => {
  it("account settings renders the Send verification email row for org_admin", () => {
    // Source pin: the page renders the member Overview's shared row
    // (EmailStatus, which holds SendVerificationEmail). The per-role render
    // tests are in ui-0913-a-writer.test.tsx.
    expect(src("src/app/account/settings/page.tsx")).toMatch(/<EmailStatus\b/);
  });
});

describe("D10-UI (item 5)", () => {
  it("U5: a 404 from a server without the route is not 'removed'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) =>
        (init?.method ?? "GET") === "DELETE"
          ? new Response("404 page not found", { status: 404 })
          : new Response(JSON.stringify({ organization: { id: "org-1" } }), { status: 200 })
      )
    );
    const { deleteOidcProviderAction } = await import(
      "../app/org-admin/settings/sign-in-providers/actions"
    );
    const out = (await deleteOidcProviderAction({ phase: "idle" }, new FormData())) as {
      phase: string;
    };
    expect(out.phase).not.toBe("deleted");
  });

  it("U6: the 403 organization read does not blame only the sign-in settings", async () => {
    const { orgReadFailure } = await import("../app/org-admin/settings/sign-in-providers/org-read");
    expect(orgReadFailure("forbidden")).not.toContain("sign-in settings");
  });

  it("U10: the member menu marks an item for the passkeys tab", async () => {
    h.pathname = "/account/settings";
    h.tab = "passkeys";
    const { MemberNav } = await import("../components/shared/member-nav");
    expect(renderToStaticMarkup(<MemberNav />)).toContain('aria-current="page"');
  });

  it("U14: types.ts no longer says approval sets email_verified", () => {
    expect(src("src/lib/types.ts")).not.toMatch(
      /and email_verified to true\) only for role=org_user/
    );
  });

  it("U15: the BFF renewal list does not name token_expired", () => {
    expect(src("export/src/bff.ts")).not.toMatch(/"token_expired"/);
  });
});
