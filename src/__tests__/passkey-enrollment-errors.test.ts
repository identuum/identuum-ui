/**
 * Behavioural tests for classifyPasskeyEnrollmentError.
 *
 * The helper is pure and side-effect-free, so these tests EXECUTE
 * the function with a representative input matrix instead of
 * asserting source-text invariants. Source-text pins covering the
 * PasskeySection integration (helper imported + called, IDP message
 * never forwarded, no logging of credential payloads) live alongside
 * the existing passkey-section.test.ts source pins.
 *
 * The bug this regression-guards:
 *   - Before this slice the finish-registration HTTP failure path
 *     forwarded the IDP's raw `message` field directly into the
 *     banner. When the IDP fell into its 500 generic branch it
 *     returned "An error occurred. Please try again later." — a
 *     message that gives the operator no actionable next step. The
 *     helper now bypasses the IDP message and returns a vetted UI
 *     string with explicit operator guidance.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyPasskeyEnrollmentError,
  PASSKEY_ENROLLMENT_ERROR_COPY,
} from "../components/ui/passkey-enrollment-errors";

// ── Begin-registration HTTP failure ────────────────────────────────────────

describe("classifyPasskeyEnrollmentError — begin-registration failures", () => {
  it("maps a 403 begin status to the forbidden copy", () => {
    const err = Object.assign(new Error("begin_failed"), {
      __passkeyBeginStatus: 403,
    });
    expect(classifyPasskeyEnrollmentError(err)).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.beginForbidden);
  });

  it("maps any other non-2xx begin status to the unavailable copy", () => {
    for (const status of [400, 404, 409, 422, 429, 500, 502, 503]) {
      const err = Object.assign(new Error("begin_failed"), {
        __passkeyBeginStatus: status,
      });
      expect(
        classifyPasskeyEnrollmentError(err),
        `status ${status} must map to beginUnavailable`
      ).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.beginUnavailable);
    }
  });

  it("ignores any .message field on the begin error (no backend prose forwarding)", () => {
    // The classifier MUST NOT use the .message field. Even if a
    // begin error carries the IDP's generic 500 prose, the banner
    // string is the vetted bundle copy.
    const err = Object.assign(new Error("An error occurred. Please try again later."), {
      __passkeyBeginStatus: 500,
    });
    const copy = classifyPasskeyEnrollmentError(err);
    expect(copy).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.beginUnavailable);
    expect(copy).not.toContain("An error occurred");
  });
});

// ── DOMException from navigator.credentials.create ─────────────────────────

describe("classifyPasskeyEnrollmentError — DOMException mapping", () => {
  // jsdom is not installed in this project's vitest env (environment: "node"),
  // so we synthesise a DOMException-like value that the helper's
  // `err instanceof DOMException` check will accept. Node 16+ provides a
  // global DOMException constructor.
  function makeDomException(name: string, message = "synthetic"): DOMException {
    return new DOMException(message, name);
  }

  it("maps NotAllowedError to the cancelled copy", () => {
    expect(classifyPasskeyEnrollmentError(makeDomException("NotAllowedError"))).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyCancelled
    );
  });

  it("maps NotSupportedError to the unsupported copy", () => {
    expect(classifyPasskeyEnrollmentError(makeDomException("NotSupportedError"))).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyUnsupported
    );
  });

  it("maps InvalidStateError to the already-registered copy", () => {
    expect(classifyPasskeyEnrollmentError(makeDomException("InvalidStateError"))).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyInvalidState
    );
  });

  it("maps SecurityError to the secure-context copy", () => {
    expect(classifyPasskeyEnrollmentError(makeDomException("SecurityError"))).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.ceremonySecurity
    );
  });

  it("maps any other DOMException name to the generic copy", () => {
    expect(classifyPasskeyEnrollmentError(makeDomException("AbortError"))).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.generic
    );
    expect(classifyPasskeyEnrollmentError(makeDomException("UnknownError"))).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.generic
    );
  });
});

// ── Ceremony returned null credential ──────────────────────────────────────

describe("classifyPasskeyEnrollmentError — ceremony cancelled", () => {
  it("maps the tagged ceremony-cancelled error to the cancelled copy", () => {
    const err = Object.assign(new Error("ceremony_cancelled"), {
      __passkeyCeremonyCancelled: true as const,
    });
    expect(classifyPasskeyEnrollmentError(err)).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyCancelled
    );
  });
});

// ── Finish-registration HTTP failure ────────────────────────────────────────

describe("classifyPasskeyEnrollmentError — finish-registration failures", () => {
  it("maps a 401 finish status to the session-expired copy", () => {
    const err = Object.assign(new Error("finish_failed"), {
      __passkeyFinishStatus: 401,
    });
    expect(classifyPasskeyEnrollmentError(err)).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.finishUnauthorized
    );
  });

  it("maps any other non-2xx finish status to the unavailable copy", () => {
    for (const status of [400, 403, 404, 409, 422, 429, 500, 502, 503]) {
      const err = Object.assign(new Error("finish_failed"), {
        __passkeyFinishStatus: status,
      });
      expect(
        classifyPasskeyEnrollmentError(err),
        `status ${status} must map to finishUnavailable`
      ).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.finishUnavailable);
    }
  });

  it("BUG REGRESSION: a 500 finish status NEVER surfaces the IDP's generic prose", () => {
    // This is the exact bug the slice fixes. Before the fix, the
    // UI displayed the IDP's `message` field verbatim, which was
    // the generic 500 fallback ("An error occurred. Please try
    // again later."). The helper must classify the failure as
    // finishUnavailable WITHOUT inspecting .message.
    const err = Object.assign(new Error("An error occurred. Please try again later."), {
      __passkeyFinishStatus: 500,
    });
    const copy = classifyPasskeyEnrollmentError(err);
    expect(copy).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.finishUnavailable);
    expect(copy).not.toContain("An error occurred");
    expect(copy).toMatch(/contact your administrator/i);
  });
});

// ── Unknown / unrecognised input ───────────────────────────────────────────

describe("classifyPasskeyEnrollmentError — generic fallback", () => {
  it("returns the generic copy for a plain Error with no recognised tag", () => {
    expect(classifyPasskeyEnrollmentError(new Error("anything"))).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.generic
    );
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["string", "raw string error"],
    ["number", 42],
    ["object", { message: "raw" }],
    ["array", [1, 2]],
  ])("treats %s as generic", (_label, value) => {
    expect(classifyPasskeyEnrollmentError(value)).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.generic);
  });

  it("does NOT forward an Error.message into the banner copy", () => {
    // Defence in depth: even when the thrown value is a plain
    // Error with the IDP's generic prose, the helper returns the
    // vetted UI copy.
    const err = new Error("An error occurred. Please try again later.");
    const copy = classifyPasskeyEnrollmentError(err);
    expect(copy).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.generic);
    expect(copy).not.toContain("An error occurred");
  });
});

// ── Copy-bundle safety pins ────────────────────────────────────────────────

describe("PASSKEY_ENROLLMENT_ERROR_COPY — operator-safe content", () => {
  it("declares the nine documented keys with non-empty strings", () => {
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.beginForbidden.length).toBeGreaterThan(0);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.beginUnavailable.length).toBeGreaterThan(0);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyCancelled.length).toBeGreaterThan(0);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyUnsupported.length).toBeGreaterThan(0);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyInvalidState.length).toBeGreaterThan(0);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.ceremonySecurity.length).toBeGreaterThan(0);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.finishUnauthorized.length).toBeGreaterThan(0);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.finishUnavailable.length).toBeGreaterThan(0);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.generic.length).toBeGreaterThan(0);
  });

  it("NEVER includes the IDP's generic 500 fallback prose", () => {
    // The exact regression sentry: if a future maintainer copies
    // the IDP's message verbatim into one of the operator-facing
    // strings, this test fails.
    for (const v of Object.values(PASSKEY_ENROLLMENT_ERROR_COPY)) {
      expect(v).not.toMatch(/An error occurred\. Please try again later\./);
    }
  });

  it("NEVER names a WebAuthn credential / challenge / attestation substring", () => {
    // Defence in depth — the copy bundle must not name any field
    // from the WebAuthn ceremony payload.
    const BANNED: RegExp[] = [
      /attestationObject/i,
      /clientDataJSON/i,
      /authenticatorData/i,
      /\bsignature\b/i,
      /\bcredentialId\b/i,
      /\brawId\b/i,
      /\bpublicKey\b.*:/i,
      /\bchallenge\b.*:/i,
      /\bSet-Cookie\b/i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /otpauth:\/\//i,
      /\bmfa_secret\b/i,
      /\bpassword_hash\b/i,
    ];
    for (const v of Object.values(PASSKEY_ENROLLMENT_ERROR_COPY)) {
      for (const pat of BANNED) {
        expect(v, `copy "${v}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });
});

// ── Helper module source contract ──────────────────────────────────────────

describe("passkey-enrollment-errors.ts — source contract", () => {
  const HELPER_SRC = readFileSync(
    resolve(__dirname, "..", "components", "ui", "passkey-enrollment-errors.ts"),
    "utf-8"
  );

  it("is a pure module — no I/O, no logging, no DOM-state imports", () => {
    expect(HELPER_SRC).not.toMatch(/from\s+["']next\/headers["']/);
    expect(HELPER_SRC).not.toMatch(/from\s+["']server-only["']/);
    expect(HELPER_SRC).not.toMatch(/\bfetch\(/);
    expect(HELPER_SRC).not.toMatch(/\bconsole\./);
    expect(HELPER_SRC).not.toMatch(/from\s+["']node:/);
  });

  it("NEVER reads the .message field on its input", () => {
    // The whole point of the slice is to stop forwarding the
    // IDP's human message into the banner. A regression that
    // re-introduced .message access on the err parameter would
    // surface here.
    // Strip comments first so doc-blocks legitimately mentioning
    // the field name as a documented exclusion don't trip the
    // assertion. Real code that READS the field via `.message`
    // would survive the strip.
    const noComments = HELPER_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(noComments).not.toMatch(/\.message\b/);
  });

  it("classifies via instanceof / tag checks, not via string matching on the message text", () => {
    // No substring matching of any sort on the input.
    expect(HELPER_SRC).not.toMatch(/\.includes\(\s*["']/);
    expect(HELPER_SRC).not.toMatch(/\.startsWith\(\s*["']/);
    expect(HELPER_SRC).not.toMatch(/\.endsWith\(\s*["']/);
  });
});

// ── PasskeySection wiring pins ──────────────────────────────────────────────
//
// The component file is the only caller of the helper. A regression
// that detached it from the helper (e.g. re-inlined the IDP message
// forwarding) MUST surface here.

describe("PasskeySection — helper integration", () => {
  const SECTION_SRC = readFileSync(
    resolve(__dirname, "..", "components", "ui", "passkey-section.tsx"),
    "utf-8"
  );

  it("imports classifyPasskeyEnrollmentError from the helper module", () => {
    expect(SECTION_SRC).toMatch(
      /import\s*\{\s*classifyPasskeyEnrollmentError\s*\}\s*from\s+["']\.\/passkey-enrollment-errors["']/
    );
  });

  it("the catch block delegates banner copy to the helper (no .message forwarding, no string fallback)", () => {
    expect(SECTION_SRC).toMatch(/setError\(\s*classifyPasskeyEnrollmentError\(err\)\s*\)/);
    // Negative: the previous "errData.message" forwarding path
    // is gone.
    expect(SECTION_SRC).not.toMatch(/errData\.message/);
    expect(SECTION_SRC).not.toMatch(/setError\(\s*err\.message\s*\)/);
  });

  it("does NOT log any WebAuthn credential payload field via console.*", () => {
    expect(SECTION_SRC).not.toMatch(/console\.\w+\([^)]*attestation/i);
    expect(SECTION_SRC).not.toMatch(/console\.\w+\([^)]*clientDataJSON/i);
    expect(SECTION_SRC).not.toMatch(/console\.\w+\([^)]*rawId/i);
    expect(SECTION_SRC).not.toMatch(/console\.\w+\([^)]*credential\.id/i);
  });
});
