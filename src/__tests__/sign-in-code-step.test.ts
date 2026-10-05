/**
 * The sign-in code step (identuum-idp-oss v0.9.6).
 *
 * FUNC-H3: the recovery-codes page says each code "can be used once to sign
 * in", and the IdP accepts one where the code is asked; the console's field
 * took only 6 digits, so a 16-character recovery code was cut and never sent.
 * FUNC-M3: while the user's wrong-code budget is spent, the IdP answers every
 * code 429 login_throttled with the wait; the form says to wait, not
 * "Invalid verification code".
 *
 * Deterministic: no live backend, no credentials (synthetic fixture values).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mfaLoginErrorMessage, normalizeSignInCode } from "../components/auth/mfa-form";
import { mfaLogin } from "../lib/idp-client";
import { ApiError } from "../lib/ui-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the code field", () => {
  it("takes a 6-digit code as typed and a recovery code as shown", () => {
    expect(normalizeSignInCode("123456")).toBe("123456");
    expect(normalizeSignInCode(" 123 456 ")).toBe("123456");
    expect(normalizeSignInCode("abcd-efgh ijkl-mnop")).toBe("ABCDEFGHIJKLMNOP");
  });

  it("sends a recovery code to the IdP's code step", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ role: "org_admin" }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await mfaLogin("fixture-session", normalizeSignInCode("abcdefghijklmnop"));
    expect(res.role).toBe("org_admin");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).code).toBe("ABCDEFGHIJKLMNOP");
  });
});

describe("a spent wrong-code budget", () => {
  it("is a wait, with the IdP's seconds, not an invalid code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: "login_throttled", retry_after_seconds: 780 }),
      })
    );
    const err = (await mfaLogin("fixture-session", "123456").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("LOGIN_THROTTLED");
    expect(mfaLoginErrorMessage(err)).toBe("Too many attempts. Try again in 13 minutes.");
  });

  it("a wrong code is still a wrong code", () => {
    expect(mfaLoginErrorMessage(new ApiError(401, "Invalid verification code"))).toBe(
      "Invalid verification code. Try again."
    );
  });
});
