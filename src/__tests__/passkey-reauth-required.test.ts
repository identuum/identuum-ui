/**
 * H6: the IdP asks for a recent sign-in before a passkey is added or removed
 * (403 reauth_required). The account page must say so, not "not available for
 * your account", and must not treat every 403 as that.
 */
import { describe, expect, it } from "vitest";
import {
  classifyPasskeyEnrollmentError,
  PASSKEY_ENROLLMENT_ERROR_COPY,
  PASSKEY_REAUTH_REQUIRED_TAG,
} from "../components/ui/passkey-enrollment-errors";

describe("passkey enrollment: a stale sign-in", () => {
  it("is told to sign in again", () => {
    const err = Object.assign(new Error("begin_failed"), {
      __passkeyBeginStatus: 403,
      [PASSKEY_REAUTH_REQUIRED_TAG]: true,
    });
    expect(classifyPasskeyEnrollmentError(err)).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.reauthRequired);
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.reauthRequired).toMatch(/sign in again/i);
  });

  it("does not turn an ordinary 403 into that message", () => {
    const err = Object.assign(new Error("begin_failed"), { __passkeyBeginStatus: 403 });
    expect(classifyPasskeyEnrollmentError(err)).toBe(PASSKEY_ENROLLMENT_ERROR_COPY.beginForbidden);
  });
});
