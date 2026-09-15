import { describe, expect, it } from "vitest";
import {
  claimUnconsumedTOTPWindow,
  generateTOTP,
  NoUnconsumedTOTPWindowError,
  presentedTOTPSteps,
  refusedAfterFreshStepMessage,
  resetTOTPLedgerForTests,
  totpCodeForStep,
  totpStep,
  unconsumedTOTP,
  unconsumedTOTPAfterFreshStep,
} from "../../e2e/helpers/totp";

// THE-SUITE-THAT-REPLAYED (2026-09-13): the appliance accepts a TOTP code once
// per (user, step); this ledger is what keeps the suite from presenting one
// twice. Every case here is a way the suite could still replay, or fail
// without saying why.
//
// Lives under src/__tests__ like every other vitest file: its first home,
// e2e/helpers/, is Playwright's testDir, whose default testMatch collects
// *.test.ts — Playwright imported vitest, threw, and the whole dev-loop suite
// ran ZERO tests (mint of 2026-09-15, THE-ELEVEN-MISMATCHES).

const SECRET = "JBSWY3DPEHPK3PXP"; // the RFC 6238 test-vector seed
const USER = "ledger-user@e2e.invalid";
const T0 = Date.UTC(2026, 8, 13, 12, 0, 5); // inside step floor(T0/30000)

