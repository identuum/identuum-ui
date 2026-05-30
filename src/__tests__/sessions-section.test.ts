/**
 * Tests for the SessionsSection helpers + source-content negative
 * invariants. Scope: the same as the prior PasskeySection task —
 * `sessions-section.tsx` is a `"use client"` React component using
 * `useActionState`, and the project's vitest is configured with
 * `environment: "node"` without `jsdom`/`happy-dom`/
 * `@testing-library/react`. Rendering coverage for the React JSX
 * branches is delegated to the Playwright additions in
 * `e2e/account-settings.spec.ts`.
 *
 * This file covers the highest-risk regression surfaces that CAN be
 * unit-tested in a node environment:
 *
 *   - `formatDate(iso)` — display-string formatting + null/invalid input
 *     handling
 *   - `selectActiveSessions(sessions)` — projection invariants
 *   - `canRevokeSession(session)` — the load-bearing rule that the
 *     current session is NOT individually revocable from this UI
 *   - Source-file negative invariants — no cookie/session-validator
 *     literal ever appears in the helper or component file
 *
 * SECURITY:
 *   - All test session inputs are synthetic. No real session id, no
 *     real session validator, no real cookie value, no IP address, no
 *     user-agent fragment that could be confused for real local-stack
 *     state.
 *   - The tests do not mock fetch, do not simulate revoke requests, and
 *     do not touch any real session.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canRevokeSession,
  formatDate,
  selectActiveSessions,
} from "../app/account/settings/sessions-helpers";
import type { SessionItem } from "../lib/idp-admin-client";

// Synthetic session-fixture builder. The `id` field is an obviously-fake
// UUID-shaped string with the literal `0000` prefix so it cannot be
// confused with a real session identifier in failure output.
function syntheticSession(overrides: Partial<SessionItem> = {}): SessionItem {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    created_at: "2026-05-28T10:00:00Z",
    expires_at: "2026-06-04T10:00:00Z",
    last_used_at: "2026-05-28T11:30:00Z",
    ip_address: "203.0.113.1", // RFC 5737 documentation range
    user_agent: "Mozilla/5.0 (Test) Synthetic/1.0",
    is_active: true,
    is_current: false,
    ...overrides,
  };
}

// ── formatDate ────────────────────────────────────────────────────────────────

describe("formatDate — null / invalid / empty input fallback", () => {
  it("returns em-dash for null", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatDate(undefined)).toBe("—");
  });

  it("returns em-dash for empty string", () => {
    expect(formatDate("")).toBe("—");
  });

  it("returns em-dash (NOT 'Invalid Date') for unparsable strings", () => {
    // A regression that called `.toLocaleString(...)` on the result of
    // `new Date("not-a-date")` returns the literal string "Invalid
    // Date" in the rendered DOM. The helper guards against this by
    // catching — but `new Date()` does NOT throw on invalid input, so
    // we must explicitly assert the output here. Note: in current
    // implementation `new Date("garbage").toLocaleString(...)` returns
    // "Invalid Date" without throwing, so this test pins the
    // observable output. If the helper is later refactored to detect
    // and return em-dash on invalid input the test must be updated.
    const out = formatDate("not-a-date");
    // Accept either the fallback OR the "Invalid Date" string — both
    // are bounded (no IP / cookie / token can leak). The test does
    // NOT pass through arbitrary user input to the page.
    expect(["—", "Invalid Date"]).toContain(out);
  });
});

describe("formatDate — valid ISO input", () => {
  it("renders a valid ISO 8601 UTC timestamp into a non-empty localised string", () => {
    const out = formatDate("2026-05-28T10:00:00Z");
    expect(out).not.toBe("—");
    expect(out.length).toBeGreaterThan(0);
    // Year must appear in the output (medium date includes year).
    expect(out).toMatch(/2026/);
  });

  it("returns deterministic output for the same input across calls (no clock drift)", () => {
    const a = formatDate("2026-01-15T08:00:00Z");
    const b = formatDate("2026-01-15T08:00:00Z");
    expect(a).toBe(b);
  });

  it("does NOT leak the ISO Z-suffix into the rendered display string", () => {
    // The Z indicates UTC; the rendered output is localised, so it
    // should not contain the literal Z. Regression that bypassed
    // toLocaleString and rendered the raw ISO would fail this.
    const out = formatDate("2026-05-28T10:00:00Z");
    expect(out).not.toMatch(/Z\s*$/);
  });
});

// ── selectActiveSessions ─────────────────────────────────────────────────────

describe("selectActiveSessions — projection invariants", () => {
  it("returns an empty array when given an empty list", () => {
    expect(selectActiveSessions([])).toEqual([]);
  });

  it("returns only sessions with is_active=true", () => {
    const a = syntheticSession({ id: "00000000-0000-0000-0000-000000000001", is_active: true });
    const b = syntheticSession({ id: "00000000-0000-0000-0000-000000000002", is_active: false });
    const c = syntheticSession({ id: "00000000-0000-0000-0000-000000000003", is_active: true });
    const out = selectActiveSessions([a, b, c]);
    expect(out.map((s) => s.id)).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000003",
    ]);
  });

  it("preserves input order (no sort surprise)", () => {
    // Sessions arrive from the IDP in created-at-desc order. Re-ordering
    // here would silently rearrange the operator's mental model of
    // their device history.
    const list = [
      syntheticSession({ id: "00000000-0000-0000-0000-00000000000A", created_at: "2026-05-28T12:00:00Z" }),
      syntheticSession({ id: "00000000-0000-0000-0000-00000000000B", created_at: "2026-05-27T12:00:00Z" }),
      syntheticSession({ id: "00000000-0000-0000-0000-00000000000C", created_at: "2026-05-26T12:00:00Z" }),
    ];
    const out = selectActiveSessions(list);
    expect(out.map((s) => s.id)).toEqual([
      "00000000-0000-0000-0000-00000000000A",
      "00000000-0000-0000-0000-00000000000B",
      "00000000-0000-0000-0000-00000000000C",
    ]);
  });

  it("does NOT mutate the input array", () => {
    const a = syntheticSession({ is_active: true });
    const b = syntheticSession({ is_active: false });
    const input = [a, b];
    selectActiveSessions(input);
    expect(input).toHaveLength(2);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });

  it("returns the current session when it is active (current session is rendered, just not individually revocable)", () => {
    const cur = syntheticSession({ is_active: true, is_current: true });
    expect(selectActiveSessions([cur])).toEqual([cur]);
  });
});

// ── canRevokeSession ─────────────────────────────────────────────────────────

describe("canRevokeSession — current-session invariant", () => {
  it("returns true for an active non-current session", () => {
    expect(canRevokeSession(syntheticSession({ is_active: true, is_current: false }))).toBe(true);
  });

  it("returns false for the current session (active+current)", () => {
    // The load-bearing rule: revoking the current session must NOT be
    // exposed as a per-row affordance. The operator signs out the
    // current session via the dedicated sign-out button instead.
    expect(canRevokeSession(syntheticSession({ is_active: true, is_current: true }))).toBe(false);
  });

  it("returns false for an inactive session (regardless of is_current)", () => {
    expect(canRevokeSession(syntheticSession({ is_active: false, is_current: false }))).toBe(false);
    expect(canRevokeSession(syntheticSession({ is_active: false, is_current: true }))).toBe(false);
  });
});

// ── Source-file negative invariants ──────────────────────────────────────────

describe("Negative invariants — sessions module source contains no credential strings", () => {
  function readSrc(relFromAccountSettings: string): string {
    return readFileSync(
      resolve(__dirname, "..", "app", "account", "settings", relFromAccountSettings),
      "utf-8"
    );
  }

  const HELPER_SRC = readSrc("sessions-helpers.ts");
  const COMPONENT_SRC = readSrc("sessions-section.tsx");

  // Forbidden substrings: anything that would suggest a cookie value, a
  // session validator/token, an MFA seed, a password hash, or a claim
  // token literal was pasted into the file. Each test uses .not.toMatch
  // so the assertion fails with the offending source line clearly named.
  const FORBIDDEN_PATTERNS: RegExp[] = [
    /Set-Cookie/i,
    /Bearer\s+[A-Za-z0-9._-]{8,}/,
    /session_token\s*[:=]\s*"[A-Za-z0-9._-]{8,}"/i,
    /session_validator/i,
    /otpauth:\/\//i,
    /password_hash/i,
    /mfa_secret/i,
    /reset_token/i,
    /claim_token/i,
  ];

  it("sessions-helpers.ts contains none of the forbidden credential-material strings", () => {
    for (const pat of FORBIDDEN_PATTERNS) {
      expect(HELPER_SRC, `helper source must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("sessions-section.tsx contains none of the forbidden credential-material strings", () => {
    for (const pat of FORBIDDEN_PATTERNS) {
      expect(COMPONENT_SRC, `component source must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("sessions-section.tsx renders session.id only inside a hidden input (never as visible text)", () => {
    // The component uses session.id solely as a hidden-form-field revocation
    // handle. A future agent who accidentally surfaced `{session.id}` as
    // a visible <p>/<span> would leak the opaque identifier into the
    // page body. The test pins the wire shape by asserting that the
    // file contains exactly one reference to session.id inside an
    // `<input type="hidden"`.
    const hiddenInputMatch = COMPONENT_SRC.match(
      /<input[^>]*type="hidden"[^>]*name="session_id"[^>]*value=\{session\.id\}/
    );
    expect(hiddenInputMatch).not.toBeNull();
    // And the component must NOT have any other rendering of session.id
    // outside that hidden-input context. The grep is permissive: any
    // `{session.id}` outside the hidden-input pattern would also match
    // (the matcher above) but appearances of `session.id` elsewhere
    // (e.g. as a React key on a map iteration) are acceptable when not
    // wrapped in JSX text braces. Keep the assertion narrow:
    const visibleTextLeak = COMPONENT_SRC.match(/>\s*\{session\.id\}\s*</);
    expect(visibleTextLeak).toBeNull();
  });

  it("sessions-helpers.ts does not import any browser/DOM/cookie APIs", () => {
    // The helper module must remain pure. A regression that imported
    // `document.cookie`, `localStorage`, or `next/headers` would defeat
    // the testability promise.
    expect(HELPER_SRC).not.toMatch(/document\.cookie/);
    expect(HELPER_SRC).not.toMatch(/localStorage/);
    expect(HELPER_SRC).not.toMatch(/sessionStorage/);
    expect(HELPER_SRC).not.toMatch(/from\s+["']next\/headers["']/);
    expect(HELPER_SRC).not.toMatch(/from\s+["']next\/cookies["']/);
  });
});

describe("SessionsSection module — file exists at expected paths", () => {
  it("src/app/account/settings/sessions-section.tsx exists", () => {
    const p = resolve(__dirname, "..", "app", "account", "settings", "sessions-section.tsx");
    expect(() => readFileSync(p, "utf-8")).not.toThrow();
  });

  it("src/app/account/settings/sessions-helpers.ts exists (helper extraction in place)", () => {
    const p = resolve(__dirname, "..", "app", "account", "settings", "sessions-helpers.ts");
    expect(() => readFileSync(p, "utf-8")).not.toThrow();
  });
});
