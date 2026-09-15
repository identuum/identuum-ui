/**
 * mfa-actions-signed-out.test.ts — THE-SIX-SMALL-ONES, UI 1 (2026-09-16)
 *
 * Each self-service MFA form shows the message that is TRUE for the 401 it
 * got: a refused proof says the code could not be verified; a signed-out
 * session says the session has expired. Before this, both actions mapped
 * every 401 to the invalid-proof copy.
 */
import { describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  regenerateOwnMfaRecoveryCodes: vi.fn(),
  disableOwnMfa: vi.fn(),
}));
vi.mock("../lib/idp-account-client", () => client);
vi.mock("../lib/server-session", () => ({
  getServerSession: async () => ({ role: "org_user", user: { role: "org_user" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import {
  disableMfaAction,
  regenerateRecoveryCodesAction,
} from "../app/account/settings/mfa-actions";

const failure = (
  flags: Partial<
    Record<"unauthorized" | "invalidProof" | "forbidden" | "notEnrolled" | "unavailable", boolean>
  >
) => ({
  ok: false as const,
  status: 401,
  unavailable: false,
  unauthorized: false,
  forbidden: false,
  notEnrolled: false,
  invalidProof: false,
  ...flags,
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("the regenerate form tells a signed-out session from a refused proof", () => {
  it("a signed-out session says so", async () => {
    client.regenerateOwnMfaRecoveryCodes.mockResolvedValueOnce(failure({ unauthorized: true }));
    const state = await regenerateRecoveryCodesAction(
      { phase: "idle" },
      form({ confirm: "REGENERATE", code: "000000" })
    );
    expect(state.phase).toBe("error");
    if (state.phase !== "error") return;
    expect(state.error).toBe("Your session has expired. Sign in again.");
  });

  it("a refused proof still says the code could not be verified", async () => {
    client.regenerateOwnMfaRecoveryCodes.mockResolvedValueOnce(failure({ invalidProof: true }));
    const state = await regenerateRecoveryCodesAction(
      { phase: "idle" },
      form({ confirm: "REGENERATE", code: "000000" })
    );
    expect(state.phase).toBe("error");
    if (state.phase !== "error") return;
    expect(state.error).toMatch(/^Could not verify the code\./);
  });
});

describe("the disable form tells a signed-out session from a refused proof", () => {
  it("a signed-out session says so", async () => {
    client.disableOwnMfa.mockResolvedValueOnce(failure({ unauthorized: true }));
    const state = await disableMfaAction(
      { phase: "idle" },
      form({ confirm: "DISABLE", code: "000000" })
    );
    expect(state.phase).toBe("error");
    if (state.phase !== "error") return;
    expect(state.error).toBe("Your session has expired. Sign in again.");
  });

  it("a refused proof still says the code could not be verified", async () => {
    client.disableOwnMfa.mockResolvedValueOnce(failure({ invalidProof: true }));
    const state = await disableMfaAction(
      { phase: "idle" },
      form({ confirm: "DISABLE", code: "000000" })
    );
    expect(state.phase).toBe("error");
    if (state.phase !== "error") return;
    expect(state.error).toMatch(/^Could not verify the code\./);
    expect(state.fieldErrors?.proof).toBe("Invalid proof.");
  });
});
