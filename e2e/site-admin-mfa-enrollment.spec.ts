/**
 * E2E coverage for the /account/settings TOTP enrollment ceremony,
 * specifically driven as `site_admin` after the
 * `agent-a-20260620-idp-ce-site-admin-mfa-enrollment-wirefix` slice
 * mounted the `/api/v1/mfa/setup/{initiate,complete}` cookie-session
 * aliases on the CE IDP.
 *
 * Status before the wirefix:
 *   - UI surface existed on `/account/settings?tab=mfa`.
 *   - UI client posted to `/api/idp/api/v1/mfa/setup/initiate`.
 *   - CE backend mounted the route only at `/mfa/setup/initiate`.
 *   - → operator clicking "Enroll MFA" got a 404 from the IDP.
 *
 * What this spec asserts after the wirefix:
 *   - The MFA tab renders.
 *   - The enrollment form auto-mounts and reaches the `display`
 *     phase (the verification-code input is visible). This proves
 *     `accountMfaSetupInitiate()` succeeded — i.e. the wire path
 *     `/api/idp/api/v1/mfa/setup/initiate` → IDP
 *     `/api/v1/mfa/setup/initiate` is reachable.
 *   - The initiate-response observed on the wire returns a
 *     non-empty `secret` and an `otpauth://totp/...` URL.
 *   - Submitting a TOTP code computed from the observed secret
 *     causes the form to flip to the `success` phase
 *     ("Authenticator app enrolled" banner visible) and the
 *     recovery-codes section heading ("Save your recovery codes")
 *     becomes visible.
 *
 * Env gate (REQUIRED — defaults to skip):
 *   - `IDENTUUM_E2E_SITE_ADMIN_MFA_ENROLL=1` → run the ceremony.
 *
 * Why env-gated:
 *   The test mutates server state. After a successful run, the
 *   site_admin row carries `mfa_enabled=true`, so subsequent logins
 *   require a TOTP code. Re-running the test against the same row
 *   without first clearing MFA state hits the `already_enrolled`
 *   phase (HTTP 409 from the aliased route). Operators run this on
 *   a prepared stack with `mfa_enabled=false` for the site_admin.
 *   The customer-smoke M1 stack ships in that exact state, so the
 *   spec composes cleanly with the customer-smoke runbook.
 *
 * Secret-safety contract:
 *   - The raw TOTP secret captured from the initiate response is
 *     used ONLY to compute the verification code; it is never
 *     logged, written to disk, asserted by value, or echoed in any
 *     error message.
 *   - The computed TOTP code is filled into the form but never
 *     logged.
 *   - The recovery codes are NEVER read or asserted by value — the
 *     spec only asserts that the recovery-codes heading is visible.
 *   - Cookies / session IDs / JWTs / setup tokens / license envelope
 *     bytes are NEVER read.
 *   - Diagnostic on failure prints only the public URL + visible
 *     error/banner text — no secret value.
 */

import { expect, test } from "@playwright/test";
import { loginAsSiteAdminMFAOptional } from "./helpers/login";
import { generateTOTP } from "./helpers/totp";

const ENROLL_ENABLED = process.env.IDENTUUM_E2E_SITE_ADMIN_MFA_ENROLL === "1";

test.describe("/account/settings — site_admin MFA enrollment", () => {
  test.skip(
    !ENROLL_ENABLED,
    "IDENTUUM_E2E_SITE_ADMIN_MFA_ENROLL is not 1 — skipping the destructive site_admin TOTP enrollment ceremony. " +
      "This spec mutates server state (enables MFA on the site_admin row); operators run it standalone against " +
      "a prepared stack where the site_admin currently has mfa_enabled=false."
  );

  test("end-to-end ceremony — initiate, verify, success + recovery codes visible", async ({
    page,
  }) => {
    // Race-free response capture: install the waiter BEFORE the
    // form auto-mounts and triggers /api/idp/api/v1/mfa/setup/initiate.
    await loginAsSiteAdminMFAOptional(page);

    const initiatePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/idp/api/v1/mfa/setup/initiate") && resp.status() === 200,
      { timeout: 20_000 }
    );

    await page.goto("/account/settings?tab=mfa");

    // 1. Heading is the page-level account settings shell — proves
    //    the cookie session resolved + the role guard passed for
    //    site_admin on this route.
    await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible({
      timeout: 15_000,
    });

    // 2. The initiate response landed — the wirefix route is
    //    reachable. We capture the secret for in-test TOTP
    //    generation; the secret never leaves this closure.
    let secret: string;
    let otpauthUrl: string;
    try {
      const initiateResp = await initiatePromise;
      const body = await initiateResp.json();
      secret = body.secret;
      otpauthUrl = body.otpauth_url ?? body.qr_code_url ?? "";
    } catch (err) {
      const cause = String((err as Error).message ?? err);
      throw new Error(
        `[site-admin-mfa-enrollment] /api/idp/api/v1/mfa/setup/initiate did NOT return a 200 response. Verify the CE backend has the wirefix (cmd/identuum-idp/mfa_handlers.go must declare APIV1MFASetupInitiatePath and serve.go must call MountAPIV1MFASetupRoutes). Underlying cause: ${cause}`
      );
    }

    // 3. Structural assertions on the captured material — no value
    //    leakage.
    expect(secret.length, "initiate response.secret must be non-empty").toBeGreaterThan(0);
    expect(otpauthUrl, "initiate response.otpauth_url must be an otpauth:// URL").toMatch(
      /^otpauth:\/\/totp\//
    );

    // 4. The form must have reached `display` phase — the
    //    verification code input is the canonical observable signal.
    await expect(page.getByLabel("Verification code")).toBeVisible({ timeout: 15_000 });

    // 5. Compute a TOTP for the current window and submit.
    const code = generateTOTP(secret, 0);
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and enable MFA" }).click();

    // 6. Success phase observables — pin the post-completion UI.
    //    The banner text is the deterministic signal that the form's
    //    `phase === "success"` branch rendered (account-mfa-enroll-form.tsx
    //    line ~152). The recovery-codes heading proves the recovery-
    //    codes grid is structurally present without reading any code
    //    value.
    await expect(page.getByText("Authenticator app enrolled")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Save your recovery codes")).toBeVisible({
      timeout: 5_000,
    });

    // Defensive: the test never asserts an individual recovery code
    // value, never reads from `recoveryCodes.map()` output, and
    // never echoes the captured `secret` or `code` variables. Both
    // go out of scope at function exit.
  });
});
