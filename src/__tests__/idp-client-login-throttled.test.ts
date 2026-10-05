/**
 * The account-wide sign-in slow-down (identuum-idp-oss v0.9.5, owner ruling).
 *
 * After repeated failed sign-ins for one account, from any address, the IdP
 * answers 429 {"error":"login_throttled"} until a short wait (at most a
 * minute) has passed; it never locks the account. login() surfaces a distinct
 * LOGIN_THROTTLED sentinel and the password form says to wait — not
 * "Invalid credentials.", which would send the user guessing again.
 *
 * Deterministic: no live backend, no credentials (synthetic fixture values).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { login, loginWaitMessage } from "../lib/idp-client";
import { ApiError } from "../lib/ui-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("login() — the account-wide slow-down", () => {
  it("throws ApiError with the LOGIN_THROTTLED sentinel on 429 login_throttled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: "login_throttled", retry_after_seconds: 4 }),
      })
    );
    const err = await login({
      email: "u@acme.example",
      password: "fixture-pw",
      remember_me: false,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).message).toBe("LOGIN_THROTTLED");
  });

  it("the password form says to wait for the sentinel", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "components", "auth", "password-form.tsx"),
      "utf-8"
    );
    expect(src).toMatch(/LOGIN_THROTTLED/);
    expect(src).toMatch(/loginWaitMessage\(err\)/);
  });

  // v0.9.6 (FUNC-M2): a held per-address bound answers the same 429 with a
  // wait of up to fifteen minutes; the form says how long instead of "up to a
  // minute".
  it("carries the IdP's wait and says it in words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: "login_throttled", retry_after_seconds: 840 }),
      })
    );
    const err = (await login({
      email: "u@acme.example",
      password: "fixture-pw",
      remember_me: false,
    }).catch((e) => e)) as ApiError;
    expect(err.body).toEqual({ retryAfterSeconds: 840 });
    expect(loginWaitMessage(err)).toBe("Too many attempts. Try again in 14 minutes.");
    expect(loginWaitMessage(new ApiError(429, "LOGIN_THROTTLED", { retryAfterSeconds: 4 }))).toBe(
      "Too many attempts. Try again in 4 seconds."
    );
    expect(loginWaitMessage(new ApiError(429, "LOGIN_THROTTLED"))).toMatch(/Wait a few minutes/);
  });
});
