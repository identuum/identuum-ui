/**
 * End-to-end M1 setup-wizard browser coverage for the CE customer-smoke
 * stack, added by `agent-a-20260620-idp-ui-ce-setup-wizard-playwright`
 * to close the CE-MATRIX M1 browser-UI gap noted in
 * `identuum-idp-ce/docs/CE_MANUAL_TEST_MATRIX.md`.
 *
 * What this spec asserts.
 *   1. Pre-flight: `GET ${IDP}/api/setup/status` returns
 *      `setup_complete=false` (otherwise the test skips with a clear
 *      "stack is already set up — reprovision before re-running"
 *      message).
 *   2. Pre-flight: `GET ${IDP}/api/setup/license` returns
 *      `state=license_valid` (otherwise the test skips because the
 *      wizard's license step would be required, and this M1-only spec
 *      intentionally does NOT upload a license envelope — that's M2).
 *   3. Navigates to `/setup`, fills the wizard:
 *        * setup_token (from `IDENTUUM_CE_SETUP_TOKEN` env)
 *        * admin_email (from `IDENTUUM_CE_SITE_ADMIN_EMAIL` env)
 *        * admin_password + admin_password_confirm (from
 *          `IDENTUUM_CE_SITE_ADMIN_PASSWORD` env)
 *        * `create_tenant_org` left UNCHECKED (site-admin-only
 *          bootstrap — keeps the spec minimal and matches the runbook's
 *          M1 default).
 *   4. Submits the wizard and asserts the observable post-conditions:
 *        * The browser navigates away from `/setup` (typically to
 *          `/login`).
 *        * `GET ${IDP}/api/setup/status` now returns
 *          `setup_complete=true`.
 *
 * Env gate (REQUIRED — defaults to skip):
 *   - `IDENTUUM_E2E_CE_SETUP_WIZARD=1` → run the destructive ceremony.
 *
 * Why env-gated and single-run.
 *   - The setup token is single-use — consuming it kills the wizard.
 *   - Flipping `setup_complete=true` makes `/setup` redirect to
 *     `/login` on every subsequent visit.
 *   - Operators run this on a freshly-provisioned stack ONCE per stack
 *     lifetime. After a successful run, future runs of this spec skip
 *     cleanly at the `setup_complete=false` pre-flight gate.
 *
 * Operator env vars (NEVER printed by this spec).
 *   - `IDENTUUM_E2E_CE_SETUP_WIZARD` — gate (default: skip).
 *   - `IDP_BASE_URL` — IDP backend URL (default `http://127.0.0.1:7123`).
 *   - `IDENTUUM_E2E_BASE_URL` — UI baseURL (default
 *     `http://127.0.0.1:7124`).
 *   - `IDENTUUM_CE_SETUP_TOKEN` — single-use setup token printed by
 *     `docker compose ... exec identuum-idp-ce /app/identuum --setup --plain`.
 *   - `IDENTUUM_CE_SITE_ADMIN_EMAIL` — operator's chosen site_admin
 *     email.
 *   - `IDENTUUM_CE_SITE_ADMIN_PASSWORD` — operator's chosen site_admin
 *     password (must satisfy the wizard's `minLength={MIN_PASSWORD_LENGTH}`
 *     constraint).
 *
 * Secret-safety contract.
 *   - The spec NEVER reads any of these values into a local string for
 *     logging, assertion, or echo. The token + email + password are
 *     fed directly to `page.locator(...).fill(value)`, where Playwright
 *     does NOT log the value.
 *   - On-failure diagnostic prints ONLY the public URL + visible page
 *     heading text — no env values, no cookies.
 *   - The license envelope is NOT touched by this spec (the pre-flight
 *     gates ensure the license is already valid before submit).
 *   - No license envelope bytes, recovery codes, JWTs, cookies, session
 *     IDs, or DB URLs are ever read.
 */

import { expect, test } from "@playwright/test";

const WIZARD_ENABLED = process.env.IDENTUUM_E2E_CE_SETUP_WIZARD === "1";
const IDP_BASE_URL = process.env.IDP_BASE_URL ?? "http://127.0.0.1:7123";

