/**
 * Plain words for the sign-in provider actions, kept out of actions.ts
 * because a "use server" module exports only async functions.
 */

/**
 * A save the IdP refused (COPY B-30, B-34). The IdP's own sentence names the
 * field problem (it is fixed and secret-free); 409 is the one-provider limit.
 */
export function saveRefused(status: number, reason: string): string {
  if (status === 409) {
    return "This organization already has a sign-in provider. Edit or remove it first.";
  }
  const clause = reason.replace(/[.\s]+$/, "");
  // "The IdP is…" reads "the IdP is…" mid-sentence; "IdP" itself stays, and
  // so does a leading proper noun such as "Google" (U7): only a common
  // sentence opener is lowered.
  const lowered = /^(The|A|An|This|That|It|No|Your)\b/.test(clause)
    ? clause.charAt(0).toLowerCase() + clause.slice(1)
    : clause;
  return `The provider was not saved: ${lowered}.`;
}

/**
 * Why the organization's only active provider cannot be removed while
 * members can only sign in with a provider (owner Q-B3 a). The card shows it
 * before the click; a 409 last_active_identity_provider reads the same.
 */
export const LAST_PROVIDER_TEXT =
  "This is the only active sign-in provider, and members can only sign in with a provider. Change the sign-in policy first, or add another provider.";

/** The three sign-in policies the organization's administrator can choose (D2). */
export const AUTH_POLICIES = ["local_only", "mixed", "idp_only"] as const;
export type AuthPolicy = (typeof AUTH_POLICIES)[number];

/**
 * A sign-in policy change the IdP refused (D2). A 400 carries the IdP's own
 * plain sentence (no_active_identity_provider and the others); nothing on
 * the server changed in any of these cases.
 */
export function authPolicyRefused(r: { status: number; message?: string; code?: string }): string {
  if (r.status === 403) return "Only an administrator of this organization can change this.";
  if (r.status === 400) {
    if (r.message) return r.message;
    if (r.code === "no_active_identity_provider") return "Add a sign-in provider first.";
    return "The sign-in policy was not saved. Nothing was changed.";
  }
  if (r.status === 0 || r.status >= 500) return "The server did not answer. Nothing was changed.";
  return "The sign-in policy was not saved. Nothing was changed. Try again.";
}
