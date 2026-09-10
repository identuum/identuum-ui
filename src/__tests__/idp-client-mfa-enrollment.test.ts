/**
 * Tests for MFA enrollment recognition in idp-client.ts::login(),
 * mfaEnrollInitiate(), and mfaEnrollComplete().
 *
 * Background:
 *   - identuum-idp-oss (old contract): HTTP 401 + {"error":"mfa_enrollment_required"}
 *     with NO session_id. The UI falls back to a "contact admin" message.
 *   - identuum-idp-oss (new contract, agent-a-identuum-idp-oss-mfa-totp-enrolment-endpoints):
 *     HTTP 401 + {error, mfa_required:true, mfa_enrollment_required:true, session_id:"..."}
 *     The full in-browser enrollment form runs.
 *   - identuum-idp monolith: HTTP 200 + {mfa_required:true, session_id:"..."} (unchanged).
 *
 * New OSS enrollment endpoints (agent-a work):
 *   POST /api/v1/auth/login/mfa/enroll/initiate → {otpauth_url, secret, recovery_codes, expires_at}
 *   POST /api/v1/auth/login/mfa/enroll/complete → normal login cookies/session
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountMfaSetupComplete,
  accountMfaSetupInitiate,
  login,
  mfaEnrollComplete,
  mfaEnrollInitiate,
} from "../lib/idp-client";
import { ApiError } from "../lib/ui-api";

// ── fetch-mock helpers ────────────────────────────────────────────────────────

function makeFetchMock(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// ── login() — OSS mfa_enrollment_required detection ──────────────────────────

describe("login() — OSS mfa_enrollment_required response", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns { kind: 'mfa_enrollment_required', sessionId: null } for OSS 401 + error body", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "mfa_enrollment_required" }));

    const outcome = await login({
      email: "admin@system.local",
      password: "some-password",
      remember_me: false,
    });

    expect(outcome.kind).toBe("mfa_enrollment_required");
    if (outcome.kind === "mfa_enrollment_required") {
      expect(outcome.sessionId).toBeNull();
    }
  });

  it("does NOT throw ApiError for OSS 401 + mfa_enrollment_required", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "mfa_enrollment_required" }));

    await expect(
      login({ email: "admin@system.local", password: "some-password", remember_me: false })
    ).resolves.not.toThrow();
  });

  it("treats mfa_enrollment_required distinctly from wrong-password 401", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "invalid_credentials" }));

    await expect(
      login({ email: "admin@system.local", password: "wrong", remember_me: false })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("wrong password 401 still throws ApiError with message 'Invalid credentials'", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "invalid_credentials" }));

    const err = await login({
      email: "admin@system.local",
      password: "wrong",
      remember_me: false,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain("Invalid credentials");
  });

  it("generic 401 with no error body still throws ApiError", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, {}));

    await expect(
      login({ email: "admin@system.local", password: "wrong", remember_me: false })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("no redirect or session occurs on mfa_enrollment_required response (no cookies set)", async () => {
    // The login() function must return the outcome — it must NOT cause any
    // side-effect that implies a successful login (cookies are set by the server,
    // not this function, but we pin that the outcome kind is correct so callers
    // know NOT to navigate to a dashboard).
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "mfa_enrollment_required" }));

    const outcome = await login({
      email: "admin@system.local",
      password: "some-password",
      remember_me: false,
    });

    // Kind must be enrollment-required, not success.
    expect(outcome.kind).toBe("mfa_enrollment_required");
    expect(outcome.kind).not.toBe("success");
  });
});

// ── login() — existing behaviour preserved ───────────────────────────────────

describe("login() — existing mfa_required behaviour (monolith shape)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns { kind: 'mfa_required', sessionId } for monolith mfa_required response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        mfa_required: true,
        session_id: "019e6900-fake-7000-pending-session",
        success: false,
      })
    );

    const outcome = await login({
      email: "user@example.com",
      password: "some-password",
      remember_me: false,
    });

    expect(outcome.kind).toBe("mfa_required");
    if (outcome.kind === "mfa_required") {
      expect(outcome.sessionId).toBe("019e6900-fake-7000-pending-session");
    }
  });

  it("returns { kind: 'mfa_enrollment_required', sessionId } for monolith mfa+enrollment combined", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        mfa_required: true,
        mfa_enrollment_required: true,
        session_id: "019e6900-fake-7000-enroll-session",
        success: false,
      })
    );

    const outcome = await login({
      email: "admin@example.com",
      password: "some-password",
      remember_me: false,
    });

    expect(outcome.kind).toBe("mfa_enrollment_required");
    if (outcome.kind === "mfa_enrollment_required") {
      expect(outcome.sessionId).toBe("019e6900-fake-7000-enroll-session");
    }
  });

  it("returns { kind: 'success', role } for successful login with role", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        role: "site_admin",
        success: true,
      })
    );

    const outcome = await login({
      email: "admin@system.local",
      password: "correct-password",
      remember_me: false,
    });

    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.role).toBe("site_admin");
    }
  });
});

// ── Source-invariant tests ────────────────────────────────────────────────────

const IDP_CLIENT_SRC = readFileSync(
  resolve(import.meta.dirname, "..", "lib", "idp-client.ts"),
  "utf-8"
);

const PASSWORD_FORM_SRC = readFileSync(
  resolve(import.meta.dirname, "..", "components", "auth", "password-form.tsx"),
  "utf-8"
);

// Extract the login() function body for targeted assertions.
// login() starts after the LoginOutcome type block and ends at the next export.
const LOGIN_FN_START = IDP_CLIENT_SRC.indexOf("export async function login(");
const LOGIN_FN_END = IDP_CLIENT_SRC.indexOf("\nexport async function mfaLogin(");
const LOGIN_FN_BODY = IDP_CLIENT_SRC.slice(LOGIN_FN_START, LOGIN_FN_END);

describe("idp-client.ts — source invariants", () => {
  it("login() function body contains body.error === 'mfa_enrollment_required' check", () => {
    expect(LOGIN_FN_BODY).toContain('body.error === "mfa_enrollment_required"');
  });

  it("checks body.error === 'mfa_enrollment_required' before !res.ok inside login()", () => {
    const enrollIdx = LOGIN_FN_BODY.indexOf('body.error === "mfa_enrollment_required"');
    const notOkIdx = LOGIN_FN_BODY.indexOf("if (!res.ok)");
    expect(enrollIdx).toBeGreaterThan(-1);
    expect(notOkIdx).toBeGreaterThan(-1);
    // The enrollment-required check must appear before the !res.ok check.
    expect(enrollIdx).toBeLessThan(notOkIdx);
  });

  it("LoginOutcome mfa_enrollment_required sessionId is string | null", () => {
    expect(IDP_CLIENT_SRC).toContain("sessionId: string | null");
  });

  it("returns sessionId: null for OSS enrollment-required path", () => {
    expect(IDP_CLIENT_SRC).toContain("sessionId: null");
  });

  it("does not collapse mfa_enrollment_required into 'Invalid credentials' throw", () => {
    // Extract just the OSS enrollment check block (between the check and !res.ok).
    const enrollIdx = LOGIN_FN_BODY.indexOf('body.error === "mfa_enrollment_required"');
    const notOkIdx = LOGIN_FN_BODY.indexOf("if (!res.ok)");
    const enrollBlock = LOGIN_FN_BODY.slice(enrollIdx, notOkIdx);
    expect(enrollBlock).toContain("return");
    expect(enrollBlock).not.toContain("throw new ApiError");
  });
});

describe("password-form.tsx — handles mfa_enrollment_required with null sessionId", () => {
  it("checks outcome.sessionId truthiness before calling onMfaEnrollmentRequired", () => {
    expect(PASSWORD_FORM_SRC).toContain("outcome.sessionId");
    // The form must branch on whether sessionId is truthy.
    expect(PASSWORD_FORM_SRC).toMatch(/if\s*\(\s*outcome\.sessionId\s*\)/);
  });

  it("shows distinct error message for null sessionId (not 'Invalid credentials')", () => {
    expect(PASSWORD_FORM_SRC).toMatch(/Two-factor authentication enrollment is required/);
  });

  it("does not pass null/falsy sessionId to onMfaEnrollmentRequired", () => {
    // onMfaEnrollmentRequired must only be called inside the sessionId-truthy branch.
    // Extract the enrollment-required block and verify the call is guarded.
    const enrollIdx = PASSWORD_FORM_SRC.indexOf('"mfa_enrollment_required"');
    const nextIfIdx = PASSWORD_FORM_SRC.indexOf('"mfa_required"', enrollIdx);
    const block = PASSWORD_FORM_SRC.slice(enrollIdx, nextIfIdx);
    // The call to onMfaEnrollmentRequired appears after the sessionId check.
    expect(block).toContain("onMfaEnrollmentRequired");
    expect(block).toContain("outcome.sessionId");
  });
});

// ── login() — new OSS contract (HTTP 401 + boolean fields + session_id) ────────
//
// Agent A (agent-a-identuum-idp-oss-mfa-totp-enrolment-endpoints) updated the
// identuum-idp-oss backend to return mfa_required/mfa_enrollment_required booleans
// AND a pending session_id on HTTP 401 responses. The existing check-1 logic
// (body.mfa_required && body.mfa_enrollment_required) already handles this correctly.
// These tests pin that it continues to work.

describe("login() — new OSS 401 response with session_id", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps OSS 401 + mfa_required:true + mfa_enrollment_required:true + session_id to enrollment flow", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(401, {
        error: "mfa_enrollment_required",
        mfa_required: true,
        mfa_enrollment_required: true,
        session_id: "019e7000-fake-oss-enroll-session",
      })
    );

    const outcome = await login({
      email: "admin@system.local",
      password: "some-password",
      remember_me: false,
    });

    expect(outcome.kind).toBe("mfa_enrollment_required");
    if (outcome.kind === "mfa_enrollment_required") {
      expect(outcome.sessionId).toBe("019e7000-fake-oss-enroll-session");
      // sessionId is non-null — enrollment form should be shown, not the fallback message.
      expect(outcome.sessionId).not.toBeNull();
    }
  });

  it("maps OSS 401 + mfa_required:true + mfa_enrollment_required:false + session_id to mfa_required", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(401, {
        error: "mfa_required",
        mfa_required: true,
        mfa_enrollment_required: false,
        session_id: "019e7000-fake-oss-mfa-session",
      })
    );

    const outcome = await login({
      email: "admin@system.local",
      password: "some-password",
      remember_me: false,
    });

    expect(outcome.kind).toBe("mfa_required");
    if (outcome.kind === "mfa_required") {
      expect(outcome.sessionId).toBe("019e7000-fake-oss-mfa-session");
    }
  });

  it("old OSS path (401 + error only, no booleans) still returns sessionId:null", async () => {
    // Backward compat: OSS versions that only return body.error without boolean fields.
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "mfa_enrollment_required" }));

    const outcome = await login({
      email: "admin@system.local",
      password: "some-password",
      remember_me: false,
    });

    expect(outcome.kind).toBe("mfa_enrollment_required");
    if (outcome.kind === "mfa_enrollment_required") {
      expect(outcome.sessionId).toBeNull();
    }
  });
});

// ── mfaEnrollInitiate() — new OSS response shape ──────────────────────────────

describe("mfaEnrollInitiate() — OSS response parsing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses otpauth_url from the new OSS backend response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        secret: "PLACEHOLDER_SECRET_FOR_TESTING",
        otpauth_url: "otpauth://totp/test%3Atest%40example.com?secret=PLACEHOLDER&issuer=test",
        recovery_codes: ["AAAAA-AAAAA", "BBBBB-BBBBB"],
        expires_at: "2026-06-05T12:00:00Z",
      })
    );

    const result = await mfaEnrollInitiate("fake-session-id");

    expect(result.otpauthUrl).toBe(
      "otpauth://totp/test%3Atest%40example.com?secret=PLACEHOLDER&issuer=test"
    );
    expect(result.secret).toBe("PLACEHOLDER_SECRET_FOR_TESTING");
  });

  it("falls back to qr_code_url when otpauth_url is absent (monolith backward compat)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        secret: "PLACEHOLDER_SECRET_FOR_TESTING",
        qr_code_url: "otpauth://totp/monolith%3Atest%40example.com?secret=PLACEHOLDER&issuer=mono",
        // no otpauth_url field
      })
    );

    const result = await mfaEnrollInitiate("fake-session-id");

    expect(result.otpauthUrl).toBe(
      "otpauth://totp/monolith%3Atest%40example.com?secret=PLACEHOLDER&issuer=mono"
    );
  });

  it("parses recovery_codes array from the new OSS backend response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        secret: "PLACEHOLDER_SECRET_FOR_TESTING",
        otpauth_url: "otpauth://totp/test?secret=PLACEHOLDER",
        recovery_codes: ["AAAAA-AAAAA", "BBBBB-BBBBB", "CCCCC-CCCCC"],
      })
    );

    const result = await mfaEnrollInitiate("fake-session-id");

    expect(result.recoveryCodes).toHaveLength(3);
    // Structural check only — do not assert the actual code values.
    expect(Array.isArray(result.recoveryCodes)).toBe(true);
    for (const code of result.recoveryCodes) {
      expect(typeof code).toBe("string");
    }
  });

  it("returns empty recoveryCodes when backend omits recovery_codes (monolith compat)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        secret: "PLACEHOLDER_SECRET_FOR_TESTING",
        qr_code_url: "otpauth://totp/mono?secret=PLACEHOLDER",
        // no recovery_codes field
      })
    );

    const result = await mfaEnrollInitiate("fake-session-id");

    expect(result.recoveryCodes).toEqual([]);
  });

  it("throws ApiError on non-2xx response", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "session_invalid" }));

    await expect(mfaEnrollInitiate("expired-session-id")).rejects.toBeInstanceOf(ApiError);
  });
});

// ── mfaEnrollComplete() — behavior ───────────────────────────────────────────

describe("mfaEnrollComplete() — success and error paths", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns role on success — treated as login success", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, { role: "site_admin", success: true }));

    const result = await mfaEnrollComplete("fake-session-id", "123456");

    expect(result.role).toBe("site_admin");
  });

  it("defaults role to org_user when backend omits role", async () => {
    vi.stubGlobal("fetch", makeFetchMock(200, { success: true }));

    const result = await mfaEnrollComplete("fake-session-id", "123456");

    expect(result.role).toBe("org_user");
  });

  it("throws ApiError with 'Invalid verification code' for wrong code (400)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(400, { error: "invalid_code" }));

    const err = await mfaEnrollComplete("fake-session-id", "000000").catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain("Invalid verification code");
  });

  it("throws ApiError with SESSION_EXPIRED for session_invalid error", async () => {
    vi.stubGlobal("fetch", makeFetchMock(400, { error: "session invalid" }));

    const err = await mfaEnrollComplete("expired-session-id", "123456").catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("SESSION_EXPIRED");
  });
});

// ── Source-invariant tests — mfaEnrollInitiate ────────────────────────────────

const ENROLL_INITIATE_START = IDP_CLIENT_SRC.indexOf("export async function mfaEnrollInitiate(");
const ENROLL_INITIATE_END = IDP_CLIENT_SRC.indexOf("\nexport async function mfaEnrollComplete(");
const ENROLL_INITIATE_BODY = IDP_CLIENT_SRC.slice(ENROLL_INITIATE_START, ENROLL_INITIATE_END);

describe("idp-client.ts — mfaEnrollInitiate source invariants", () => {
  it("reads body.otpauth_url from the response (new OSS field)", () => {
    expect(ENROLL_INITIATE_BODY).toContain("body.otpauth_url");
  });

  it("falls back to body.qr_code_url for monolith backward compat", () => {
    expect(ENROLL_INITIATE_BODY).toContain("body.qr_code_url");
    // The fallback uses the ?? operator.
    expect(ENROLL_INITIATE_BODY).toContain("body.otpauth_url ?? body.qr_code_url");
  });

  it("parses body.recovery_codes as an array", () => {
    expect(ENROLL_INITIATE_BODY).toContain("body.recovery_codes");
    expect(ENROLL_INITIATE_BODY).toContain("Array.isArray(body.recovery_codes)");
  });

  it("return type includes recoveryCodes field", () => {
    expect(ENROLL_INITIATE_BODY).toContain("recoveryCodes");
  });
});

// ── Source-invariant tests — MFAEnrollForm recovery codes ────────────────────

const MFA_ENROLL_FORM_SRC = readFileSync(
  resolve(import.meta.dirname, "..", "components", "auth", "mfa-enroll-form.tsx"),
  "utf-8"
);

// ── accountMfaSetupInitiate / accountMfaSetupComplete — wire-path invariants ──
//
// The /account/settings MFA enrollment flow drives the CE backend's
// /api/v1/mfa/setup/{initiate,complete} routes (mounted as aliases of the
// legacy /mfa/setup/{initiate,complete} routes by MountAPIV1MFASetupRoutes
// in identuum-idp-ce; the UI's /api/idp/* proxy forwards verbatim, so a
// path-constant regression silently 404s the entire enrollment ceremony).
// These tests pin the exact request URLs the client sends — a wire-path
// invariant that protects against silent path renames.
//
// SECURITY: tests use PLACEHOLDER values for the TOTP secret + recovery
// codes. No real secret is ever generated or logged.

describe("accountMfaSetupInitiate() — wire-path + response parsing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to /api/idp/api/v1/mfa/setup/initiate (path-constant invariant)", async () => {
    const fetchMock = makeFetchMock(200, {
      secret: "PLACEHOLDER_SECRET",
      otpauth_url: "otpauth://totp/test?secret=PLACEHOLDER",
    });
    vi.stubGlobal("fetch", fetchMock);

    await accountMfaSetupInitiate("PLACEHOLDER_PASSWORD");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/idp/api/v1/mfa/setup/initiate");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
  });

  // THE-ENROLL-PASSWORD: identuum-idp-ce d9ca9fe requires the caller's
  // current password on this route (a hijacked session alone could arm an
  // attacker's authenticator on a factorless account — CE log/0100). The
  // wire body is exactly {"password": …} and nothing else; the old `{}`
  // is refused 401 invalid_proof by the server.
  it("sends the current password as the JSON body {password} (CE d9ca9fe contract)", async () => {
    const fetchMock = makeFetchMock(200, {
      secret: "PLACEHOLDER_SECRET",
      otpauth_url: "otpauth://totp/test?secret=PLACEHOLDER",
    });
    vi.stubGlobal("fetch", fetchMock);

    await accountMfaSetupInitiate("PLACEHOLDER_PASSWORD");

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init?.body).toBe(JSON.stringify({ password: "PLACEHOLDER_PASSWORD" }));
  });

  it("surfaces the server's 401 invalid_proof as an ApiError carrying the status (never a success)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(401, { error: "invalid_proof" }));

    const err = await accountMfaSetupInitiate("PLACEHOLDER_PASSWORD").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it("parses body.otpauth_url (CE / OSS field) into otpauthUrl", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        secret: "PLACEHOLDER_SECRET",
        otpauth_url: "otpauth://totp/ce?secret=PLACEHOLDER&issuer=ce",
      })
    );

    const result = await accountMfaSetupInitiate("PLACEHOLDER_PASSWORD");

    expect(result.otpauthUrl).toBe("otpauth://totp/ce?secret=PLACEHOLDER&issuer=ce");
    expect(result.secret).toBe("PLACEHOLDER_SECRET");
  });

  it("falls back to body.qr_code_url when otpauth_url is absent (monolith backward compat)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(200, {
        secret: "PLACEHOLDER_SECRET",
        qr_code_url: "otpauth://totp/mono?secret=PLACEHOLDER&issuer=mono",
      })
    );

    const result = await accountMfaSetupInitiate("PLACEHOLDER_PASSWORD");

    expect(result.otpauthUrl).toBe("otpauth://totp/mono?secret=PLACEHOLDER&issuer=mono");
  });

  it("throws on non-2xx, non-409 (ApiError)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(500, { error: "mfa_initiate_failed" }));

    await expect(accountMfaSetupInitiate("PLACEHOLDER_PASSWORD")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("accountMfaSetupComplete() — wire-path", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to /api/idp/api/v1/mfa/setup/complete (path-constant invariant)", async () => {
    const fetchMock = makeFetchMock(201, { recovery_codes: ["XXXXX-XXXXX"] });
    vi.stubGlobal("fetch", fetchMock);

    await accountMfaSetupComplete("000000");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/idp/api/v1/mfa/setup/complete");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBe(JSON.stringify({ code: "000000" }));
  });

  it("returns recoveryCodes from the response (structural — no value assertions)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(201, { recovery_codes: ["XXXXX-XXXXX", "YYYYY-YYYYY"] }));

    const result = await accountMfaSetupComplete("123456");

    expect(Array.isArray(result.recoveryCodes)).toBe(true);
    expect(result.recoveryCodes).toHaveLength(2);
  });

  it("returns empty recoveryCodes when backend omits the field", async () => {
    vi.stubGlobal("fetch", makeFetchMock(201, {}));

    const result = await accountMfaSetupComplete("123456");

    expect(result.recoveryCodes).toEqual([]);
  });
});

describe("idp-paths.ts — MFA setup path constants source invariant", () => {
  const IDP_PATHS_SRC = readFileSync(
    resolve(import.meta.dirname, "..", "lib", "idp-paths.ts"),
    "utf-8"
  );

  it("mfaSetupInitiate is /api/idp/api/v1/mfa/setup/initiate (matches CE alias mount)", () => {
    expect(IDP_PATHS_SRC).toContain('mfaSetupInitiate: "/api/idp/api/v1/mfa/setup/initiate"');
  });

  it("mfaSetupComplete is /api/idp/api/v1/mfa/setup/complete (matches CE alias mount)", () => {
    expect(IDP_PATHS_SRC).toContain('mfaSetupComplete: "/api/idp/api/v1/mfa/setup/complete"');
  });
});

describe("idp-client.ts — accountMfaSetupInitiate source invariants", () => {
  const ACCOUNT_INITIATE_START = IDP_CLIENT_SRC.indexOf(
    "export async function accountMfaSetupInitiate("
  );
  const ACCOUNT_INITIATE_END = IDP_CLIENT_SRC.indexOf(
    "\nexport async function accountMfaSetupComplete("
  );
  const ACCOUNT_INITIATE_BODY = IDP_CLIENT_SRC.slice(ACCOUNT_INITIATE_START, ACCOUNT_INITIATE_END);

  it("targets the IDP.mfaSetupInitiate constant (no inline URL)", () => {
    expect(ACCOUNT_INITIATE_BODY).toContain("IDP.mfaSetupInitiate");
  });

  it("parses body.otpauth_url with body.qr_code_url fallback", () => {
    expect(ACCOUNT_INITIATE_BODY).toContain("body.otpauth_url ?? body.qr_code_url");
  });

  it("forwards credentials so the cookie session reaches the IDP", () => {
    expect(ACCOUNT_INITIATE_BODY).toContain('credentials: "include"');
  });
});

describe("mfa-enroll-form.tsx — recovery codes invariants", () => {
  it("has a 'recovery' phase in the Phase type", () => {
    expect(MFA_ENROLL_FORM_SRC).toContain('"recovery"');
  });

  it("stores recoveryCodes in component state", () => {
    expect(MFA_ENROLL_FORM_SRC).toContain("recoveryCodes");
    expect(MFA_ENROLL_FORM_SRC).toContain("setRecoveryCodes");
  });

  it("shows recovery codes only in the recovery phase (not at page load)", () => {
    // The recovery phase is gated behind phase === "recovery" check.
    expect(MFA_ENROLL_FORM_SRC).toContain('phase === "recovery"');
    // Recovery codes are not rendered unconditionally in the display phase.
    const displayPhaseStart = MFA_ENROLL_FORM_SRC.indexOf('phase === "recovery"');
    const beforeRecovery = MFA_ENROLL_FORM_SRC.slice(0, displayPhaseStart);
    // recoveryCodes map() call only appears after the recovery phase check.
    expect(beforeRecovery).not.toContain("recoveryCodes.map(");
  });

  it("recovery codes are never written to localStorage or sessionStorage", () => {
    // Structural check: no storage write calls in this component.
    expect(MFA_ENROLL_FORM_SRC).not.toContain("localStorage.setItem");
    expect(MFA_ENROLL_FORM_SRC).not.toContain("sessionStorage.setItem");
  });

  it("recovery phase shows a 'save your recovery codes' heading", () => {
    expect(MFA_ENROLL_FORM_SRC).toContain("Save your recovery codes");
  });

  it("recovery phase has a confirmation button to proceed to login", () => {
    // JSX uses &apos; entity for the apostrophe in "I've saved my recovery codes".
    expect(MFA_ENROLL_FORM_SRC).toContain("I&apos;ve saved my recovery codes");
  });

  it("calls onSuccess only after user acknowledges recovery codes", () => {
    // The confirmation button's onClick calls onSuccess(pendingRole).
    expect(MFA_ENROLL_FORM_SRC).toContain("pendingRole");
    expect(MFA_ENROLL_FORM_SRC).toContain("onSuccess(pendingRole)");
  });
});
