/**
 * The one-time result line the Settings card shows after an Add or Edit page
 * saves (UI-0912-B, COPY B-20/B-21).
 *
 * The page that saved writes one word to the tab's sessionStorage and opens
 * Settings; the card reads it once and deletes it, so a reload does not
 * repeat it. A query parameter would do the same in Next, but the static
 * export keys a route by its full path and query (export/src/main.tsx), so
 * removing the parameter afterwards would rebuild the whole Settings page on
 * its next revalidation and drop every other card's result line.
 *
 * SECURITY: only the words "saved" and "updated" are ever stored; any other
 * stored value shows nothing.
 */

/** Settings, at the providers card: where Add, Edit and Cancel return to. */
export const SIGN_IN_PROVIDERS_HREF = "/org-admin/settings#sign-in-providers";

export type ProviderResult = "saved" | "updated";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "identuum.sign-in-providers.result";

const LINES: Record<ProviderResult, string> = {
  saved: "Provider saved.",
  updated: "Provider updated.",
};

export function rememberProviderResult(storage: Storage, result: ProviderResult): void {
  storage.setItem(KEY, result);
}

export function takeProviderResult(storage: Storage): string | null {
  const value = storage.getItem(KEY);
  if (value === null) return null;
  storage.removeItem(KEY);
  return value === "saved" || value === "updated" ? LINES[value] : null;
}

/** The tab's sessionStorage, or null where there is none (a server render). */
export function sessionStore(): Storage | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
