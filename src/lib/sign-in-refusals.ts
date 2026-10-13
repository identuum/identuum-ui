/**
 * A provider sign-in the IdP refused, in plain words (UI-0913-A; O19, D7).
 *
 * OSS sends a refused upstream callback back to the sign-in page with its
 * reason code (owner Q-A1 a, OSS-0913-A), and the sign-in reason banner shows
 * these words. An unknown code shows nothing, never the raw code. The keys
 * are OSS's closed list of eight (OSS ef4ced9, unchanged at 3e1fa09).
 */
const UPSTREAM_REFUSALS: Record<string, string> = {
  sign_in_failed: "Sign-in with the provider did not work. Try again.",
  sign_in_expired: "The sign-in took too long or was already used. Start again.",
  sign_in_not_permitted: "Your account cannot sign in this way. Ask your administrator for help.",
  email_not_shared: "The sign-in provider did not share your email address.",
  invitation_pending: "Accept your invitation first. Use the link in your invitation email.",
  registration_pending: "Your account is waiting for an administrator's approval.",
  provider_unavailable: "The sign-in provider could not be reached. Try again in a moment.",
  sign_in_unavailable: "Sign-in is not available right now. Try again in a moment.",
};

export function upstreamRefusalText(code: string | null): string | null {
  if (!code || !Object.hasOwn(UPSTREAM_REFUSALS, code)) return null;
  return UPSTREAM_REFUSALS[code];
}
