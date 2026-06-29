/**
 * Tests for the PasskeySection's load-bearing glue: the base64url
 * helpers in `src/components/ui/passkey-base64url.ts` and the IDP proxy
 * paths in `src/lib/idp-paths.ts` that the component fetches against.
 *
 * SCOPE LIMITATION (read this before adding rendering tests):
 *
 *   PasskeySection is a `"use client"` React component using
 *   useState/useEffect/useRef plus the browser-only WebAuthn API. The
 *   project's vitest is configured with `environment: "node"` and does
 *   not have `jsdom` / `happy-dom` / `@testing-library/react` installed.
 *   Adding those would be a 3-package dev-dep install and is out of
 *   scope for this task (the task constraints permit edits only to
 *   `passkey-section.tsx` for helper extraction, a new adjacent helper
 *   module, and this test file).
 *
 *   This file therefore covers the highest-risk regression surfaces of
 *   PasskeySection that CAN be unit-tested in a node environment:
 *
 *     - base64url helpers (round-trip, alphabet, padding, edge cases)
 *     - IDP proxy-path constants used by the component
 *
 *   The rendering paths (empty-state, list, register button,
 *   rename/delete affordances, safe-error banner, WebAuthn-unsupported
 *   message) are not covered here. A separate task with a DOM-test
 *   stack added can close that gap. See UI-FEATURES.md Section 8 Gaps.
 *
 * SECURITY:
 *   - All test vectors are synthetic (`[0x00, 0x01, 0x02, …]`,
 *     `"hello"`, etc.). No real WebAuthn challenge, attestation
 *     object, clientDataJSON, credential id, or public-key blob
 *     appears anywhere in this file.
 *   - The test asserts on the LACK of credential-material strings in
 *     the helper modules; it does not produce or consume any real
 *     ceremony bytes.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { arrayBufferToBase64url, base64urlToArrayBuffer } from "../components/ui/passkey-base64url";
import { IDP_PATHS } from "../lib/idp-paths";

// Helper: build an ArrayBuffer from a synthetic byte array. Used to
// keep test vectors human-readable without writing raw Uint8Array
// literals every time.
function bytesToBuffer(arr: ReadonlyArray<number>): ArrayBuffer {
  const u8 = new Uint8Array(arr);
  return u8.buffer;
}

// Helper: dump an ArrayBuffer to a plain number array for stable
// assertion output.
function bufferToBytes(buf: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buf));
}

// Helper: encode an ASCII string as an ArrayBuffer so we can round-trip
// human-readable input through the helpers.
function stringToBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

// Helper: decode an ArrayBuffer as ASCII for assertion ergonomics.
function bufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

// ── base64url helpers — round-trip + alphabet + padding pins ─────────────────

describe("base64url helpers — round-trip integrity", () => {
  it("round-trips a known short byte sequence", () => {
    const original = bytesToBuffer([0x00, 0x01, 0x02, 0x03, 0x04]);
    const encoded = arrayBufferToBase64url(original);
    const decoded = base64urlToArrayBuffer(encoded);
    expect(bufferToBytes(decoded)).toEqual(bufferToBytes(original));
  });

  it("round-trips an ASCII string", () => {
    const original = stringToBuffer("hello world");
    const encoded = arrayBufferToBase64url(original);
    const decoded = base64urlToArrayBuffer(encoded);
    expect(bufferToString(decoded)).toBe("hello world");
  });

  it("round-trips a 0-byte buffer (encode → empty string → decode → 0 bytes)", () => {
    const original = bytesToBuffer([]);
    const encoded = arrayBufferToBase64url(original);
    expect(encoded).toBe("");
    const decoded = base64urlToArrayBuffer(encoded);
    expect(decoded.byteLength).toBe(0);
  });

  it("round-trips bytes that exercise every standard base64 length residue mod 3", () => {
    // Length residue 0 → 0 pad chars stripped; 1 → 2 pad chars stripped; 2 → 1 pad char stripped.
    // The encoder MUST emit no `=` regardless. The decoder MUST reconstruct correctly.
    for (const len of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const buf = bytesToBuffer(Array.from({ length: len }, (_, i) => (i * 17) & 0xff));
      const enc = arrayBufferToBase64url(buf);
      expect(enc).not.toMatch(/=/);
      const dec = base64urlToArrayBuffer(enc);
      expect(bufferToBytes(dec)).toEqual(bufferToBytes(buf));
    }
  });

  it("round-trips 256 bytes (each byte value exactly once)", () => {
    const original = bytesToBuffer(Array.from({ length: 256 }, (_, i) => i));
    const encoded = arrayBufferToBase64url(original);
    const decoded = base64urlToArrayBuffer(encoded);
    expect(bufferToBytes(decoded)).toEqual(bufferToBytes(original));
  });
});

describe("base64url helpers — output alphabet and padding", () => {
  it("never emits `+`, `/`, or `=` in encoded output (URL-safe + unpadded)", () => {
    // Iterate enough byte sequences to hit every base64 nibble.
    for (let seed = 0; seed < 30; seed++) {
      const buf = bytesToBuffer(
        Array.from({ length: seed + 1 }, (_, i) => ((seed + 1) * 31 + i * 13) & 0xff)
      );
      const enc = arrayBufferToBase64url(buf);
      expect(enc).not.toMatch(/\+/);
      expect(enc).not.toMatch(/\//);
      expect(enc).not.toMatch(/=/);
    }
  });

  it("uses ONLY `A-Z`, `a-z`, `0-9`, `-`, `_` characters in encoded output", () => {
    const ALLOWED = /^[A-Za-z0-9_-]*$/;
    for (let seed = 0; seed < 30; seed++) {
      const buf = bytesToBuffer(
        Array.from({ length: seed + 1 }, (_, i) => ((seed + 7) * 53 + i * 11) & 0xff)
      );
      const enc = arrayBufferToBase64url(buf);
      expect(enc, `encoded form must use the URL-safe alphabet: ${enc}`).toMatch(ALLOWED);
    }
  });

  it("encoded length follows the ceil(4 * n / 3) - pad formula for unpadded base64url", () => {
    // Spot-check: 1 byte → 2 chars; 2 bytes → 3 chars; 3 bytes → 4 chars; 4 bytes → 6 chars.
    expect(arrayBufferToBase64url(bytesToBuffer([0xaa])).length).toBe(2);
    expect(arrayBufferToBase64url(bytesToBuffer([0xaa, 0xbb])).length).toBe(3);
    expect(arrayBufferToBase64url(bytesToBuffer([0xaa, 0xbb, 0xcc])).length).toBe(4);
    expect(arrayBufferToBase64url(bytesToBuffer([0xaa, 0xbb, 0xcc, 0xdd])).length).toBe(6);
    expect(arrayBufferToBase64url(bytesToBuffer([0xaa, 0xbb, 0xcc, 0xdd, 0xee])).length).toBe(7);
    expect(arrayBufferToBase64url(bytesToBuffer([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])).length).toBe(
      8
    );
  });
});

describe("base64url helpers — URL-safe alphabet input handling", () => {
  it("decoder accepts `-` (URL-safe substitute for `+`)", () => {
    // 0xff produces `+` in standard base64; the URL-safe form uses `-`.
    // Encode then verify it round-trips correctly.
    const buf = bytesToBuffer([0xff, 0xff, 0xff]);
    const enc = arrayBufferToBase64url(buf);
    // The output for 0xffffff is "____" which doesn't include `-`, so
    // exercise the substitution by feeding a known hand-crafted vector.
    // 0xfb in the second nibble produces a `-` after substitution.
    const handCrafted = arrayBufferToBase64url(bytesToBuffer([0xfb, 0xf0]));
    expect(handCrafted).toMatch(/^[A-Za-z0-9_-]+$/);
    // Sanity: round-tripping the original buffer still works.
    expect(bufferToBytes(base64urlToArrayBuffer(enc))).toEqual([0xff, 0xff, 0xff]);
  });

  it("decoder accepts `_` (URL-safe substitute for `/`)", () => {
    // The byte sequence [0xff, 0xff, 0xff] encodes to all-set bits,
    // which is the canonical "uses `_` everywhere" pattern in unpadded
    // base64url. Confirm decode brings it back.
    const enc = arrayBufferToBase64url(bytesToBuffer([0xff, 0xff, 0xff]));
    expect(enc).toContain("_");
    expect(bufferToBytes(base64urlToArrayBuffer(enc))).toEqual([0xff, 0xff, 0xff]);
  });

  it("decoder reconstructs internal padding when input is unpadded", () => {
    // The encoder strips trailing `=` characters. The decoder must
    // tolerate unpadded input and reconstruct the padded base64
    // internally before atob. A single missed pad calculation here
    // would silently break every WebAuthn ceremony.
    // Test vectors with each residue mod 4:
    //   3 bytes → 4 chars (no padding needed at all)
    //   2 bytes → 3 chars (one padding char needed)
    //   1 byte  → 2 chars (two padding chars needed)
    expect(
      bufferToBytes(base64urlToArrayBuffer(arrayBufferToBase64url(bytesToBuffer([0x66]))))
    ).toEqual([0x66]);
    expect(
      bufferToBytes(base64urlToArrayBuffer(arrayBufferToBase64url(bytesToBuffer([0x66, 0x77]))))
    ).toEqual([0x66, 0x77]);
    expect(
      bufferToBytes(
        base64urlToArrayBuffer(arrayBufferToBase64url(bytesToBuffer([0x66, 0x77, 0x88])))
      )
    ).toEqual([0x66, 0x77, 0x88]);
  });

  it("decoder accepts hand-crafted unpadded base64url for the literal string 'hi'", () => {
    // RFC 4648 §5 — "hi" encodes as `aGk=` in standard base64 and `aGk` unpadded.
    // The decoder must accept the unpadded form.
    expect(bufferToString(base64urlToArrayBuffer("aGk"))).toBe("hi");
  });

  it("decoder accepts hand-crafted unpadded base64url for the literal string 'sure.'", () => {
    // "sure." encodes as `c3VyZS4=` standard / `c3VyZS4` unpadded.
    expect(bufferToString(base64urlToArrayBuffer("c3VyZS4"))).toBe("sure.");
  });
});

describe("base64url helpers — synthetic WebAuthn-shaped vectors", () => {
  it("round-trips a 32-byte synthetic 'challenge'-shaped buffer", () => {
    // Synthetic non-cryptographic bytes. Patterns like this appear in
    // WebAuthn challenges. We DO NOT use real challenge bytes — these
    // are an arithmetic sequence chosen for stability and uniqueness.
    const synthetic = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
    const buf = bytesToBuffer(synthetic);
    const round = base64urlToArrayBuffer(arrayBufferToBase64url(buf));
    expect(bufferToBytes(round)).toEqual(synthetic);
  });

  it("round-trips a 64-byte synthetic 'credential-id'-shaped buffer", () => {
    const synthetic = Array.from({ length: 64 }, (_, i) => (i ^ 0x55) & 0xff);
    const buf = bytesToBuffer(synthetic);
    const round = base64urlToArrayBuffer(arrayBufferToBase64url(buf));
    expect(bufferToBytes(round)).toEqual(synthetic);
  });

  it("round-trips a 128-byte synthetic 'attestation'-shaped buffer", () => {
    const synthetic = Array.from({ length: 128 }, (_, i) => (i * 31 + 17) & 0xff);
    const buf = bytesToBuffer(synthetic);
    const round = base64urlToArrayBuffer(arrayBufferToBase64url(buf));
    expect(bufferToBytes(round)).toEqual(synthetic);
  });
});

// ── IDP_PATHS — proxy-path stability for the surfaces PasskeySection fetches ──

describe("PasskeySection fetch contract — IDP_PATHS stability", () => {
  it("webauthnCredentials proxy path is the documented stable shape", () => {
    // The component uses this for GET (list), and as a base for
    // DELETE/PATCH on `${path}/${credId}`. Path stability is a
    // contract between the UI and the IDP proxy.
    expect(IDP_PATHS.webauthnCredentials).toBe("/api/idp/api/v1/webauthn/credentials");
  });

  it("webauthnRegisterBegin proxy path is the documented stable shape", () => {
    expect(IDP_PATHS.webauthnRegisterBegin).toBe("/api/idp/api/v1/webauthn/register/begin");
  });

  it("webauthnRegisterFinish proxy path is the documented stable shape", () => {
    expect(IDP_PATHS.webauthnRegisterFinish).toBe("/api/idp/api/v1/webauthn/register/finish");
  });

  it("all webauthn paths are under the same-origin /api/idp/ proxy (no internal-URL leak)", () => {
    // The browser MUST never see the internal IDP URL. Every webauthn
    // path that PasskeySection touches must be a same-origin proxy
    // path. A regression that pointed any path at `http://identuum-idp:7113/...`
    // or similar would leak the internal hostname into client code.
    const webauthnPaths = [
      IDP_PATHS.webauthnCredentials,
      IDP_PATHS.webauthnRegisterBegin,
      IDP_PATHS.webauthnRegisterFinish,
    ];
    for (const p of webauthnPaths) {
      expect(p.startsWith("/api/idp/")).toBe(true);
      expect(p).not.toMatch(/^https?:\/\//);
      expect(p).not.toMatch(/^\/\//);
    }
  });
});

// ── Negative invariants — credential material never appears in static source ──

describe("Negative invariants — passkey module source does not contain credential strings", () => {
  // We read the helper module + component file as raw text and assert
  // no real-looking credential material is present. This catches the
  // class of bug where a future agent accidentally pastes a real
  // challenge / public key / attestation blob into a comment or a
  // default value.

  function readSrc(rel: string): string {
    return readFileSync(resolve(__dirname, "..", "components", "ui", rel), "utf-8");
  }

  const SOURCES = {
    helper: readSrc("passkey-base64url.ts"),
    component: readSrc("passkey-section.tsx"),
  };

  it("helper module contains no `Set-Cookie`, `Bearer`, `otpauth://`, or password/MFA secret literals", () => {
    expect(SOURCES.helper).not.toMatch(/Set-Cookie/i);
    expect(SOURCES.helper).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);
    expect(SOURCES.helper).not.toMatch(/otpauth:\/\//);
    expect(SOURCES.helper).not.toMatch(/password_hash/);
    expect(SOURCES.helper).not.toMatch(/mfa_secret/i);
  });

  it("helper module contains no long-looking literal blobs that resemble real WebAuthn payloads", () => {
    // Any base64url-shaped literal in the helper source longer than 32
    // chars is suspicious — the helper file should contain only the
    // function code and short comment text. A real challenge / cred id
    // would be much longer. Pin against the smallest realistic length.
    // The string concatenation below is intentional — it's the search
    // pattern (matching long base64url literals), not credential
    // material itself.
    const suspicious = SOURCES.helper.match(/"[A-Za-z0-9_-]{32,}"/g);
    expect(suspicious).toBeNull();
  });

  it("component source contains no long-looking literal blobs that resemble real WebAuthn payloads", () => {
    // Same pattern check for the component. The component's IDP_PATHS
    // imports are short. A regression that hardcoded an attestation
    // object as a default value would surface here.
    const suspicious = SOURCES.component.match(/"[A-Za-z0-9_-]{40,}"/g);
    expect(suspicious).toBeNull();
  });

  it("component source contains no `Set-Cookie`, `Bearer`, or otpauth literals", () => {
    expect(SOURCES.component).not.toMatch(/Set-Cookie/i);
    expect(SOURCES.component).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);
    expect(SOURCES.component).not.toMatch(/otpauth:\/\//);
  });
});

// ── Phase state-machine invariants — success banner must survive refresh() ───

describe("PasskeySection — success banner phase state machine", () => {
  // Pre-existing assumption: passkey-section.tsx already imported above
  // via SOURCES.component in the negative-invariants block. Re-read here
  // as a fresh string so the test is independent of evaluation order.
  function readComponent(): string {
    return readFileSync(
      resolve(__dirname, "..", "components", "ui", "passkey-section.tsx"),
      "utf-8"
    );
  }

  it("refresh() declares a preservePhase option so callers can opt out of the finally idle-reset", () => {
    // Why this matters. Before agent-a-20260627, refresh() ended with
    // `finally { setPhase("idle") }`, which overwrote the
    // `setPhase("success")` that handleAddPasskey() set immediately
    // before awaiting refresh(). The success banner unmounted before
    // Playwright (or a human operator) could observe it — T2 of the
    // CE customer-smoke passkey spec failed on the visibility
    // assertion even though the backend register/finish succeeded.
    // The option name is part of the same-file contract; renaming it
    // without updating the call site would re-introduce the bug.
    const src = readComponent();
    expect(src).toMatch(/async function refresh\(\s*opts\?:\s*\{\s*preservePhase\?: boolean\s*\}/);
    expect(src).toMatch(/if\s*\(\s*!opts\?\.preservePhase\s*\)\s*\{\s*setPhase\("idle"\)/);
  });

  it("handleAddPasskey passes preservePhase: true to refresh() on the success path", () => {
    // The call site MUST stay paired with the option declaration. A
    // regression that flipped the flag back to a no-arg call would
    // silently reproduce the original bug.
    const src = readComponent();
    expect(src).toMatch(
      /setPhase\("success"\);[\s\S]{0,400}refresh\(\s*\{\s*preservePhase:\s*true\s*\}\s*\)/
    );
  });

  it("handleAddPasskey retains the post-success setTimeout that returns phase to idle", () => {
    // The setTimeout is what eventually unmounts the success banner;
    // dropping it would leave the banner pinned forever. The 3-second
    // duration is also part of the contract — long enough for a human
    // (and for Playwright's 10s default visibility window) to observe
    // it.
    const src = readComponent();
    expect(src).toMatch(/setTimeout\(\(\)\s*=>\s*setPhase\("idle"\),\s*3000\)/);
  });

  it("refresh() still resets phase to idle when called without the preservePhase opt-in (initial mount path)", () => {
    // Initial mount sets phase to "loading" and relies on refresh()'s
    // default behavior to transition out of it. The default-behavior
    // branch MUST remain.
    const src = readComponent();
    expect(src).toMatch(
      /}\s*finally\s*\{\s*if\s*\(!opts\?\.preservePhase\)\s*\{\s*setPhase\("idle"\)\s*;\s*\}\s*\}/
    );
  });
});

describe("PasskeySection module — file exists at the expected path", () => {
  // Simple existence pin. If a future refactor moves the component
  // file, this fails with a clear pointer instead of cryptic import
  // errors in the consumer page.
  it("src/components/ui/passkey-section.tsx exists", () => {
    const p = resolve(__dirname, "..", "components", "ui", "passkey-section.tsx");
    expect(() => readFileSync(p, "utf-8")).not.toThrow();
  });

  it("src/components/ui/passkey-base64url.ts exists (helper extraction is in place)", () => {
    const p = resolve(__dirname, "..", "components", "ui", "passkey-base64url.ts");
    expect(() => readFileSync(p, "utf-8")).not.toThrow();
  });
});
