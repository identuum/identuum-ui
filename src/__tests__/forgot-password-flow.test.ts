/**
 * Behavior-contract tests for the forgot-password / reset-password flow.
 *
 * Both server actions are exercised directly against a stubbed fetch.
 * The tests pin:
 *   - The no-enumeration invariant on /forgot-password: every backend
 *     response that does not bring down the network surfaces the same
 *     "sent" state, with no field-level hint of account existence.
 *   - Field-level validation on /forgot-password (empty, malformed email).
 *   - That the /reset-password action requires a non-empty token (page
 *     loaded without `?token=…` surfaces the invalid-token panel).
 *   - That the /reset-password action forwards token + new_password to
 *     the IDP and never echoes the token back to the client state.
 *   - That a 400 ErrInvalidResetToken response maps to phase=invalid.
 *   - That a 400 ErrWeakPassword response maps back to a field-level
 *     password error with bounded copy (not the raw IDP message).
 *   - That a successful reset surfaces the login-oriented success state.
 *   - That the password-form component's /forgot-password link resolves
 *     to a real route file in the tree.
 *
 * Synthetic fake tokens are used throughout — they are obviously not
 * real values and never appear in any assertion message.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://localhost:7114",
    idp: { enabled: true, public_base_url: "http://localhost:7113" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://localhost:7113",
}));

import { requestPasswordResetAction } from "../app/forgot-password/actions";
import { consumeResetTokenAction } from "../app/reset-password/actions";

// Helper: synthesize a FormData from a plain object. The real Next.js
// runtime gives the action a FormData instance; in tests we hand-build it.
function fd(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(values)) form.set(k, v);
  return form;
}

// Helper: mount a stub fetch that returns the given response. The IDP
// always returns HTTP 200 + generic body for reset-request; for the reset
// completion we vary the body to exercise the different error mappings.
function stubFetch(status: number, body: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

beforeEach(() => {
  // Each test installs its own stub via stubFetch; reset between cases.
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── /forgot-password ──────────────────────────────────────────────────────────

describe("requestPasswordResetAction — generic success on every non-network response", () => {
  it("surfaces phase=sent when the IDP returns 200 with generic copy (account exists shape)", async () => {
    stubFetch(200, {
      success: true,
      message: "If an account exists with this email, a password reset link has been sent.",
    });
    const state = await requestPasswordResetAction(
      { phase: "form" },
      fd({ email: "owner@example.com" })
    );
    expect(state.phase).toBe("sent");
    expect(state.error).toBeUndefined();
    expect(state.fieldErrors).toBeUndefined();
  });

  it("STILL surfaces phase=sent when the IDP returns the same 200 body for a non-matching email (no enumeration)", async () => {
    // The IDP wire shape is identical for "found" and "not found" — both
    // are HTTP 200 with the same generic message. The action must not
    // attempt to distinguish them.
    stubFetch(200, {
      success: true,
      message: "If an account exists with this email, a password reset link has been sent.",
    });
    const state = await requestPasswordResetAction(
      { phase: "form" },
      fd({ email: "nobody@example.com" })
    );
    expect(state.phase).toBe("sent");
  });

  it("rejects empty email at the field level (no IDP call)", async () => {
    // No stubFetch — if the action attempts a real network call this test
    // would throw, exposing the regression.
    const state = await requestPasswordResetAction({ phase: "form" }, fd({ email: "" }));
    expect(state.phase).toBe("form");
    expect(state.fieldErrors?.email).toBeTruthy();
  });

  it("rejects malformed email at the field level (no IDP call)", async () => {
    const state = await requestPasswordResetAction(
      { phase: "form" },
      fd({ email: "not-an-email" })
    );
    expect(state.phase).toBe("form");
    expect(state.fieldErrors?.email).toBeTruthy();
  });

  it("normalises email to lowercase + trim before forwarding", async () => {
    const seenBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        seenBodies.push(String(init?.body ?? ""));
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      })
    );
    await requestPasswordResetAction({ phase: "form" }, fd({ email: "  Owner@Example.COM  " }));
    expect(seenBodies).toHaveLength(1);
    const body = JSON.parse(seenBodies[0]) as { email: string };
    expect(body.email).toBe("owner@example.com");
  });

  it("never echoes the email back into the returned state", async () => {
    stubFetch(200, { success: true });
    const state = await requestPasswordResetAction(
      { phase: "form" },
      fd({ email: "owner@example.com" })
    );
    expect(JSON.stringify(state)).not.toContain("owner@example.com");
  });
});

// ── /reset-password ──────────────────────────────────────────────────────────

describe("consumeResetTokenAction — token requirement + IDP forwarding", () => {
  it("surfaces phase=invalid when the page submits without a token", async () => {
    const state = await consumeResetTokenAction(
      { phase: "form" },
      fd({ token: "", newPassword: "Aa1!aa1!", confirmPassword: "Aa1!aa1!" })
    );
    expect(state.phase).toBe("invalid");
  });

  it("field-validates the new password (too short)", async () => {
    const state = await consumeResetTokenAction(
      { phase: "form" },
      fd({ token: "FAKE_RESET_TOKEN_xxx", newPassword: "short", confirmPassword: "short" })
    );
    expect(state.phase).toBe("form");
    expect(state.fieldErrors?.newPassword).toBeTruthy();
  });

  it("field-validates that confirm matches", async () => {
    const state = await consumeResetTokenAction(
      { phase: "form" },
      fd({
        token: "FAKE_RESET_TOKEN_xxx",
        newPassword: "Aa1!aa1!",
        confirmPassword: "Aa1!aa1!DIFFERENT",
      })
    );
    expect(state.phase).toBe("form");
    expect(state.fieldErrors?.confirmPassword).toBeTruthy();
  });

  it("forwards token + new_password to IDP and surfaces success", async () => {
    const seenBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        seenBodies.push(String(init?.body ?? ""));
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      })
    );
    const state = await consumeResetTokenAction(
      { phase: "form" },
      fd({
        token: "FAKE_RESET_TOKEN_xxx",
        newPassword: "Aa1!aa1!",
        confirmPassword: "Aa1!aa1!",
      })
    );
    expect(state.phase).toBe("success");
    expect(seenBodies).toHaveLength(1);
    const body = JSON.parse(seenBodies[0]) as { token: string; new_password: string };
    expect(body.token).toBe("FAKE_RESET_TOKEN_xxx");
    expect(body.new_password).toBe("Aa1!aa1!");
  });

  it("does NOT echo the token in the returned state on success", async () => {
    stubFetch(200, { success: true });
    const state = await consumeResetTokenAction(
      { phase: "form" },
      fd({
        token: "FAKE_RESET_TOKEN_xxx",
        newPassword: "Aa1!aa1!",
        confirmPassword: "Aa1!aa1!",
      })
    );
    expect(JSON.stringify(state)).not.toContain("FAKE_RESET_TOKEN_xxx");
  });

  it("does NOT echo the token in the returned state on invalid-token error", async () => {
    stubFetch(400, {
      code: "ERROR_CODE_INVALID_RESET_TOKEN",
      message: "Invalid or expired reset token",
    });
    const state = await consumeResetTokenAction(
      { phase: "form" },
      fd({
        token: "FAKE_RESET_TOKEN_xxx",
        newPassword: "Aa1!aa1!",
        confirmPassword: "Aa1!aa1!",
      })
    );
    expect(state.phase).toBe("invalid");
    expect(JSON.stringify(state)).not.toContain("FAKE_RESET_TOKEN_xxx");
  });

  it("maps weak-password backend response to a bounded field-level error", async () => {
    stubFetch(400, {
      code: "WEAK_PASSWORD",
      message: "password is too weak",
    });
    const state = await consumeResetTokenAction(
      { phase: "form" },
      fd({
        token: "FAKE_RESET_TOKEN_xxx",
        newPassword: "Aa1!aa1!",
        confirmPassword: "Aa1!aa1!",
      })
    );
    expect(state.phase).toBe("form");
    expect(state.fieldErrors?.newPassword).toBeTruthy();
    // The raw IDP message must NOT leak through. The action surfaces its
    // own bounded copy.
    expect(state.fieldErrors?.newPassword).not.toBe("password is too weak");
  });

  it("defaults unknown 4xx to phase=invalid (do not loop on raw error)", async () => {
    stubFetch(418, { code: "WEIRD", message: "something the UI does not know" });
    const state = await consumeResetTokenAction(
      { phase: "form" },
      fd({
        token: "FAKE_RESET_TOKEN_xxx",
        newPassword: "Aa1!aa1!",
        confirmPassword: "Aa1!aa1!",
      })
    );
    expect(state.phase).toBe("invalid");
  });
});

// ── Cross-spec: password-form's link points at a real route ──────────────────

describe("/forgot-password link from the password step is now a real route", () => {
  it("src/app/forgot-password/page.tsx exists in the tree", () => {
    const p = resolve(__dirname, "..", "app", "forgot-password", "page.tsx");
    expect(existsSync(p)).toBe(true);
  });

  it("src/app/reset-password/page.tsx exists in the tree", () => {
    const p = resolve(__dirname, "..", "app", "reset-password", "page.tsx");
    expect(existsSync(p)).toBe(true);
  });
});