function fakeClock(startMs: number) {
  let now = startMs;
  const sleeps: number[] = [];
  return {
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    },
    sleeps,
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

describe("unconsumed TOTP windows", () => {
  it("never issues the same step twice: current, then next, then previous, then nothing", () => {
    resetTOTPLedgerForTests(null);
    const step = totpStep(T0);
    const a = claimUnconsumedTOTPWindow(SECRET, USER, T0);
    const b = claimUnconsumedTOTPWindow(SECRET, USER, T0);
    const c = claimUnconsumedTOTPWindow(SECRET, USER, T0);
    const d = claimUnconsumedTOTPWindow(SECRET, USER, T0);
    expect([a?.step, b?.step, c?.step]).toEqual([step, step + 1, step - 1]);
    expect([a?.offset, b?.offset, c?.offset]).toEqual([0, 1, -1]);
    expect(d).toBeNull();
    expect(new Set([a?.code, b?.code, c?.code]).size).toBe(3);
    expect(a?.code).toBe(totpCodeForStep(SECRET, step));
    expect(presentedTOTPSteps(USER, T0)).toEqual([step - 1, step, step + 1]);
  });

  it("the raw generator still names the same code as the ledger for the same step", () => {
    resetTOTPLedgerForTests(null);
    expect(totpCodeForStep(SECRET, totpStep(Date.now()))).toBe(generateTOTP(SECRET, 0));
  });

  it("waits for the next step only when all three windows are spent, and then issues a step nobody presented", async () => {
    resetTOTPLedgerForTests(null);
    const f = fakeClock(T0);
    const step = totpStep(T0);
    const first = await unconsumedTOTP(SECRET, USER, f.clock);
    const second = await unconsumedTOTP(SECRET, USER, f.clock);
    const third = await unconsumedTOTP(SECRET, USER, f.clock);
    expect(f.sleeps).toEqual([]);
    expect(new Set([first, second, third]).size).toBe(3);
    const fourth = await unconsumedTOTP(SECRET, USER, f.clock);
    expect(f.sleeps.length).toBe(1);
    expect(totpStep(f.now)).toBe(step + 1);
    // After the wait the current step is step+1 (spent), so the claim is step+2.
    expect(fourth).toBe(totpCodeForStep(SECRET, step + 2));
    expect(presentedTOTPSteps(USER, f.now)).toEqual([step - 1, step, step + 1, step + 2]);
  });

  it("a fresh-step retry always comes from a step that was not current or next when the refused code was issued", async () => {
    resetTOTPLedgerForTests(null);
    const f = fakeClock(T0);
    const step = totpStep(T0);
    const refused = await unconsumedTOTP(SECRET, USER, f.clock); // step
    expect(refused).toBe(totpCodeForStep(SECRET, step));
    const retry = await unconsumedTOTPAfterFreshStep(SECRET, USER, f.clock);
    expect(f.sleeps.length).toBe(1);
    expect(totpStep(f.now)).toBe(step + 1);
    // step+1 was never presented, so it is the honest retry — inside the server window.
    expect(retry).toBe(totpCodeForStep(SECRET, step + 1));
  });

  it("two users do not share a ledger", () => {
    resetTOTPLedgerForTests(null);
    const a = claimUnconsumedTOTPWindow(SECRET, USER, T0);
    const b = claimUnconsumedTOTPWindow(SECRET, "other-user@e2e.invalid", T0);
    expect(a?.step).toBe(b?.step);
    expect(a?.code).toBe(b?.code);
  });

  it("a user's NEW secret shares the user's ledger: a re-enrolment never re-presents a step the user already presented", () => {
    // THE-ELEVEN-MISMATCHES (2026-09-15): the appliance's guard is keyed by
    // the user. site_admin logged in (old secret, step N), was reset, and
    // re-enrolled with a new secret inside the same step; a ledger keyed by
    // secret issued step N again and the appliance refused the enrolment.
    resetTOTPLedgerForTests(null);
    const step = totpStep(T0);
    // A second seed that DECLARES itself fake: credential-transparency accepts
    // only the RFC 6238 test seed or one repeated character as a TOTP seed.
    const newSecret = "AAAAAAAAAAAAAAAA";
    const before = claimUnconsumedTOTPWindow(SECRET, USER, T0);
    const enrol = claimUnconsumedTOTPWindow(newSecret, USER, T0);
    expect(before?.step).toBe(step);
    expect(enrol?.step, "the re-enrolment takes the next unpresented step, not N again").toBe(
      step + 1
    );
    expect(enrol?.code).toBe(totpCodeForStep(newSecret, step + 1));
    expect(presentedTOTPSteps(USER, T0)).toEqual([step, step + 1]);
  });

  it("FAILS LOUDLY when even a fresh step yields nothing, naming the presented steps, and deletes nothing", async () => {
    resetTOTPLedgerForTests(null);
    const f = fakeClock(T0);
    const step = totpStep(T0);
    // Exhaust the window, then a clock that never advances on sleep: the
    // waited-for fresh step never arrives, which is the impossible case.
    for (let i = 0; i < 3; i++) claimUnconsumedTOTPWindow(SECRET, USER, f.now);
    const stuck = { now: () => f.now, sleep: async () => {} };
    await expect(unconsumedTOTP(SECRET, USER, stuck)).rejects.toBeInstanceOf(
      NoUnconsumedTOTPWindowError
    );
    await expect(unconsumedTOTP(SECRET, USER, stuck)).rejects.toThrow(
      `no unconsumed TOTP window: steps ${step - 1}, ${step} and ${step + 1} were all already presented in this run`
    );
    await expect(unconsumedTOTP(SECRET, USER, stuck)).rejects.toThrow(
      "not a replay and not a stale seed"
    );
    // The ledger is intact after the failure: the same three steps, nothing forgotten.
    expect(presentedTOTPSteps(USER, f.now)).toEqual([step - 1, step, step + 1]);
  });

  it("the refusal-after-fresh-step sentence names the case and promises nothing was deleted", () => {
    resetTOTPLedgerForTests(null);
    claimUnconsumedTOTPWindow(SECRET, USER, T0);
    const msg = refusedAfterFreshStepMessage("site_admin mfa login", USER, T0);
    expect(msg).toContain("a step this run had never presented for this user");
    expect(msg).toContain(`presented steps for this user: ${totpStep(T0)}`);
    expect(msg).toContain("That is not a replay");
    expect(msg).toContain("Nothing was deleted");
    expect(msg).not.toContain(SECRET);
    expect(msg).not.toContain(USER);
  });
});
