import * as crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function base32ToBuffer(base32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = base32.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const idx = alphabet.indexOf(char);
    if (idx < 0) throw new Error(`Invalid base32 char: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 step length the appliance uses (seconds). */
export const TOTP_PERIOD_SECONDS = 30;

/** The appliance accepts the current step and one on either side. */
export const TOTP_SERVER_WINDOW = 1;

/** The step number containing the instant nowMs (default: now): RFC 6238, 30 s steps. */
export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / 30);
}

/** Milliseconds until the next step boundary, plus a small margin. */
export function msUntilNextTOTPStep(nowMs: number = Date.now(), marginMs = 250): number {
  const periodMs = TOTP_PERIOD_SECONDS * 1000;
  return periodMs - (nowMs % periodMs) + marginMs;
}

/** The code for an explicit step of a secret. */
export function totpCodeForStep(secret: string, step: number): string {
  const key = base32ToBuffer(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", key);
  hmac.update(counter);
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/**
 * Generates a 6-digit TOTP code (RFC 6238, SHA-1, 30s window).
 * windowOffset shifts the time window: -1 = previous, 0 = current, 1 = next.
 *
 * This is the raw generator. A code that is going to be PRESENTED for
 * acceptance must come from unconsumedTOTP() below: since
 * THE-CODE-THAT-WORKS-TWICE (identuum-idp-oss, 2026-09-13) the appliance
 * accepts each (user, step) once, and a suite that computed the same step
 * twice inside one 30-second window was replaying a one-time password.
 */
export function generateTOTP(secret: string, windowOffset = 0): string {
  return totpCodeForStep(secret, totpStep() + windowOffset);
}

// ── Issued-step ledger (THE-SUITE-THAT-REPLAYED, 2026-09-13) ─────────────────
//
// The appliance accepts a TOTP code once per (USER, step). This ledger
// remembers, per user, every step this suite has already PRESENTED, so a later
// login by the same user picks a window it has not used: the current step,
// then the next, then the previous — all three inside the server's ±1 window —
// and, when all three are spent, waits for the next step boundary, after which
// a fresh step exists by construction. Steps are marked when a code is ISSUED,
// not when the server answers (pessimistic): a wasted step costs at most one
// wait, a reused step costs a red run.
//
// KEYED BY THE USER, NOT THE SECRET (THE-ELEVEN-MISMATCHES, 2026-09-15). The
// first cut keyed this ledger by a digest of the secret, and the appliance
// keys its guard by the user: when site_admin was reset and re-enrolled with a
// NEW secret inside the same 30-second step as its pre-reset login, the new
// secret's ledger was empty, the current step was issued again for the same
// user, and the appliance refused the enrolment as the replay it was
// (admin-reset, mint of 2026-09-15). Every caller names the user whose code it
// presents — every login helper already has the email in hand — so a user's
// steps are one set across every secret that user ever holds in a run.
//
// The ledger is keyed by a digest of the identity, never the identity or the
// secret, and is mirrored to a run-local file under the gitignored e2e/.auth
// directory so the separate Playwright processes of one harness run
// (api-suite, provisioner, devloop) share it. Entries older than the server
// window are dropped on load.

export type TOTPLedger = Map<string, Set<number>>;

const LEDGER_FILE = resolve(__dirname, "..", ".auth", "totp-issued-steps.json");

let ledger: TOTPLedger | null = null;
let ledgerPath: string | null = LEDGER_FILE;

/** The ledger key for a user (a digest — the identity itself is never written). */
function ledgerKey(subject: string): string {
  return crypto.createHash("sha256").update(`user:${subject}`).digest("hex").slice(0, 16);
}

function loadLedger(nowMs: number): TOTPLedger {
  if (ledger) return ledger;
  const fresh: TOTPLedger = new Map();
  if (ledgerPath && existsSync(ledgerPath)) {
    try {
      const raw = JSON.parse(readFileSync(ledgerPath, "utf-8")) as Record<string, number[]>;
      const floor = totpStep(nowMs) - TOTP_SERVER_WINDOW - 1;
      for (const [key, steps] of Object.entries(raw)) {
        const live = steps.filter((s) => Number.isInteger(s) && s >= floor);
        if (live.length > 0) fresh.set(key, new Set(live));
      }
    } catch {
      // An unreadable ledger is an empty ledger: the fresh-step retry in
      // unconsumedTOTP still guarantees a never-presented step, one wait later.
    }
  }
  ledger = fresh;
  return fresh;
}

function saveLedger(l: TOTPLedger): void {
  if (!ledgerPath) return;
  try {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    const out: Record<string, number[]> = {};
    for (const [key, steps] of l) out[key] = [...steps].sort((a, b) => a - b);
    writeFileSync(ledgerPath, JSON.stringify(out), { mode: 0o600 });
  } catch {
    // Best effort, like the login cooldown file: the in-memory ledger still
    // governs this process, and the fresh-step retry covers the rest.
  }
}

/**
 * Test seam: point the ledger at another file (or null for memory only) and
 * forget what this process has issued.
 */
export function resetTOTPLedgerForTests(path: string | null = null): void {
  ledger = null;
  ledgerPath = path;
}

/** The steps this suite has already presented for a user (for diagnostics). */
export function presentedTOTPSteps(subject: string, nowMs: number = Date.now()): number[] {
  const steps = loadLedger(nowMs).get(ledgerKey(subject));
  return steps ? [...steps].sort((a, b) => a - b) : [];
}

export interface ClaimedTOTP {
  code: string;
  step: number;
  /** Offset from the current step: 0, +1 or -1. */
  offset: number;
}

/**
 * Claims the first window in [current, next, previous] whose step this suite
 * has not presented for the user yet, marks it as presented, and returns its
 * code computed from the secret. Returns null when all three are spent — the
 * caller waits for the next step.
 */
export function claimUnconsumedTOTPWindow(
  secret: string,
  subject: string,
  nowMs: number = Date.now()
): ClaimedTOTP | null {
  const l = loadLedger(nowMs);
  const key = ledgerKey(subject);
  const used = l.get(key) ?? new Set<number>();
  const current = totpStep(nowMs);
  for (const offset of [0, 1, -1]) {
    const step = current + offset;
    if (used.has(step)) continue;
    used.add(step);
    l.set(key, used);
    saveLedger(l);
    return { code: totpCodeForStep(secret, step), step, offset };
  }
  return null;
}

/** Thrown when even a fresh step yielded no unconsumed window (a bug, not a race). */
export class NoUnconsumedTOTPWindowError extends Error {
  constructor(subject: string, nowMs: number) {
    const current = totpStep(nowMs);
    super(
      `no unconsumed TOTP window: steps ${current - 1}, ${current} and ${current + 1} were all already presented in this run ` +
        `(presented steps for this user: ${presentedTOTPSteps(subject, nowMs).join(", ") || "none"}); ` +
        "a fresh step was waited for and still yielded nothing — the ledger is inconsistent, this is not a replay and not a stale seed"
    );
    this.name = "NoUnconsumedTOTPWindowError";
  }
}

export interface TOTPClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realClock: TOTPClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * A code for a step this suite has NOT presented for the user before. Prefers
 * the current step, then the next, then the previous; when all three are
 * spent it waits for the next step boundary — the only case in which waiting
 * is the honest answer — and claims again. Never returns a code for a step
 * the user already presented, whatever secret it was computed from.
 *
 * `subject` is the user the code will be presented for (the login email):
 * the appliance's single-use guard is keyed by the user, so the ledger is too.
 */
export async function unconsumedTOTP(
  secret: string,
  subject: string,
  clock: TOTPClock = realClock
): Promise<string> {
  const first = claimUnconsumedTOTPWindow(secret, subject, clock.now());
  if (first) return first.code;
  await clock.sleep(msUntilNextTOTPStep(clock.now()));
  const second = claimUnconsumedTOTPWindow(secret, subject, clock.now());
  if (second) return second.code;
  throw new NoUnconsumedTOTPWindowError(subject, clock.now());
}

/**
 * Waits for the next step boundary FIRST, then claims — for a retry after the
 * appliance refused a code: the result is from a step that did not exist as
 * "current or next" when the refused code was issued, so a second refusal can
 * only mean the secret is not this appliance's. Callers use exactly one of
 * these per refusal and then fail loudly.
 */
export async function unconsumedTOTPAfterFreshStep(
  secret: string,
  subject: string,
  clock: TOTPClock = realClock
): Promise<string> {
  await clock.sleep(msUntilNextTOTPStep(clock.now()));
  return unconsumedTOTP(secret, subject, clock);
}

/**
 * The sentence a helper throws when a code from a never-presented step is
 * refused: it names what was tried so the failure explains itself, and it
 * says what it did NOT do — nothing is deleted on this path.
 */
export function refusedAfterFreshStepMessage(
  who: string,
  subject: string,
  nowMs: number = Date.now()
): string {
  return (
    `${who}: the appliance refused a TOTP code from a step this run had never presented for this user ` +
    `(presented steps for this user: ${presentedTOTPSteps(subject, nowMs).join(", ") || "none"}; current step ${totpStep(nowMs)}). ` +
    "That is not a replay — every code came from an unconsumed window — so the secret does not belong to this appliance " +
    "(a seed captured from a previous appliance, or a different account). Nothing was deleted: the seed file and the ledger are left for diagnosis."
  );
}
