/** UI-G9 T1/T4: mocked wire characterization, not an OSS HTTP or timing proof. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConsumeClaimState, consumeClaimAction } from "../app/claim/actions";

const config = vi.hoisted(() => ({ enabled: true, configured: true }));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => (config.configured ? { idp: { enabled: config.enabled } } : null),
  idpBaseUrl: () => "https://idp.test",
}));

const INVALID =
  "This setup link is invalid, expired, or has already been used. Please contact your administrator for a new link.";
const FAILED = "Setup failed. Please try again or request a new link.";
const NETWORK = "Network error. Please check your connection and try again.";
const POLICY = "Password does not meet the required strength.";
const EXHAUSTED =
  "Maximum password attempts reached. Please contact your administrator for a new claim link.";
const DIAGNOSTIC = "email_exists: held by another tenant";

function form(patch: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    token: "claim-fixture",
    email: "admin@example.test",
    password: "fixture-password",
    confirmPassword: "fixture-password",
    name: "",
    ...patch,
  }))
    fd.set(key, value);
  return fd;
}

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  config.enabled = config.configured = true;
  // Unexpected calls cannot reach any live service.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unconfigured test request")));
});
afterEach(() => vi.unstubAllGlobals());

describe("C1/C2/C3/C5/C6: exact claim action answers", () => {
  const cases: Array<{
    label: string;
    body: unknown;
    status?: number;
    expected: ConsumeClaimState;
  }> = [
    {
      label: "opaque refusal",
      body: { success: false },
      expected: { phase: "invalid", error: INVALID },
    },
    {
      label: "opaque refusal ignores diagnostics",
      body: {
        success: false,
        error: DIAGNOSTIC,
        reason: DIAGNOSTIC,
        message: DIAGNOSTIC,
        email: "holder@example.test",
        organization_name: "Other tenant",
        banned: true,
      },
      expected: { phase: "invalid", error: INVALID },
    },
    { label: "missing success", body: {}, expected: { phase: "invalid", error: INVALID } },
    ...[0, 1, 2].map((n) => ({
      label: `weak password remaining ${n}`,
      body: { success: false, attempts_remaining: n, message: POLICY },
      expected: { phase: "form" as const, attemptsRemaining: n, error: POLICY },
    })),
    {
      label: "policy fallback",
      body: { success: false, attempts_remaining: 2, message: null },
      expected: {
        phase: "form",
        attemptsRemaining: 2,
        error: "Password does not meet complexity requirements.",
      },
    },
    {
      label: "exhausted",
      body: { success: false, attempts_exhausted: true, message: EXHAUSTED },
      expected: { phase: "exhausted", error: EXHAUSTED },
    },
    {
      label: "exhausted fallback",
      body: { success: false, attempts_exhausted: true },
      expected: {
        phase: "exhausted",
        error:
          "Maximum password attempts reached. Please contact your administrator for a new setup link.",
      },
    },
    {
      label: "exhaustion takes precedence over remaining zero",
      body: { success: false, attempts_exhausted: true, attempts_remaining: 0, message: EXHAUSTED },
      expected: { phase: "exhausted", error: EXHAUSTED },
    },
    ...[400, 401, 403, 404, 409, 413, 429, 500, 503].map((status) => ({
      label: `non-2xx ${status} ignores body`,
      status,
      body: { error: "email_exists", reason: DIAGNOSTIC, message: DIAGNOSTIC },
      expected: { phase: "form" as const, error: FAILED },
    })),
  ];

  it.each(cases)("$label", async ({ body, status, expected }) => {
    const response = answer(body, status);
    const json = vi.spyOn(response, "json");
    const fetchMock = vi.fn().mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);
    const state = await consumeClaimAction({ phase: "form" }, form());
    expect(state).toEqual(expected);
    expect(state.fieldErrors).toBeUndefined();
    expect(state.success).toBeUndefined();
    expect(state.sessionId).toBeUndefined();
    expect(JSON.stringify(state).includes(DIAGNOSTIC)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://idp.test/api/v1/auth/claim");
    if (status) expect(json).not.toHaveBeenCalled();
  });

  it.each(["network", "invalid JSON"])("%s keeps the retry form without a probe", async (fault) => {
    const fetchMock = vi.fn();
    if (fault === "network") fetchMock.mockRejectedValueOnce(new Error(DIAGNOSTIC));
    else fetchMock.mockResolvedValueOnce(new Response("not JSON"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await consumeClaimAction({ phase: "form" }, form())).toEqual({
      phase: "form",
      error: NETWORK,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("characterizes null consume JSON as a rejection, not a neutral-screen guarantee", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(answer(null));
    vi.stubGlobal("fetch", fetchMock);
    await expect(consumeClaimAction({ phase: "form" }, form())).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("weak attempts 2, 1, 0 retain the form; the following answer is exhausted", async () => {
    const fetchMock = vi.fn();
    for (const n of [2, 1, 0])
      fetchMock.mockResolvedValueOnce(
        answer({ success: false, attempts_remaining: n, message: POLICY })
      );
    fetchMock.mockResolvedValueOnce(
      answer({ success: false, attempts_exhausted: true, message: EXHAUSTED })
    );
    vi.stubGlobal("fetch", fetchMock);
    let state: ConsumeClaimState = { phase: "form" };
    for (const n of [2, 1, 0]) {
      state = await consumeClaimAction(state, form());
      expect(state).toEqual({ phase: "form", attemptsRemaining: n, error: POLICY });
    }
    expect(await consumeClaimAction(state, form())).toEqual({
      phase: "exhausted",
      error: EXHAUSTED,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(([url]) => url.endsWith("/auth/claim"))).toBe(true);
  });
});

describe("local refusals never ask the IdP", () => {
  it.each([
    ["email", "", "Email is required"],
    ["email", "not-an-email", "Enter a valid email address"],
    ["password", "", "Password is required"],
    ["confirmPassword", "", "Please confirm your password"],
    ["confirmPassword", "different", "Passwords do not match"],
  ])("%s validation", async (key, value, message) => {
    const state = await consumeClaimAction({ phase: "form" }, form({ [key]: value }));
    expect(state.phase).toBe("form");
    expect(state.fieldErrors?.[key as "email" | "password" | "confirmPassword"]).toBe(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("missing token has no rendered token field error", async () => {
    const state = await consumeClaimAction({ phase: "form" }, form({ token: "" }));
    expect(state).toEqual({
      phase: "form",
      fieldErrors: {
        email: undefined,
        password: undefined,
        confirmPassword: undefined,
        name: undefined,
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("overlong name is a local field error", async () => {
    const state = await consumeClaimAction({ phase: "form" }, form({ name: "x".repeat(256) }));
    expect(state.phase).toBe("form");
    expect(typeof state.fieldErrors?.name).toBe("string");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["disabled", "unconfigured"])("%s service", async (kind) => {
    if (kind === "disabled") config.enabled = false;
    else config.configured = false;
    expect(await consumeClaimAction({ phase: "form" }, form())).toEqual({
      phase: "form",
      error: "Service unavailable. Please try again later.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("C4/P1/P2: one consume followed by one login probe", () => {
  const pending = {
    mfa_required: true,
    mfa_enrollment_required: true,
    session_id: "pending-fixture",
  };
  const cases = [
    { label: "200 enrollment", status: 200, body: pending, mfa: true },
    { label: "401 enrollment", status: 401, body: pending, mfa: true },
    { label: "201 pending", status: 201, body: pending, mfa: true },
    {
      label: "no enrollment flag still classifies as MFA",
      status: 200,
      body: { mfa_required: true, session_id: "pending-fixture" },
      mfa: true,
    },
    { label: "missing handle", status: 200, body: { mfa_required: true }, mfa: false },
    { label: "empty handle", status: 401, body: { ...pending, session_id: "" }, mfa: false },
    { label: "non-string handle", status: 200, body: { ...pending, session_id: 1 }, mfa: false },
    { label: "missing MFA flag", status: 200, body: { session_id: "pending-fixture" }, mfa: false },
    { label: "false MFA flag", status: 401, body: { ...pending, mfa_required: false }, mfa: false },
    ...[
      "invalid_credentials",
      "account_unverified",
      "registration_pending",
      "password_change_required",
      "password_expired",
    ].map((error) => ({
      label: error,
      status: 401,
      body: { error, message: DIAGNOSTIC },
      mfa: false,
    })),
    ...[400, 403, 404, 429, 500, 503].map((status) => ({
      label: `HTTP ${status} even with pair`,
      status,
      body: pending,
      mfa: false,
    })),
    { label: "ordinary success", status: 200, body: { success: true }, mfa: false },
    { label: "null login", status: 200, body: null, mfa: false },
    { label: "unexpected array", status: 200, body: [], mfa: false },
  ];

  it.each(cases)("$label", async ({ status, body, mfa }) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(answer({ success: true }))
      .mockResolvedValueOnce(answer(body, status));
    vi.stubGlobal("fetch", fetchMock);
    const state = await consumeClaimAction({ phase: "form" }, form());
    // Compare the state shape without printing pending ceremony values on failure.
    expect(state.phase).toBe(mfa ? "mfa_setup" : "success");
    expect(state.success).toBe(true);
    expect(state.error).toBeUndefined();
    expect(state.sessionId === "pending-fixture").toBe(mfa);
    expect(Object.keys(state).sort()).toEqual(
      mfa ? ["phase", "sessionId", "success"] : ["phase", "success"]
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/v1/auth/claim",
      "/api/v1/auth/login",
    ]);
    const headers = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(headers.get("X-Identuum-Login-Step-Status")).toBe("200");
  });

  it.each(["network", "invalid JSON"])(
    "%s login falls back without resubmitting the claim",
    async (fault) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(answer({ success: true }));
      if (fault === "network") fetchMock.mockRejectedValueOnce(new Error(DIAGNOSTIC));
      else fetchMock.mockResolvedValueOnce(new Response("not JSON"));
      vi.stubGlobal("fetch", fetchMock);
      expect(await consumeClaimAction({ phase: "form" }, form())).toEqual({
        phase: "success",
        success: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );
});
