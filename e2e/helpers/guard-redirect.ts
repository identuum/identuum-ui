/**
 * UI-0912-A (UI019): the route guards send a visitor who presented NO
 * credential to the plain sign-in page, and keep `?reason=session_expired`
 * for a credential that was presented and refused (src/lib/session-guard.ts).
 *
 * `addDeadAccessCookie` gives the browser an access cookie the IdP refuses,
 * so a spec can prove the expiry banner is still shown when it is true. The
 * value is a fixed placeholder, not a token.
 */
import type { Page } from "@playwright/test";

export async function addDeadAccessCookie(page: Page, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("addDeadAccessCookie needs the project's baseURL");
  await page
    .context()
    .addCookies([{ name: "access_token", value: "dead-access-cookie-placeholder", url: baseURL }]);
}

/** The sign-in page without any reason banner parameter. */
export function isPlainLogin(url: string): boolean {
  const u = new URL(url);
  return u.pathname === "/login" && !u.searchParams.has("reason");
}
