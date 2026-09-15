/**
 * account-client-401-reasons.test.ts — THE-SIX-SMALL-ONES, UI 1 (2026-09-16)
 *
 * A 401 from the IdP is one of two truths, and the server says which:
 *   - the PROOF was refused — OSS answers `invalid_code`, CE `invalid_proof`;
 *   - the SESSION is gone — OSS answers `unauthorized` (with a reason), CE
 *     `not_authenticated`, or there is no JSON body at all.
 * failedMutation used to set both `unauthorized` and `invalidProof` on
 * every 401, so a session expiring mid-action showed "Could not verify the
 * code" to a user who was simply signed out. The client now reads what the
 * server said; the flags are exclusive on a 401.
 *
 * SECURITY: synthetic responses only; no credential, cookie or secret value
 * appears here. The access_token cookie in the mock is a placeholder string.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "access_token", value: "placeholder" }] }),
}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    idp: {
      enabled: true,
      public_base_url: "http://idp.test",
      internal_base_url: "http://idp.test",
    },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

import { disableOwnMfa, regenerateOwnMfaRecoveryCodes } from "../lib/idp-account-client";

function serverAnswers(status: number, body?: unknown): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
  ) as unknown as typeof fetch;
}

const calls = {
  regenerate: () => regenerateOwnMfaRecoveryCodes({ code: "000000" }),
  disable: () => disableOwnMfa({ code: "000000" }),
};

describe("a 401 is read for what the server said", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  for (const [name, call] of Object.entries(calls)) {
    describe(name, () => {
      it("a signed-out session (OSS `unauthorized`) is unauthorized, NOT an invalid proof", async () => {
        serverAnswers(401, { error: "unauthorized", reason: "token_expired" });
        const r = await call();
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.unauthorized).toBe(true);
        expect(r.invalidProof).toBe(false);
      });

      it("a signed-out session (CE `not_authenticated`) is unauthorized, NOT an invalid proof", async () => {
        serverAnswers(401, { error: "not_authenticated" });
        const r = await call();
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.unauthorized).toBe(true);
        expect(r.invalidProof).toBe(false);
      });

      it("a 401 with no body is unauthorized, NOT an invalid proof", async () => {
        serverAnswers(401);
        const r = await call();
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.unauthorized).toBe(true);
        expect(r.invalidProof).toBe(false);
      });

      it("a refused proof (OSS `invalid_code`) is an invalid proof, NOT a signed-out session", async () => {
        serverAnswers(401, { error: "invalid_code" });
        const r = await call();
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.invalidProof).toBe(true);
        expect(r.unauthorized).toBe(false);
      });

      it("a refused proof (CE `invalid_proof`) is an invalid proof, NOT a signed-out session", async () => {
        serverAnswers(401, { error: "invalid_proof" });
        const r = await call();
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.invalidProof).toBe(true);
        expect(r.unauthorized).toBe(false);
      });

      it("the other statuses keep their meaning", async () => {
        serverAnswers(403, { error: "mfa_required" });
        const forbidden = await call();
        expect(!forbidden.ok && forbidden.forbidden && !forbidden.unauthorized).toBe(true);
        serverAnswers(400, { error: "mfa_not_enrolled" });
        const notEnrolled = await call();
        expect(!notEnrolled.ok && notEnrolled.notEnrolled && !notEnrolled.invalidProof).toBe(true);
      });
    });
  }
});
