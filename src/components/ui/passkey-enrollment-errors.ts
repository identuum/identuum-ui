/**
 * Pure classifier for passkey enrollment failures.
 *
 * The PasskeySection component throws one of four failure shapes from
 * its add-passkey flow:
 *
 *   1. A tagged Error from the begin-registration HTTP call —
 *      `{__passkeyBeginStatus: number}`. The status comes from the
 *      IDP's response and is used to differentiate "forbidden for
 *      this account" from any other backend failure.
 *
 *   2. A native DOMException raised by `navigator.credentials.create`
 *      — `NotAllowedError`, `NotSupportedError`, `InvalidStateError`,
 *      `SecurityError`. The DOMException's `name` field is the
 *      classifier input.
 *
 *   3. A tagged Error indicating the ceremony returned a null
 *      credential — `{__passkeyCeremonyCancelled: true}`. This is
 *      the "user dismissed the prompt or the device returned no
 *      credential" case.
 *
 *   4. A tagged Error from the finish-registration HTTP call —
 *      `{__passkeyFinishStatus: number}`. The status comes from the
 *      IDP's response. The IDP's human-facing `message` field is
 *      INTENTIONALLY ignored: it may contain the generic 500
 *      fallback ("An error occurred. Please try again later.") which
 *      gives the operator no actionable next step.
 *
 * Anything else (an unknown thrown value, a parse error, an Error
 * with no recognised tag) falls through to a safe generic copy.
 *
 * SECURITY:
 *   - Pure function. No I/O, no DOM access, no logging.
 *   - Does NOT inspect the IDP's `message` field — backend prose is
 *     never forwarded to the UI banner.
 *   - Does NOT inspect any WebAuthn credential payload field (no
 *     `attestationObject`, no `clientDataJSON`, no `rawId`, no
 *     `authenticatorData`).
 *   - Returns short, actionable, byte-stable copy strings that the
 *     PasskeySection renders verbatim. The copy never names the
 *     RP ID, the origin, the challenge, or any secret.
 */

/**
 * Operator-facing copy strings for each documented failure case.
 * Exported so tests can pin the exact text and so a future i18n
 * layer can swap them without touching the classifier.
 */
export const PASSKEY_ENROLLMENT_ERROR_COPY = {
  beginForbidden: "Passkey registration is not available for your account.",
  beginUnavailable:
    "Could not start passkey registration. Please try again, or contact your administrator if the problem persists.",
  ceremonyCancelled: "Passkey creation was cancelled or timed out.",
  ceremonyUnsupported:
    "This browser does not support the requested passkey type. Try a different browser or device.",
  ceremonyInvalidState:
    "A passkey for this account is already registered on this device. Remove it first or use a different device.",
  ceremonySecurity:
    "The passkey ceremony was blocked. Make sure the page is served over HTTPS or localhost and that your browser allows passkeys here.",
  finishUnauthorized:
    "Your session expired before the passkey could be saved. Sign in again and retry.",
  finishUnavailable:
    "Could not verify your passkey with the server. Try again, or contact your administrator if the problem persists.",
  generic: "An unexpected error occurred. Please try again.",
} as const;

/**
 * Shape-tagged errors thrown by PasskeySection.handleAddPasskey.
 * `__passkey*` keys are intentionally distinctive so a regression
 * that started throwing the same shape from another callsite would
 * surface as an unrelated test failure.
 */
type PasskeyBeginError = Error & { __passkeyBeginStatus: number };
type PasskeyFinishError = Error & { __passkeyFinishStatus: number };
type PasskeyCeremonyCancelledError = Error & {
  __passkeyCeremonyCancelled: true;
};

function isPasskeyBeginError(v: unknown): v is PasskeyBeginError {
  return (
    v instanceof Error &&
    typeof (v as PasskeyBeginError).__passkeyBeginStatus === "number"
  );
}

function isPasskeyFinishError(v: unknown): v is PasskeyFinishError {
  return (
    v instanceof Error &&
    typeof (v as PasskeyFinishError).__passkeyFinishStatus === "number"
  );
}

function isPasskeyCeremonyCancelledError(
  v: unknown
): v is PasskeyCeremonyCancelledError {
  return (
    v instanceof Error &&
    (v as PasskeyCeremonyCancelledError).__passkeyCeremonyCancelled === true
  );
}

/**
 * Maps a thrown enrollment failure onto a safe, actionable copy
 * string. See module doc for the mapping table.
 */
export function classifyPasskeyEnrollmentError(err: unknown): string {
  // 1. Begin-registration HTTP failure — status-aware.
  if (isPasskeyBeginError(err)) {
    if (err.__passkeyBeginStatus === 403) {
      return PASSKEY_ENROLLMENT_ERROR_COPY.beginForbidden;
    }
    return PASSKEY_ENROLLMENT_ERROR_COPY.beginUnavailable;
  }

  // 2. Browser DOMException from navigator.credentials.create.
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
        return PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyCancelled;
      case "NotSupportedError":
        return PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyUnsupported;
      case "InvalidStateError":
        return PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyInvalidState;
      case "SecurityError":
        return PASSKEY_ENROLLMENT_ERROR_COPY.ceremonySecurity;
      default:
        return PASSKEY_ENROLLMENT_ERROR_COPY.generic;
    }
  }

  // 3. Null-credential return from the browser ceremony.
  if (isPasskeyCeremonyCancelledError(err)) {
    return PASSKEY_ENROLLMENT_ERROR_COPY.ceremonyCancelled;
  }

  // 4. Finish-registration HTTP failure — status-aware.
  if (isPasskeyFinishError(err)) {
    if (err.__passkeyFinishStatus === 401) {
      return PASSKEY_ENROLLMENT_ERROR_COPY.finishUnauthorized;
    }
    return PASSKEY_ENROLLMENT_ERROR_COPY.finishUnavailable;
  }

  // 5. Anything else — safe generic copy. Crucially, an Error
  // instance with a `.message` field is NOT used for the banner;
  // the helper has no path that forwards backend prose.
  return PASSKEY_ENROLLMENT_ERROR_COPY.generic;
}
