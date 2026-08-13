/**
 * End-to-end OSS-5 `/account/settings` change-password browser
 * coverage, added by
 * `agent-a-20260620-idp-ui-oss-change-password-playwright` to close
 * the OSS-MATRIX OSS-5 browser-UI gap noted in
 * `identuum-idp-oss/docs/OSS_MANUAL_TEST_MATRIX.md`.
 *
 * What this spec asserts.
 *   1. Operator logs in via the `/login` form with the supplied
 *      current credentials.
 *   2. Navigates to `/account/settings` (the password tab is the
 *      default).
 *   3. Fills the change-password form with current → runtime-
 *      generated temp password; submits. The form's success panel
 *      reads "Password changed successfully." and "All sessions have
 *      been revoked" — the auto-redirect at +2.5s navigates the
 *      browser to `/login`.
 *   4. Re-logs in with the TEMP password (proves the new credential
 *      took effect).
 *   5. (Optional verification) Logs out, attempts login with the OLD
 *      password — asserts failure (proves the old credential was
 *      revoked).
 *   6. Rotate-back: re-logs in with TEMP, navigates to
 *      `/account/settings`, submits change-password (temp →
 *      original), asserts the same success panel.
 *   7. Re-logs in with the ORIGINAL password (proves cleanup
 *      succeeded).
 *
 * Cleanup-safe try/finally.
 *   The finally block tracks `passwordKnownToWork` — the credential
 *   the spec last successfully logged in with. If the body fails
 *   AFTER the first rotation but BEFORE the rotate-back, the
 *   finally block attempts the rotate-back using `passwordKnownToWork`
 *   (which would be the temp password). A best-effort recovery so
 *   the operator's account is not left on an unknown password.
 *
 * Env gate (REQUIRED — defaults to skip):
 *   - `IDENTUUM_E2E_OSS_CHANGE_PASSWORD=1` → run the destructive
 *     ceremony.
 *
 * Operator env vars (NEVER printed by this spec).
 *   - `IDP_BASE_URL` — IDP backend URL (default
 *     `http://127.0.0.1:7113` — the OSS dev-stack port).
 *   - `IDENTUUM_E2E_BASE_URL` — UI baseURL (default
 *     `http://127.0.0.1:7104`).
 *   - `IDENTUUM_OSS_TEST_USER_EMAIL` — the user the spec drives.
 *     Operators are strongly advised to use a DISPOSABLE test user
 *     (NOT their real site_admin) so a worst-case mid-rotation
 *     failure is easy to recover via `/admin/users/{id}/password-reset`.
 *   - `IDENTUUM_OSS_TEST_USER_PASSWORD` — current (original)
 *     password.
 *
 * Secret-safety contract.
 *   - The current + temp passwords are fed directly to
 *     `page.locator(...).fill(value)` — Playwright does NOT log
 *     fill values. The runtime-generated temp password lives only
 *     in the test closure and never leaves it.
 *   - On-failure diagnostic prints ONLY public URLs + visible page
 *     heading text — no env values, no cookies, no password
 *     characters.
 *   - The MFA-enrollment + recovery-codes surface is NOT touched.
 *   - No license envelope bytes, recovery codes, JWTs, cookies,
 *     session IDs, or DB URLs are ever read.
 *
 * Why the test user must NOT require TOTP.
 *   The standard `loginAsSiteAdmin*` helpers in `e2e/helpers/login.ts`
 *   handle the TOTP step against an admin with MFA enrolled — but
 *   this spec needs to re-log in 3+ times with different passwords,
 *   which would exhaust the TOTP replay window. The spec therefore
 *   drives the bare `/login` form inline and is designed for a user
 *   with `mfa_enabled=false` (typical of a freshly-created OSS user
 *   or a disposable test account).
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const CHANGE_PW_ENABLED = process.env.IDENTUUM_E2E_OSS_CHANGE_PASSWORD === "1";

async function loginViaForm(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page
    .getByRole("button", { name: /Sign in|Log in|Continue/i })
    .first()
    .click();
  // Race the success path (any navigation away from /login) against a
  // visible inline error. Either resolves within ~10s.
  const outcome = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 })
      .then(() => "ok" as const)
      .catch(() => "timeout" as const),
    page
      .getByRole("alert")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => "error" as const)
      .catch(() => "timeout" as const),
  ]);
  return outcome === "ok";
}

async function submitChangePassword(page: Page, current: string, next: string): Promise<void> {
  await page.goto("/account/settings");
  // Password tab is the default per the route guard.
  await page.locator('input[name="current_password"]').fill(current);
  await page.locator('input[name="new_password"]').fill(next);
  await page.locator('input[name="confirm_password"]').fill(next);
  await page
    .getByRole("button", { name: /Change password/i })
    .first()
    .click();
  // Success state pinned by the form source — "Password changed successfully."
  // + "All sessions have been revoked."
  await expect(
    page.getByText("Password changed successfully."),
    "form must render the success panel after a valid rotation"
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/All sessions have been revoked/i),
    "form must surface the all-sessions-revoked notice (the load-bearing product behavior)"
  ).toBeVisible({ timeout: 5_000 });
}

test.describe("/account/settings — change password (rotate + rotate-back)", () => {
  test.skip(
    !CHANGE_PW_ENABLED,
    "IDENTUUM_E2E_OSS_CHANGE_PASSWORD is not 1 — skipping the destructive change-password ceremony. " +
      "The spec rotates the operator-supplied user's password through a runtime-generated temp value " +
      "and rotates it back. Run it standalone against a DISPOSABLE test user (NOT your real site_admin) " +
      "on a freshly-provisioned OSS stack."
  );

  test("rotate → temp login → old login fails [PASSWORD-ROTATE-1] → rotate back → original login works", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const email = process.env.IDENTUUM_OSS_TEST_USER_EMAIL ?? "";
    const originalPassword = process.env.IDENTUUM_OSS_TEST_USER_PASSWORD ?? "";
    if (email === "" || originalPassword === "") {
      test.skip(
        true,
        "Operator env vars missing: IDENTUUM_OSS_TEST_USER_EMAIL + IDENTUUM_OSS_TEST_USER_PASSWORD must both be set. Values NEVER printed."
      );
      return;
    }

    // Runtime-generated temp password. Strong enough to pass policy
    // (mixed case + digit + symbol + length). Lives ONLY in this
    // closure; never echoed or asserted by value.
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 1_000_000);
    const tempPassword = `Identuum-E2E-Rotate-${ts}-${rand}-Aa1!`;

    let passwordKnownToWork = originalPassword;
    let rotatedToTemp = false;

    try {
      // 1. Log in with the original password.
      const okStart = await loginViaForm(page, email, originalPassword);
      expect(
        okStart,
        "initial login with the operator-supplied original password must succeed"
      ).toBe(true);

      // 2. Rotate: original → temp.
      await submitChangePassword(page, originalPassword, tempPassword);
      rotatedToTemp = true;
      passwordKnownToWork = tempPassword;

      // 3. Sessions are revoked — log in with the temp password.
      const okTemp = await loginViaForm(page, email, tempPassword);
      expect(okTemp, "login with the new (temp) password must succeed after rotation").toBe(true);

      // 4. (Optional) Verify the original password no longer works.
      //    Log out by navigating to /logout — or by clearing cookies on
      //    the context. Simplest: open a new context page-less and try.
      //    To stay in one page, we'll navigate to /login (where the
      //    server will rewrap our cookie if still valid) and re-submit.
      //    Cleaner: drop cookies before re-login.
      await page.context().clearCookies();
      const okOldShouldFail = await loginViaForm(page, email, originalPassword);
      expect(okOldShouldFail, "login with the OLD password must FAIL after rotation").toBe(false);

      // 5. Restore session for the rotate-back: re-login with temp.
      await page.context().clearCookies();
      const okTempAgain = await loginViaForm(page, email, tempPassword);
      expect(okTempAgain, "re-login with the temp password must still succeed").toBe(true);

      // 6. Rotate back: temp → original.
      await submitChangePassword(page, tempPassword, originalPassword);
      passwordKnownToWork = originalPassword;

      // 7. Verify the original password works again.
      const okFinal = await loginViaForm(page, email, originalPassword);
      expect(okFinal, "login with the ORIGINAL password must succeed after the rotate-back").toBe(
        true
      );
    } finally {
      // Best-effort cleanup: if the body failed AFTER the first rotation
      // but BEFORE the rotate-back, the user is sitting on the temp
      // password. Attempt the rotate-back using whichever credential the
      // spec last successfully logged in with.
      if (rotatedToTemp && passwordKnownToWork !== originalPassword) {
        try {
          await page.context().clearCookies();
          const okRecovery = await loginViaForm(page, email, passwordKnownToWork);
          if (okRecovery) {
            await submitChangePassword(page, passwordKnownToWork, originalPassword);
          }
        } catch {
          // Swallow — the original test failure is what surfaces; the
          // operator must recover the account manually via the admin
          // password-reset path. A future slice could add a more robust
          // cleanup mechanism via a backend admin call.
        }
      }
    }
  });
});
