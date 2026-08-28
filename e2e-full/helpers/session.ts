/**
 * Shared e2e-full site_admin session (THE-ORGANIZATION-SWEEP).
 *
 * The harness bootstraps ONE site_admin per fresh database, and TOTP
 * enrolment is one-shot: the FIRST spec file to log in enrolls and captures
 * the server-minted secret; every later file must go through the
 * already-enrolled MFA-verify path with that same secret. This helper owns
 * that handoff via a run-local secret file under e2e/.auth (gitignored) —
 * written on enrolment, read by every subsequent login, always overwritten
 * by a fresh enrolment so a stale file from a previous run can never win.
 *
 * Shared building blocks, not forks: api() + firstLoginBearerAsync() from
 * e2e/helpers/appliance-fixture, generateTOTP() from e2e/helpers/totp.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { api, firstLoginBearerAsync } from "../../e2e/helpers/appliance-fixture";
import { generateTOTP } from "../../e2e/helpers/totp";

const SECRET_FILE = resolve(__dirname, "..", "..", "e2e", ".auth", "full-site-admin-totp");

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
  } catch {
    // Already enrolled in THIS run — verify with the captured secret.
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
      // TOTP replay protection refuses a code another login just consumed;
      // the next 30s window is accepted, so walk forward rather than sleep.
    }
    throw new Error("site_admin mfa login: no window accepted (replay guard)");
  }
}
