import type { OrgConfig } from "@/lib/types";

/** Where the email step goes after the organization lookup. */
export type LoginRoute =
  | { kind: "password" }
  | { kind: "sso"; loginUrl: string }
  | { kind: "select" };

/**
 * The email step's route. The lookup is a ROUTING OPTIMIZATION keyed on the
 * domain; the backend enforces auth_policy at the login endpoint itself.
 *
 * `passwordChosen` is the person's own "Administrator? Sign in with password"
 * choice. Under idp_only administrators keep password sign-in
 * (IsLocalCredentialFlowAllowed), but the lookup cannot tell an administrator
 * from a member, so the choice is offered to every address alike and the
 * server decides: a member's password answers invalid credentials.
 */
export function routeAfterLookup(
  found: OrgConfig | null,
  email: string,
  passwordChosen: boolean
): LoginRoute {
  if (!found || passwordChosen) return { kind: "password" };

  const emailDomain = email.includes("@") ? email.split("@")[1].toLowerCase() : "";
  const matched = emailDomain
    ? found.identity_providers?.find((idp) => idp.email_domains?.includes(emailDomain))
    : undefined;

  if (found.auth_policy === "idp_only") {
    if (found.identity_providers && found.identity_providers.length === 1) {
      return { kind: "sso", loginUrl: found.identity_providers[0].login_url };
    }
    if (found.identity_providers && found.identity_providers.length > 1) {
      if (matched) return { kind: "sso", loginUrl: matched.login_url };
      return { kind: "select" };
    }
  }

  if (found.auth_policy === "mixed" && found.identity_providers?.length) {
    if (matched) return { kind: "sso", loginUrl: matched.login_url };
    return { kind: "select" };
  }

  return { kind: "password" };
}
