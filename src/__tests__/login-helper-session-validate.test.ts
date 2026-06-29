/**
 * Source-invariant tests for the self-validating session-restore fast path in
 * e2e/helpers/login.ts::tryRestoreSession.
 *
 * Background (agent-a-20260705-ui-ce-license-card-settings-route-fix):
 *   The session-restore fast path trusted a recent storage-state file without
 *   checking the session was still LIVE. A saved session can be revoked
 *   server-side between runs — the passkey spec's T4 logout (POST
 *   /api/v1/logout) revokes the site_admin session, but the file written in
 *   that spec's beforeAll still holds the now-revoked cookie. Restoring it
 *   cookies-only let the revoked session sail through, so the next protected
 *   navigation (e.g. /site-admin/settings in the CE customer-smoke license-card
 *   Group 2) bounced to /login and the Settings H1 never rendered.
 *
 *   The fix probes /api/v1/validate via ctx.request after restoring cookies and
 *   falls through to a full login (clearing the stale file) when the session is
 *   dead.
 *
 * Deterministic source-file reads — no credentials, cookies, secrets, browser,
 * or network are touched.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_ROOT = resolve(import.meta.dirname, "../../");
const loginHelper = readFileSync(resolve(UI_ROOT, "e2e/helpers/login.ts"), "utf-8");

describe("tryRestoreSession — self-validating restore (no revoked-session fast path)", () => {
  it("validates the restored session against /api/v1/validate before trusting it", () => {
    expect(loginHelper).toContain('ctx.request.get("/api/idp/api/v1/validate")');
  });

  it("falls through to full login (clears cookies + stale file) when the probe is not ok", () => {
    expect(loginHelper).toContain("probe.ok()");
    expect(loginHelper).toContain("ctx.clearCookies()");
    expect(loginHelper).toContain("unlinkSync(stateFile)");
  });

  it("still keeps the freshness + cookie-presence guards (does not weaken restore)", () => {
    expect(loginHelper).toContain("SESSION_MAX_AGE_MS");
    expect(loginHelper).toContain("state.cookies?.length");
  });
});
