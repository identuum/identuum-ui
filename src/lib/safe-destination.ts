/**
 * Destination checks for client navigation (UI-SEC-HEADERS, review L1). The
 * backend builds these URLs today; the console still refuses any it does not
 * expect, so a changed or compromised producer cannot send a browser off-site
 * or into a javascript: or data: URL.
 */

/** OSS oidcLoginURL: /api/v1/auth/idp/<provider id>/login. */
const SSO_LOGIN_PATH = /^\/api\/v1\/auth\/idp\/[^/]+\/login$/;

/**
 * The SSO initiation URL to navigate to, or null when loginUrl is not the
 * same-origin SSO initiation route. A relative loginUrl resolves against
 * origin; any other origin or scheme (javascript:, data:) is refused.
 */
export function ssoLoginDestination(loginUrl: string, origin: string): URL | null {
  if (!loginUrl) return null;
  try {
    const own = new URL(origin);
    const u = new URL(loginUrl, own);
    if (u.origin !== own.origin || !SSO_LOGIN_PATH.test(u.pathname)) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Whether an account link (an activation URL) may be shown as a link: an
 * absolute https URL, or an http URL on the console's own origin (origin is
 * undefined where no browser origin is known). Anything else is shown as
 * plain text.
 */
export function clickableAccountLink(link: string, origin: string | undefined): boolean {
  try {
    const u = new URL(link);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && origin !== undefined && u.origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