test.describe("/setup — CE setup wizard M1 end-to-end", () => {
  test.skip(
    !WIZARD_ENABLED,
    "IDENTUUM_E2E_CE_SETUP_WIZARD is not 1 — skipping the destructive CE setup-wizard ceremony. " +
      "This spec consumes the single-use setup token and flips setup_complete=true. " +
      "Operators run it once per freshly-provisioned customer-smoke stack."
  );

  test("verify token → fill site_admin → submit → setup_complete=true", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    const setupToken = process.env.IDENTUUM_CE_SETUP_TOKEN ?? "";
    const adminEmail = process.env.IDENTUUM_CE_SITE_ADMIN_EMAIL ?? "";
    const adminPassword = process.env.IDENTUUM_CE_SITE_ADMIN_PASSWORD ?? "";
    if (setupToken === "" || adminEmail === "" || adminPassword === "") {
      test.skip(
        true,
        "Operator env vars missing: IDENTUUM_CE_SETUP_TOKEN, IDENTUUM_CE_SITE_ADMIN_EMAIL, and IDENTUUM_CE_SITE_ADMIN_PASSWORD must all be set (values NEVER printed)."
      );
      return;
    }

    // Pre-flight 1: setup must not already be complete. If it is, the
    // /setup page redirects to /login at the server-side guard and this
    // spec has nothing to drive.
    const statusBefore = await request.get(`${IDP_BASE_URL}/api/setup/status`);
    expect(
      statusBefore.status(),
      `IDP at ${IDP_BASE_URL} did not respond to /api/setup/status — check the stack is up`
    ).toBe(200);
    const statusBody = (await statusBefore.json()) as { state?: string };
    if (statusBody.state === "setup_complete") {
      test.skip(
        true,
        `IDP at ${IDP_BASE_URL} reports setup_complete=true — reprovision the stack (e.g. make customer-smoke-clean && make customer-smoke-up) before re-running this spec.`
      );
      return;
    }

    // Pre-flight 2: the license must already be valid. This M1-only
    // spec does NOT upload a license envelope; the wizard's license
    // step is conditional on (distribution=="ce" && state!="license_valid").
    // If the operator wants to test M1 without M2, they can run against
    // an OSS backend; if they want a true CE M1+M2 test, that's a
    // separate slice.
    const licResp = await request.get(`${IDP_BASE_URL}/api/setup/license`);
    if (licResp.status() === 200) {
      const licBody = (await licResp.json()) as { state?: string; distribution?: string };
      if (licBody.distribution === "ce" && licBody.state !== "license_valid") {
        test.skip(
          true,
          `CE backend at ${IDP_BASE_URL} reports license state=${String(licBody.state)} — this M1-only spec does NOT upload a license envelope. Run M2 first (manual or via the wizard's license step in a future M1+M2 slice).`
        );
        return;
      }
    }

    // Drive the wizard.
    await page.goto("/setup");
    await expect(
      page.getByTestId("setup-wizard"),
      "wizard shell must render at /setup"
    ).toBeVisible({ timeout: 10_000 });

    // Step 1: setup token + verify.
    await page.getByTestId("setup-code-input").fill(setupToken);
    await page.getByTestId("setup-code-verify").click();
    await expect(
      page.getByTestId("setup-code-ok"),
      "setup-code-ok must appear after a valid setup_token (any code mismatch surfaces setup-code-error instead)"
    ).toBeVisible({ timeout: 10_000 });

    // Step 2: site_admin credentials. `create_tenant_org` left
    // UNCHECKED — site-admin-only bootstrap matches the runbook's M1
    // default; tenant orgs are created later via /site-admin/organizations.
    await page.getByTestId("setup-admin-email").fill(adminEmail);
    await page.getByTestId("setup-admin-password").fill(adminPassword);
    await page.locator('input[name="admin_password_confirm"]').fill(adminPassword);

    // Submit. The wizard's submit button label varies; match by role
    // + a broad text regex covering the documented copy ("Complete
    // setup", "Finish", "Submit").
    await page
      .getByRole("button", { name: /Complete setup|Finish setup|Complete|Finish|Submit/i })
      .first()
      .click();

    // Observable post-condition 1: the browser navigates away from /setup.
    // The wizard's success path either redirects to /login (the standard
    // post-setup target) or leaves the wizard rendering a success panel
    // briefly before the SSR guard kicks in. We tolerate both by waiting
    // for either /login OR for the backend's /api/setup/status to flip
    // — whichever resolves first.
    await Promise.race([
      page.waitForURL(/\/login(\?|$|\/)/, { timeout: 30_000 }).catch(() => null),
      page
        .waitForFunction(
          async (idpUrl: string) => {
            try {
              const res = await fetch(`${idpUrl}/api/setup/status`, {
                cache: "no-store",
                headers: { Accept: "application/json" },
              });
              if (!res.ok) return false;
              const body = (await res.json()) as { state?: string };
              return body.state === "setup_complete";
            } catch {
              return false;
            }
          },
          IDP_BASE_URL,
          { timeout: 30_000, polling: 1_000 }
        )
        .catch(() => null),
    ]);

    // Observable post-condition 2: the backend confirms setup_complete=true.
    // This is the load-bearing assertion — the wizard's UI redirect could
    // race with our wait but the IDP's state flip is the truth.
    const statusAfter = await request.get(`${IDP_BASE_URL}/api/setup/status`);
    expect(statusAfter.status()).toBe(200);
    const afterBody = (await statusAfter.json()) as { state?: string };
    expect(
      afterBody.state,
      `IDP at ${IDP_BASE_URL} must report setup_complete=true after the wizard submit (got state=${String(afterBody.state)})`
    ).toBe("setup_complete");

    // Observable post-condition 3: a fresh navigation to /setup now
    // bounces to /login (the SSR guard at src/app/setup/page.tsx:98 +
    // :113 enforces this).
    const setupResp = await page.goto("/setup");
    // Either the navigation lands on /login directly, or the response
    // status is 200 with the /login HTML — both are acceptable signals
    // that the wizard is no longer reachable.
    const finalUrl = page.url();
    expect(
      finalUrl.includes("/login") || setupResp?.status() === 200,
      `after setup_complete, /setup must not render the wizard (final URL was ${finalUrl})`
    ).toBe(true);
    await expect(page.getByTestId("setup-wizard")).toHaveCount(0, { timeout: 5_000 });
  });
});
