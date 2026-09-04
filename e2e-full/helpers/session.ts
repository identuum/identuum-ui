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
 * Shared building blocks, not forks: api() + firstLoginBearerAsync() from
 * e2e/helpers/appliance-fixture, generateTOTP() from e2e/helpers/totp.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { api, firstLoginBearerAsync } from "../../e2e/helpers/appliance-fixture";
import { generateTOTP } from "../../e2e/helpers/totp";

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
    // Already enrolled in THIS run — verify with the captured secret.
    //
    // THE-GREEN-CI-BASELINE: this catch used to swallow the error entirely
    // and then blame a "replay guard" when the cached secret failed. Both
    // were wrong, and together they cost two mints and hid the cause.
    //
    // The secret file PERSISTS on disk between runs. It is only valid for
    // the appliance that issued it, so when the enrolment path above fails
    // against a FRESH appliance for any reason, this fallback reads a
    // secret from a PREVIOUS one — and then no TOTP window can ever match,
    // because the seed is simply wrong. That is not replay protection (this
    // server has none: both login paths end in a plain RFC 6238 window
    // match, measured in THE-THIRTY-SECOND-WAIT). It is a stale seed.
    const secret = readFileSync(SECRET_FILE, "utf-8").trim();
    const login = await api(base, "POST", "/api/v1/auth/login", { email, password });
    if (login.status !== 401 || !login.json.session_id) {
      throw new Error(`site_admin mfa login: want 401+session_id, got ${login.status}`);
    }
    const sessionId = login.json.session_id as string;
    for (let win = 0; win <= 2; win++) {
      const v = await api(base, "POST", "/api/v1/auth/login/mfa", {
        session_id: sessionId,
        code: generateTOTP(secret, win),
      });
      if (v.status === 200) {
        const bearer = (v.json.access_token as string) ?? "";
        if (bearer.length > 0) return { bearer, totpSecret: secret };
      }
      // Walk a couple of windows for ordinary clock skew between this
      // machine and the appliance — not for a replay guard, which does not
      // exist here.
    }
    // Every window failed, so the seed does not belong to this appliance.
    // Remove it: a secret that cannot log in is worthless, and leaving it
    // makes the NEXT run fail identically instead of re-enrolling.
    try {
      unlinkSync(SECRET_FILE);
    } catch {
      // Nothing to clean up; the message below is what matters.
    }
    throw new Error(
      "site_admin mfa login: the cached TOTP seed does not belong to this appliance — " +
        "no window matched, so it is stale, not replayed. The seed file has been removed so " +
        "the next run re-enrols. THE ENROLMENT PATH FAILED FIRST, and this is why: " +
        String(enrolErr)
    );
  }
}
