/**
 * Source-invariant tests for e2e/passkey-flow.spec.ts API-call origin safety.
 *
 * Background (agent-a-20260705-ui-ce-passkey-relative-fetch-baseurl-fix):
 *   T1 (clean-slate) and T4 (logout) previously issued a RELATIVE
 *   fetch("/api/idp/...") inside page.evaluate. That resolves against the
 *   page's current document origin — but the login helper's session-restore
 *   fast path (tryRestoreSession -> ctx.addCookies, no navigation) can leave
 *   the page on about:blank, where a relative fetch has no base URL and throws
 *   "Failed to parse URL". The fix routes these API calls through page.request,
 *   which resolves relative paths against the configured baseURL
 *   (IDENTUUM_E2E_BASE_URL) and shares the browser context's session cookies —
 *   origin-independent and port-agnostic (works for CE 7124 + OSS targets).
 *
 * These are deterministic source-file reads — no credentials, cookies,
 * secrets, browser, or network are touched.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_ROOT = resolve(import.meta.dirname, "../../");
const passkeySpec = readFileSync(resolve(UI_ROOT, "e2e/passkey-flow.spec.ts"), "utf-8");

describe("passkey-flow.spec.ts — origin-stable API calls (no relative in-page fetch)", () => {
  it("does NOT issue a relative in-page fetch to /api/ (which breaks on about:blank)", () => {
    // No `fetch("/api/idp...")` literal anywhere in the spec — those are
    // document-origin-dependent and fail when the login helper's fast path
    // leaves the page on about:blank.
    expect(passkeySpec).not.toMatch(/fetch\(\s*["'`]\/api\//);
  });

  it("uses page.request for the T1 clean-slate credential list + delete", () => {
    expect(passkeySpec).toContain('page.request.get("/api/idp/api/v1/webauthn/credentials")');
    expect(passkeySpec).toContain("page.request.delete(");
    expect(passkeySpec).toContain("/api/idp/api/v1/webauthn/credentials/${encodeURIComponent(");
  });

  it("unwraps BOTH the OSS bare-array and CE { credentials: [...] } envelope shapes", () => {
    // A bare Array.isArray check on the CE envelope (an object) would skip
    // deletion and leave a stale passkey, breaking T1's empty-state assertion.
    expect(passkeySpec).toContain("data?.credentials");
  });

  it("uses page.request for the T4 logout call", () => {
    expect(passkeySpec).toContain('page.request.post("/api/idp/api/v1/logout")');
  });

  it("preserves the T1 clean-slate empty-state assertion (not weakened)", () => {
    expect(passkeySpec).toContain('page.getByText("No passkeys enrolled yet.")');
  });

  it("preserves the five-test ceremony structure (T1..T5)", () => {
    for (const marker of [
      "T1 — clean slate",
      "T2 — register a passkey",
      "T3 — credential persists after page reload",
      "T4 — sign in with registered passkey",
      "T5 — delete registered passkey",
    ]) {
      expect(passkeySpec).toContain(marker);
    }
  });
});
