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
 * safe `SessionItem` metadata from the OSS /me session list.
 */

import type { SessionItem } from "@/lib/idp-account-client";

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
 * Returns true when a session row should expose a per-row revoke action.
 * The OSS /me session list deliberately does not return session IDs, so
 * account settings uses the dedicated current / others / all actions instead.
 */
export function canRevokeSession(_session: SessionItem): boolean {
  return false;
}
