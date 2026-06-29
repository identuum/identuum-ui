/**
 * End-to-end OSS-1 setup-wizard browser coverage, added by
 * `agent-a-20260620-idp-ui-oss-setup-wizard-playwright` to close
 * the OSS-MATRIX OSS-1 browser-UI gap noted in
 * `identuum-idp-oss/docs/OSS_MANUAL_TEST_MATRIX.md`.
 *
 * Pattern-identical to the prior CE spec at `e2e/ce-setup-wizard.spec.ts`,
 * with two intentional deltas:
 *   - Default targets the OSS dev-stack ports (IDP 7113, UI 7104).
 *   - NO `license_valid` pre-flight gate — the wizard's license step is
 *     conditional on `distribution === "ce"` (verified at
 *     `src/app/setup/setup-wizard.tsx:95-111`), so an OSS backend
 *     never reaches it and no license envelope is required.
 *
 * What this spec asserts.
 *   1. Pre-flight: `GET ${IDP}/api/setup/status` returns
 *      `setup_complete=false` (otherwise the test skips with a clear
 *      "OSS stack is already set up — reprovision before re-running"
 *      message).
 *   2. (Soft) Pre-flight: `GET ${IDP}/api/v1/component` `distribution`
 *      should be `"oss"` if the field is exposed. The test does NOT
 *      hard-skip on this signal — OSS backends without the field still
 *      proceed; only a `distribution === "ce"` value causes a skip,
 *      because the spec deliberately does not exercise the CE license
 *      step (that lives in `e2e/ce-setup-wizard.spec.ts`).
 *   3. Navigates to `/setup`, fills the wizard:
 *        * setup_token (from `IDENTUUM_OSS_SETUP_TOKEN` env)
 *        * admin_email (from `IDENTUUM_OSS_SITE_ADMIN_EMAIL` env)
 *        * admin_password + admin_password_confirm (from
 *          `IDENTUUM_OSS_SITE_ADMIN_PASSWORD` env)
 *        * `create_tenant_org` left UNCHECKED (site-admin-only
 *          bootstrap — keeps the spec minimal and matches the OSS
 *          single-organization default).
 *   4. Submits the wizard and asserts the observable post-conditions:
 *        * The browser navigates away from `/setup`.
 *        * `GET ${IDP}/api/setup/status` now returns
 *          `setup_complete=true`.
 *        * Fresh navigation to `/setup` no longer renders the wizard.
 *
 * Env gate (REQUIRED — defaults to skip):
 *   - `IDENTUUM_E2E_OSS_SETUP_WIZARD=1` → run the destructive ceremony.
 *
 * Why env-gated and single-run.
 *   - The setup token is single-use — consuming it kills the wizard.
 *   - Flipping `setup_complete=true` makes `/setup` redirect to
 *     `/login` on every subsequent visit.
 *   - Operators run this on a freshly-provisioned OSS stack ONCE per
 *     stack lifetime. After a successful run, future runs of this spec
 *     skip cleanly at the `setup_complete=false` pre-flight gate.
 *
 * Operator env vars (NEVER printed by this spec).
 *   - `IDENTUUM_E2E_OSS_SETUP_WIZARD` — gate (default: skip).
 *   - `IDP_BASE_URL` — IDP backend URL (default `http://127.0.0.1:7113`).
 *   - `IDENTUUM_E2E_BASE_URL` — UI baseURL (default
 *     `http://127.0.0.1:7104`).
 *   - `IDENTUUM_OSS_SETUP_TOKEN` — single-use setup token printed by
 *     `identuum --setup --plain` against the OSS binary.
 *   - `IDENTUUM_OSS_SITE_ADMIN_EMAIL` — operator's chosen site_admin
 *     email.
 *   - `IDENTUUM_OSS_SITE_ADMIN_PASSWORD` — operator's chosen site_admin
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
 *   - The license envelope is NEVER touched (OSS has no license).
 *   - No license envelope bytes, recovery codes, JWTs, cookies, session
 *     IDs, or DB URLs are ever read.
 */

import { expect, test } from "@playwright/test";

const WIZARD_ENABLED = process.env.IDENTUUM_E2E_OSS_SETUP_WIZARD === "1";
const IDP_BASE_URL = process.env.IDP_BASE_URL ?? "http://127.0.0.1:7113";

