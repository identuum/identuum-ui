/**
 * A provider sign-in the IdP refused, in plain words (UI-0913-A; O19, D7).
 *
 * OSS sends a refused upstream callback back to the sign-in page with its
 * reason code (owner Q-A1 a, OSS-0913-A), and the sign-in reason banner shows
 * these words. An unknown code shows nothing, never the raw code.
 */
const UPSTREAM_REFUSALS: Record<string, string> = {
  invitation_pending: "Accept your invitation first. Use the link in your invitation email.",
  registration_pending: "Your account is waiting for an administrator's approval.",
  email_not_shared: "The sign-in provider did not share your email address.",
};

export function upstreamRefusalText(code: string | null): string | null {
  if (!code || !Object.hasOwn(UPSTREAM_REFUSALS, code)) return null;
  return UPSTREAM_REFUSALS[code];
}
