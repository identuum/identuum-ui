/**
 * H6: the IdP asks for a recent sign-in before a passkey is added or removed
 * (403 reauth_required). The account page must say so, not "not available for
 * your account", and must not treat every 403 as that.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyPasskeyDeleteResult,
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

describe("passkey removal: the banner it leaves", () => {
  it("a successful removal leaves no banner (clears an earlier one)", () => {
    expect(classifyPasskeyDeleteResult(204, undefined)).toBeNull();
    expect(classifyPasskeyDeleteResult(200, undefined)).toBeNull();
  });

  it("a stale sign-in is told to sign in again", () => {
    expect(classifyPasskeyDeleteResult(403, "reauth_required")).toBe(
      PASSKEY_ENROLLMENT_ERROR_COPY.reauthRequired
    );
  });

  it("every other failure says the removal failed, never silence", () => {
    for (const [status, code] of [
      [403, "forbidden"],
      [403, undefined],
      [404, "not_found"],
      [500, undefined],
      [0, undefined],
    ] as const) {
      expect(classifyPasskeyDeleteResult(status, code)).toBe(
        PASSKEY_ENROLLMENT_ERROR_COPY.deleteFailed
      );
    }
    expect(PASSKEY_ENROLLMENT_ERROR_COPY.deleteFailed).toMatch(/could not remove the passkey/i);
  });

  it("the section uses that banner: clears it on success, shows it on failure", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "components", "ui", "passkey-section.tsx"),
      "utf-8"
    );
    const start = src.indexOf("async function handleDeletePasskey");
    const body = src.slice(start, src.indexOf("const isRegistering", start));
    expect(body).toMatch(/classifyPasskeyDeleteResult\(res\.status,\s*body\?\.error\)/);
    expect(body).toMatch(
      /if \(banner === null\) \{[\s\S]*?setError\(null\);[\s\S]*?setPhase\(\(p\) => \(p === "error" \? "idle" : p\)\);[\s\S]*?\} else \{\s*setError\(banner\);\s*setPhase\("error"\);/
    );
  });
});
