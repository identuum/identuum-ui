/**
 * THE-FRESH-APPLIANCE-PHASE (2026-08-29) — the two routes only a
 * setup_required appliance can light: / (the root router's setup redirect)
 * and /setup (the first-run wizard shell).
 *
 * Runs ONLY inside the e2e-full harness's fresh-appliance phase
 * (IDENTUUM_E2E_FRESH_PHASE=1, set by full-run.sh between dev-smoke and the
 * CLI bootstrap — the one window where the SHARED harness appliance is still
 * setup_required). A plain `pnpm e2e` and the harness's own later phases
 * self-skip: by then the appliance is configured and / redirects to /login.
 *
 * Assert-only by design: setup COMPLETION stays with the harness's single
 * `identuum-idp bootstrap` (UI-PROVISIONER-1 pins exactly one bootstrap
 * path), which runs immediately after this phase — the stack is never left
 * half-built, and no second setup path exists.
 */
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.describe("fresh appliance: / and /setup (setup_required window)", () => {
  test.skip(
    process.env.IDENTUUM_E2E_FRESH_PHASE !== "1",
    "runs only in the e2e-full harness's fresh-appliance phase (setup_required window)"
  );

  test("/ routes a fresh appliance to first-run setup", async ({ page }) => {
    await page.goto("/");
    // STATE TRANSITION: the root router detects setup_required and lands on
    // the wizard — the redirect is the route's designed content.
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { name: "First-run setup", level: 1 })).toBeVisible();
  });

  test("/setup renders the first-run wizard shell", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByTestId("setup-wizard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "First-run setup", level: 1 })).toBeVisible();
    // The OSS wizard's submit affordance renders (never clicked here —
    // completion belongs to the harness's single bootstrap path).
    await expect(page.getByTestId("setup-submit")).toBeVisible();
  });
});
