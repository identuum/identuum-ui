/**
 * enroll-probe-401-source-invariants.test.ts — ENROLL-PROBE-401-1
 *
 * THE-EMAILED-LINK-GATE (2026-08-27): the backend answers an
 * enrollment-required login with HTTP 401 {"error":
 * "mfa_enrollment_required", mfa_required:true, session_id} — the
 * pending session rides on a 401, not a 200 (proven live against a HEAD
 * backend in THE-DEAD-ACTIVATE-LINK). /claim's copy of the probe read
 * `if (!res.ok) return ""` and silently dropped the MFA chaining,
 * dumping a fresh admin at manual login; /activate's copy was born with
 * the fix. Exactly two copies of openPendingMFAEnrollmentSession exist
 * (activate + claim) — this pin holds the 401 tolerance in BOTH, and
 * fires on any THIRD copy that appears without it.
 *
 * Source-invariant style (no React render, no network).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const PROBE_FILES = ["app/activate/actions.ts", "app/claim/actions.ts"] as const;
const TOLERANT_GUARD = /if\s*\(!res\.ok\s*&&\s*res\.status\s*!==\s*401\)\s*return\s*""/;
const OK_ONLY_GUARD = /if\s*\(!res\.ok\)\s*return\s*""/;

describe("pending-MFA-enrollment login probes accept the measured 401 shape", () => {
  it("every copy of the probe tolerates the 401 pending-session response, and no unpinned copy exists [ENROLL-PROBE-401-1]", async () => {
    for (const rel of PROBE_FILES) {
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      expect(src, `${rel} must define the probe this pin exists for`).toMatch(
        /async function openPendingMFAEnrollmentSession/
      );
      expect(
        src,
        `${rel}: an enrollment-required login is HTTP 401 with session_id — a res.ok-only guard silently drops the MFA chaining`
      ).toMatch(TOLERANT_GUARD);
      expect(
        src,
        `${rel} must not carry the ok-only guard the 401 was measured against`
      ).not.toMatch(OK_ONLY_GUARD);
    }

    const { execFileSync } = await import("node:child_process");
    // Census spans ALL of src — a probe planted in src/lib or
    // src/components must fire too (THE-UNBOUND-STAMP: the earlier
    // src/app narrowing silenced a self-match by shrinking the census;
    // a subset without its parent is a false whole). Only the liar is
    // excluded: this test file's own regex text lives in src/__tests__.
    const copies = execFileSync(
      "git",
      ["grep", "-l", "async function openPendingMFAEnrollmentSession", "--", "src", ":!src/__tests__"],
      { cwd: resolve(ROOT, ".."), encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .sort();
    expect(
      copies,
      "a new copy of the probe must be added to PROBE_FILES so its 401 tolerance is pinned too"
    ).toEqual(PROBE_FILES.map((f) => `src/${f}`).sort());
  });
});
