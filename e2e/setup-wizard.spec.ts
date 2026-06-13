/**
 * Opt-in Playwright spec for the appliance first-run setup wizard.
 *
 * This spec drives the full happy path against a freshly-migrated
 * `identuum-idp-oss` database + a running UI:
 *
 *   1. GET /api/setup/status → {state:"setup_required"}
 *   2. Visit `/` and confirm the redirect lands on `/setup` (not /login).
 *   3. Read the setup code from the IDP container's data-volume file
 *      via the `identuum-idp --show-setup-code <data-dir>` CLI (the
 *      spec receives the path via env var; it never reads the host
 *      filesystem directly).
 *   4. Submit the wizard with a synthesized organization + admin.
 *   5. After completion, GET /api/setup/status → {state:"setup_complete"}.
 *
 * Prerequisites — the spec SKIPS cleanly if any of these env vars are
 * unset, because the wizard mutates DB state and there is no automatic
 * way to rewind a real Postgres without operator intent:
 *
 *   IDENTUUM_E2E_SETUP_WIZARD=1
 *      Explicit opt-in. Off by default.
 *   IDENTUUM_IDP_BASE_URL  (defaults to http://localhost:7113)
 *      IDP base — used for the pre/post status probes.
 *   IDENTUUM_E2E_SETUP_TOKEN
 *      The setup code from the IDP boot banner or
 *      `identuum-idp --show-setup-code <data-dir>`. The spec does not
 *      read the file directly to keep the test environment-agnostic.
 *
 * Owner authorisation: this spec is intended for the developer-driven
 * local-smoke loop the wiki references. CI should leave the env var
 * unset so the spec auto-skips.
 */

import { expect, test } from "@playwright/test";

const IDP_BASE_URL = process.env.IDENTUUM_IDP_BASE_URL ?? "http://localhost:7113";
const SETUP_TOKEN = process.env.IDENTUUM_E2E_SETUP_TOKEN ?? "";
const ENABLE = process.env.IDENTUUM_E2E_SETUP_WIZARD === "1";

const ORG_NAME = `E2E Setup Org ${Date.now()}`;
const ORG_DOMAIN = `e2e-${Date.now()}.example`;
const ADMIN_EMAIL = `setup-e2e+${Date.now()}@example.com`;
// 24-character password well above the 12-character minimum. The
// suite does not log it; it stays in this file only.
const ADMIN_PASSWORD = "setup-e2e-password-12345";

test.describe("appliance setup wizard (opt-in, mutates DB)", () => {
  test.skip(!ENABLE, "set IDENTUUM_E2E_SETUP_WIZARD=1 to enable");
  test.skip(!SETUP_TOKEN, "set IDENTUUM_E2E_SETUP_TOKEN to run");

  test("completes first-run setup end-to-end", async ({ page, request }) => {
    // Step 1 — IDP reports setup_required.
    const before = await request.get(`${IDP_BASE_URL}/api/setup/status`);
    expect(before.status()).toBe(200);
    const beforeBody = (await before.json()) as { state?: string };
    expect(beforeBody.state).toBe("setup_required");

    // Step 2 — root redirect lands on /setup, not /login.
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByText("First-run setup")).toBeVisible();

    // Step 3 — verify the setup code.
    await page.getByTestId("setup-code-input").fill(SETUP_TOKEN);
    await page.getByTestId("setup-code-verify").click();
    await expect(page.getByTestId("setup-code-ok")).toBeVisible();

    // Step 4 — submit the wizard.
    await page.getByTestId("setup-org-name").fill(ORG_NAME);
    await page.getByTestId("setup-org-domain").fill(ORG_DOMAIN);
    await page.getByTestId("setup-admin-email").fill(ADMIN_EMAIL);
    await page.getByTestId("setup-admin-password").fill(ADMIN_PASSWORD);
    await page.getByTestId("setup-admin-password-confirm").fill(ADMIN_PASSWORD);
    await page.getByTestId("setup-submit").click();

    // Wait for the redirect to /login (the wizard sets a 600ms delay).
    await expect(page).toHaveURL(/\/login$/, { timeout: 5_000 });

    // Step 5 — IDP now reports setup_complete.
    const after = await request.get(`${IDP_BASE_URL}/api/setup/status`);
    expect(after.status()).toBe(200);
    const afterBody = (await after.json()) as { state?: string };
    expect(afterBody.state).toBe("setup_complete");

    // The setup APIs that mutate state must now refuse with 410 Gone.
    const replay = await request.post(`${IDP_BASE_URL}/api/setup/verify-token`, {
      data: { setup_token: SETUP_TOKEN },
    });
    expect(replay.status()).toBe(410);
  });
});