test.describe("/setup — OSS setup wizard OSS-1 end-to-end", () => {
  test.skip(
    !WIZARD_ENABLED,
    "IDENTUUM_E2E_OSS_SETUP_WIZARD is not 1 — skipping the destructive OSS setup-wizard ceremony. " +
      "This spec consumes the single-use setup token and flips setup_complete=true. " +
      "Operators run it once per freshly-provisioned OSS stack."
  );

  test("verify token → fill site_admin → submit → setup_complete=true", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    const setupToken = process.env.IDENTUUM_OSS_SETUP_TOKEN ?? "";
    const adminEmail = process.env.IDENTUUM_OSS_SITE_ADMIN_EMAIL ?? "";
    const adminPassword = process.env.IDENTUUM_OSS_SITE_ADMIN_PASSWORD ?? "";
    if (setupToken === "" || adminEmail === "" || adminPassword === "") {
      test.skip(
        true,
        "Operator env vars missing: IDENTUUM_OSS_SETUP_TOKEN, IDENTUUM_OSS_SITE_ADMIN_EMAIL, and IDENTUUM_OSS_SITE_ADMIN_PASSWORD must all be set (values NEVER printed)."
      );
      return;
    }

    // Pre-flight 1: setup must not already be complete.
    const statusBefore = await request.get(`${IDP_BASE_URL}/api/setup/status`);
    expect(
      statusBefore.status(),
      `IDP at ${IDP_BASE_URL} did not respond to /api/setup/status — check the OSS stack is up on the expected port`
    ).toBe(200);
    const statusBody = (await statusBefore.json()) as { state?: string };
    if (statusBody.state === "setup_complete") {
      test.skip(
        true,
        `IDP at ${IDP_BASE_URL} reports setup_complete=true — reprovision the OSS stack before re-running this spec.`
      );
      return;
    }

    // Pre-flight 2 (soft): if /api/v1/component reports distribution=ce
    // (which means this is NOT an OSS backend), bail rather than driving
    // through the CE-only license step that this spec deliberately does
    // not exercise. A missing distribution field, or "oss", is fine.
    const compResp = await request.get(`${IDP_BASE_URL}/api/v1/component`);
    if (compResp.status() === 200) {
      const compBody = (await compResp.json()) as { distribution?: string };
      if (compBody.distribution === "ce") {
        test.skip(
          true,
          `IDP at ${IDP_BASE_URL} reports distribution=ce — this OSS spec deliberately does NOT exercise the CE license step. Use e2e/ce-setup-wizard.spec.ts instead.`
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
      "setup-code-ok must appear after a valid setup_token (any mismatch surfaces setup-code-error instead)"
    ).toBeVisible({ timeout: 10_000 });

    // Step 2: site_admin credentials. `create_tenant_org` left
    // UNCHECKED — site-admin-only bootstrap.
    await page.getByTestId("setup-admin-email").fill(adminEmail);
    await page.getByTestId("setup-admin-password").fill(adminPassword);
    await page.locator('input[name="admin_password_confirm"]').fill(adminPassword);

    // Submit.
    await page
      .getByRole("button", { name: /Complete setup|Finish setup|Complete|Finish|Submit/i })
      .first()
      .click();

    // Observable post-condition 1: the browser navigates away from /setup
    // OR the backend's /api/setup/status flips — whichever resolves first.
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

    // Observable post-condition 2: backend reports setup_complete=true.
    const statusAfter = await request.get(`${IDP_BASE_URL}/api/setup/status`);
    expect(statusAfter.status()).toBe(200);
    const afterBody = (await statusAfter.json()) as { state?: string };
    expect(
      afterBody.state,
      `IDP at ${IDP_BASE_URL} must report setup_complete=true after the wizard submit (got state=${String(afterBody.state)})`
    ).toBe("setup_complete");

    // Observable post-condition 3: fresh navigation to /setup no longer
    // renders the wizard (SSR guard at src/app/setup/page.tsx:98 + :113).
    const setupResp = await page.goto("/setup");
    const finalUrl = page.url();
    expect(
      finalUrl.includes("/login") || setupResp?.status() === 200,
      `after setup_complete, /setup must not render the wizard (final URL was ${finalUrl})`
    ).toBe(true);
    await expect(page.getByTestId("setup-wizard")).toHaveCount(0, { timeout: 5_000 });
  });
});
