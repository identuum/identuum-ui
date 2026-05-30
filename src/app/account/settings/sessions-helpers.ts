/**
 * Pure helpers extracted from `sessions-section.tsx` so they can be
 * unit-tested in the project's node-only vitest environment without
 * adding `jsdom` / `happy-dom` / `@testing-library/react` dev-deps.
 *
 * The originals were file-private functions inside the client
 * component. Behaviour is byte-identical to the inline versions; the
 * component imports these.
 *
 * SECURITY: these helpers manipulate display strings only. They do NOT
 * accept session IDs, session validators, cookies, or any opaque
 * authentication state — the only inputs are ISO timestamp strings and
 * `SessionItem` objects whose `id` field is the revocation handle (kept
 * out of rendered text by the caller).
 */

import type { SessionItem } from "@/lib/idp-admin-client";

/**
 * Renders an ISO-8601 timestamp string into a localised "medium" date +
 * "short" time pair. Returns the em-dash `—` for nullish or unparsable
 * input. Behaviour pinned by tests:
 *   - `null` / `undefined` / empty string → `—`
 *   - invalid date string → `—`
 *   - valid ISO → `new Date(iso).toLocaleString("en-US", …)` output
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

/**
 * Returns the subset of session items the SessionsSection actually
 * renders. The IDP returns both active and recently-expired/revoked
 * sessions in a single list; the UI shows only the currently-active
 * rows. Centralising this filter makes the invariant testable and
 * prevents a future agent from accidentally rendering revoked sessions.
 *
 * Empty input → empty output. The function does NOT mutate the input.
 */
export function selectActiveSessions(sessions: ReadonlyArray<SessionItem>): SessionItem[] {
  return sessions.filter((s) => s.is_active);
}

/**
 * Returns true when the session row should show an individual "Sign out"
 * revoke button. The current session is intentionally NOT revocable
 * from this surface — revoking the active session is a sign-out, which
 * has its own UI affordance elsewhere. Centralising this rule prevents
 * a future "be consistent" edit from accidentally allowing the operator
 * to sign-out-the-current-session via the per-row button (which would
 * surface as a confusing "Signed out." marker on the same page).
 */
export function canRevokeSession(session: SessionItem): boolean {
  return session.is_active && !session.is_current;
}
