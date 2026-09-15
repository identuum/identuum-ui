/**
 * Shared e2e-full site_admin session (THE-ORGANIZATION-SWEEP).
 *
 * The harness bootstraps ONE site_admin per fresh database, and TOTP
 * enrolment is one-shot: the FIRST spec file to log in enrolls and captures
 * the server-minted secret; every later file must go through the
 * already-enrolled MFA-verify path with that same secret. This helper owns
 * that handoff via a run-local secret file under e2e-full/.auth (gitignored, owned by THIS suite) —
 * written on enrolment, read by every subsequent login, always overwritten
 * by a fresh enrolment so a stale file from a previous run can never win.
 *
 * THE-SUITE-THAT-REPLAYED (2026-09-13): the appliance accepts a TOTP code
 * ONCE per (user, step) since identuum-idp-oss's THE-CODE-THAT-WORKS-TWICE,
 * and this helper's first red mint showed the suite had depended on
 * replaying one — three site_admin logins inside a single 30-second step
 * through a window walk (0, 1, 2) that could serve only two of them, then a
 * seed deletion that took four later specs down with the diagnosis. Every
 * code presented here now comes from unconsumedTOTP(): a step this run has
 * never presented, waiting for the next step only when all three windows
 * are spent. A refusal gets exactly one retry from a fresh step; a second
 * refusal is a wrong seed, named as such, and NOTHING is deleted — a
 * failure that destroys its own evidence is not a diagnosis.
 *
 * Shared building blocks, not forks: api() + firstLoginBearerAsync() from
 * e2e/helpers/appliance-fixture, unconsumedTOTP() from e2e/helpers/totp.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { api, firstLoginBearerAsync } from "../../e2e/helpers/appliance-fixture";
import {
  refusedAfterFreshStepMessage,
  unconsumedTOTP,
  unconsumedTOTPAfterFreshStep,
} from "../../e2e/helpers/totp";

const SECRET_FILE = resolve(__dirname, "..", ".auth", "full-site-admin-totp");

export async function siteAdminSession(
  base: string,
  email: string,
  password: string
): Promise<{ bearer: string; totpSecret: string }> {
  try {
    const first = await firstLoginBearerAsync(base, email, password);
    mkdirSync(dirname(SECRET_FILE), { recursive: true });
    writeFileSync(SECRET_FILE, first.totpSecret, { mode: 0o600 });
    return first;
  } catch (enrolErr) {
    // Already enrolled in THIS run — verify with the captured secret. The
    // enrolment error stays BOUND: every failure below carries it.
    let secret: string;
    try {
      secret = readFileSync(SECRET_FILE, "utf-8").trim();
    } catch (readErr) {
      throw new Error(
        "site_admin mfa login: the enrolment path failed and no captured seed exists to verify with " +
          `(${SECRET_FILE}: ${String(readErr)}). THE ENROLMENT PATH FAILED FIRST, and this is why: ${String(enrolErr)}`
      );
    }
    const login = await api(base, "POST", "/api/v1/auth/login", { email, password });
    if (login.status !== 401 || !login.json.session_id) {
      throw new Error(`site_admin mfa login: want 401+session_id, got ${login.status}`);
    }
    const sessionId = login.json.session_id as string;
    const verify = async (code: string) =>
      api(base, "POST", "/api/v1/auth/login/mfa", { session_id: sessionId, code });

    // One attempt from an unconsumed window; on refusal exactly one more from
    // a fresh step, which cannot be a replay by construction.
    let v = await verify(await unconsumedTOTP(secret, email));
    if (v.status !== 200) {
      v = await verify(await unconsumedTOTPAfterFreshStep(secret, email));
    }
    if (v.status === 200) {
      const bearer = (v.json.access_token as string) ?? "";
      if (bearer.length > 0) return { bearer, totpSecret: secret };
      throw new Error("site_admin mfa login: verify answered 200 without an access_token");
    }
    // A code from a never-presented step was refused: the seed is stale, not
    // replayed. It is NOT deleted — full-run.sh removes it at RUN START, ahead
    // of the teardown, which is what keeps a seed from outliving its
    // appliance; a deletion here would only destroy the evidence and take
    // every later spec down with a missing-file error.
    throw new Error(
      `${refusedAfterFreshStepMessage("site_admin mfa login", email)} ` +
        `The seed is stale, not replayed. Last verify status: ${v.status}. Seed file left in place: ${SECRET_FILE}. ` +
        `THE ENROLMENT PATH FAILED FIRST, and this is why: ${String(enrolErr)}`
    );
  }
}
