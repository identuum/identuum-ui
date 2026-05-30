/**
 * Base64URL helpers for the PasskeySection / WebAuthn ceremony glue.
 *
 * These two functions are the load-bearing seam between the IDP's
 * unpadded base64url wire format and the browser's WebAuthn DOM types
 * (which require `ArrayBuffer` for `challenge`, `user.id`, `rawId`,
 * `clientDataJSON`, and `attestationObject`). A single off-by-one in the
 * padding logic or a missed URL-safe character substitution would
 * silently break every passkey registration and login ceremony — and
 * because the failure surfaces only at the authenticator level, it
 * would not be caught by any contract-shape test.
 *
 * Pure, no React, no DOM. Safe to import in both browser code
 * (PasskeySection) and Node vitest. The implementation relies on `atob`
 * / `btoa`, which are available in both modern browsers AND Node 16+,
 * so the helper module is environment-agnostic.
 *
 * INVARIANTS (also pinned by `src/__tests__/passkey-section.test.ts`):
 *   - Round-trip: decode(encode(buf)) === buf for any byte sequence.
 *   - URL-safe alphabet: encoded output uses only `A-Z`, `a-z`, `0-9`,
 *     `-`, `_`. No `+`, `/`, or `=`.
 *   - Padding: encoded output is UNPADDED (no trailing `=`). The
 *     decoder MUST tolerate unpadded input and reconstruct the padded
 *     base64 internally before atob.
 *   - Empty input: encode of an empty buffer is the empty string;
 *     decode of the empty string is a zero-length ArrayBuffer.
 *
 * SECURITY:
 *   - These helpers manipulate WebAuthn ceremony bytes (challenge,
 *     credential id, clientDataJSON, attestationObject). The ceremony
 *     identifiers are short-lived and not user auth tokens, but the
 *     helpers MUST NOT log or persist their inputs. They simply
 *     transform bytes.
 *   - The functions do NOT inspect or interpret the byte contents.
 *     They are agnostic to whether the bytes are a challenge, a
 *     credential id, or anything else.
 */

/** Convert an unpadded base64url string to an ArrayBuffer. */
export function base64urlToArrayBuffer(b64url: string): ArrayBuffer {
  // Restore standard base64 alphabet from the URL-safe form.
  const base64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  // Reconstruct standard base64 padding so atob does not reject the
  // input. The (4 - (n % 4)) % 4 formula yields 0, 1, 2, or 3 pad chars
  // depending on the input length.
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Convert an ArrayBuffer to an unpadded base64url string. */
export function arrayBufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  // Standard base64 → URL-safe alphabet, strip trailing padding.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
