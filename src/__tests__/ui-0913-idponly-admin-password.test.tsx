/**
 * OSS-0913-IDPONLY-ADMIN-FIX (acceptance row V0913-012): under the sign-in
 * policy "sign-in provider only" (idp_only) members sign in only through the
 * provider, and administrators still sign in with a password (OPERATOR-GUIDE
 * "Members who sign in only with a provider"; the policy panel's
 * "Members cannot use a password; administrators still can."; server
 * IsLocalCredentialFlowAllowed). Before this fix the console sent every
 * address of an idp_only domain with one provider straight to the provider,
 * so a broken provider locked the administrator out.
 *
 * The organization lookup knows the domain only, never the address's role, so
 * the console cannot tell an administrator from a member, and must not try:
 * the email step offers "Administrator? Sign in with password" to every
 * address alike, and the server decides (a member's correct password answers
 * the same invalid-credentials error as a wrong one).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { routeAfterLookup } from "@/lib/login-route";
import type { OrgConfig } from "@/lib/types";

vi.mock("server-only", () => ({}));

const IDP = "/api/v1/auth/idp/0190a000-0000-7000-8000-000000000001/login";
const IDP2 = "/api/v1/auth/idp/0190a000-0000-7000-8000-000000000002/login";

const acme = (over: Partial<OrgConfig> = {}): OrgConfig => ({
  slug: "acme",
  name: "Acme",
  auth_policy: "idp_only",
  identity_providers: [{ id: "p1", type: "oidc", name: "Acme SSO", login_url: IDP }],
  ...over,
});

const ADMIN_LINK = "Administrator? Sign in with password";

describe("idp_only: members go to the provider, an administrator can choose the password", () => {
  it("Continue under idp_only with one provider still goes to the provider", () => {
    expect(routeAfterLookup(acme(), "member@acme.example", false)).toEqual({
      kind: "sso",
      loginUrl: IDP,
    });
  });

  it("the password choice under idp_only reaches the password step", () => {
    expect(routeAfterLookup(acme(), "admin@acme.example", true)).toEqual({ kind: "password" });
    const two = acme({
      identity_providers: [
        { id: "p1", type: "oidc", name: "One", login_url: IDP, email_domains: ["acme.example"] },
        { id: "p2", type: "oidc", name: "Two", login_url: IDP2 },
      ],
    });
    expect(routeAfterLookup(two, "admin@acme.example", true)).toEqual({ kind: "password" });
    expect(routeAfterLookup(acme({ auth_policy: "mixed" }), "a@acme.example", true)).toEqual({
      kind: "password",
    });
  });

  it("the routes of the other policies are unchanged", () => {
    const two = acme({
      identity_providers: [
        { id: "p1", type: "oidc", name: "One", login_url: IDP, email_domains: ["acme.example"] },
        { id: "p2", type: "oidc", name: "Two", login_url: IDP2 },
      ],
    });
    expect(routeAfterLookup(two, "m@acme.example", false)).toEqual({ kind: "sso", loginUrl: IDP });
    expect(routeAfterLookup(two, "m@other.example", false)).toEqual({ kind: "select" });
    expect(routeAfterLookup(acme({ auth_policy: "mixed" }), "m@other.example", false)).toEqual({
      kind: "select",
    });
    expect(routeAfterLookup(acme({ auth_policy: "local_only" }), "m@acme.example", false)).toEqual({
      kind: "password",
    });
    expect(routeAfterLookup(null, "m@acme.example", false)).toEqual({ kind: "password" });
  });

  it("the route depends on the domain and the person's choice only, never on who the address is", () => {
    for (const chosen of [false, true]) {
      expect(routeAfterLookup(acme(), "admin@acme.example", chosen)).toEqual(
        routeAfterLookup(acme(), "member@acme.example", chosen)
      );
    }
  });

  it("the email step offers the administrator's password choice before any lookup", async () => {
    const { LoginFlow } = await import("@/components/auth/login-flow");
    const html = renderToStaticMarkup(<LoginFlow onSuccess={() => {}} />);
    expect(html).toContain(ADMIN_LINK);
    expect(html).toMatch(
      /<button[^>]*type="button"[^>]*>[^<]*Administrator\? Sign in with password/
    );
  });

  it("Continue never passes the password choice (handleSubmit's second argument is the event)", () => {
    const src = readFileSync(resolve(__dirname, "../components/auth/login-flow.tsx"), "utf8");
    expect(src).toContain("onSubmit={handleSubmit((d) => onEmailSubmit(d))}");
    expect(src).not.toContain("handleSubmit(onEmailSubmit)");
  });
});
