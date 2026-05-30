/**
 * Tests for the claim → MFA enrollment chain added in
 * identuum-20260527-complete-org-admin-claim-mfa-setup-ux.
 *
 * The server action consumeClaimAction now performs three calls in
 * sequence:
 *   1. POST /api/v1/auth/claim     — consume the one-time token.
 *   2. POST /api/v1/auth/login     — open a pending MFA-enrollment
 *                                    session with the just-set
 *                                    credentials.
 *   3. (browser) /api/idp/.../mfa/enroll/* — driven by MFAEnrollForm.
 *
 * These tests pin the new wire shape and the fallback behavior when
 * the post-claim login probe cannot be opened. They do NOT exercise
 * MFAEnrollForm itself (existing component, already covered by the
 * login-flow tests) — only the action's contract with it.
 *
 * Security invariant: the password supplied to the action is consumed
 * server-side, never returned to the client, and never logged. These
 * tests assert that no password value appears in any field of the
 * returned ConsumeClaimState.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeClaimAction } from "../app/claim/actions";

// Mock the runtime-config loader so the action sees an enabled IdP
// without needing a real config file on disk.
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://localhost:7114",
    idp: { enabled: true, public_base_url: "http://localhost:7113" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://localhost:7113",
}));

const validForm = () => {
  const fd = new FormData();
  fd.set("token", "fake-claim-token-not-real");
  fd.set("email", "newadmin@example.com");
  fd.set("password", "StrongPassw0rd!");
  fd.set("confirmPassword", "StrongPassw0rd!");
  // The HTML form always submits a name field (empty when blank). The
  // server-side schema's z.string().max(255).optional() accepts an
  // empty string but rejects null — formData.get("name") returns null
  // when the key is absent, so set it explicitly in tests.
  fd.set("name", "");
  return fd;
};

describe("consumeClaimAction — claim → MFA enrollment chain", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns phase=mfa_setup with sessionId after successful claim + pending login", async () => {
    // 1st fetch: /auth/claim → success
    // 2nd fetch: /auth/login → mfa_required + pending session_id
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mfa_required: true,
          session_id: "019e6900-fake-7000-pending-session",
          tokens: null,
          message: "MFA required",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const state = await consumeClaimAction({ phase: "form" }, validForm());

    expect(state.phase).toBe("mfa_setup");
    expect(state.success).toBe(true);
    expect(state.sessionId).toBe("019e6900-fake-7000-pending-session");
    expect(state.error).toBeUndefined();
    // The password supplied to the action must never appear in the
    // returned state — this is the no-leak invariant.
    expect(JSON.stringify(state)).not.toContain("StrongPassw0rd!");
  });

  it("falls back to phase=success when the post-claim login probe returns non-OK", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "internal" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const state = await consumeClaimAction({ phase: "form" }, validForm());

    // Legacy "go to /login" success path so the user is not stranded.
    // The backend login gate still enforces MFA on the next sign-in.
    expect(state.phase).toBe("success");
    expect(state.sessionId).toBeUndefined();
  });

  it("falls back to phase=success when the login probe network call throws", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const state = await consumeClaimAction({ phase: "form" }, validForm());

    expect(state.phase).toBe("success");
    expect(state.sessionId).toBeUndefined();
  });

  it("falls back to phase=success when the login response shape is unexpected", async () => {
    // Login returns 200 but does not include mfa_required=true. This
    // is unexpected today (the IDP login gate always returns
    // mfa_required=true for an admin without MFA enrolled), but the
    // action must degrade gracefully.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tokens: null }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const state = await consumeClaimAction({ phase: "form" }, validForm());

    expect(state.phase).toBe("success");
    expect(state.sessionId).toBeUndefined();
  });

  it("preserves max-attempts-exhausted behavior — login probe is NOT issued", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: false,
        attempts_exhausted: true,
        message: "Maximum password attempts reached",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = await consumeClaimAction({ phase: "form" }, validForm());

    expect(state.phase).toBe("exhausted");
    // Only ONE fetch call (the claim consume). The login probe must
    // not be issued for a burned token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves invalid-token behavior — login probe is NOT issued", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = await consumeClaimAction({ phase: "form" }, validForm());

    expect(state.phase).toBe("invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("password-policy violation stays in phase=form with attempts_remaining surfaced", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: false,
        attempts_remaining: 2,
        message: "Password too weak",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = await consumeClaimAction({ phase: "form" }, validForm());

    expect(state.phase).toBe("form");
    expect(state.attemptsRemaining).toBe(2);
    expect(state.sessionId).toBeUndefined();
  });
});
