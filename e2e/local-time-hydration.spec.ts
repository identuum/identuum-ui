/**
 * UI-DATES (owner decision U-020): the nightly e2e-full failure, reproduced on
 * demand. e2e-full's browser-console gate went red between 23:00 and 00:05
 * UTC because the Next server rendered /site-admin/organizations' created_at
 * in ITS time zone and the browser hydrated it in the viewer's: across the
 * two midnights they disagreed on the calendar day ("[diff: + Sep 24, 2026
 * - Sep 25, 2026]").
 *
 * Here the zones are 26 hours apart, so they disagree on every instant, not
 * only at night: the dev server runs in Pacific/Kiritimati (UTC+14,
 * playwright.config.ts webServer env) and this browser in Etc/GMT+12
 * (UTC-12), with its clock fixed inside the 23:00–00:05 UTC window. The page
 * must hydrate with no hydration or React console error, and each date must
 * show the viewer's zone with the exact UTC ISO time as its title.
 *
 * Requires the dev-loop stack with a site_admin (IDENTUUM_TEST_SITE_ADMIN_*).
 */

import { expect, test } from "@playwright/test";
import { loginAsSiteAdmin, SKIP_AUTH_MSG, skipAuthTests } from "./helpers/login";

const BROWSER_TZ = "Etc/GMT+12";
const NIGHT = new Date("2026-09-24T23:30:00Z");
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("organizations hydrate without errors when the server and browser zones disagree at night", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  if (skipAuthTests) test.skip(true, SKIP_AUTH_MSG);
  const ctx = await browser.newContext({ timezoneId: BROWSER_TZ, locale: "en-US" });
  try {
    const page = await ctx.newPage();
    await loginAsSiteAdmin(page);
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(NIGHT);
    for (const [path, heading] of [
      ["/site-admin/organizations", "Organizations"],
      ["/site-admin/audit", "Audit log"],
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();

      const first = page.locator("td time[datetime]").first();
      await expect(first).toHaveAttribute("title", UTC_ISO);
      await expect(first).toHaveText(/GMT-12$/);
      // The rendered strings, for the record (dates only).
      const shown = await first.textContent();
      const title = await first.getAttribute("title");
      test
        .info()
        .annotations.push({ type: "rendered", description: `${path}: ${shown} | title ${title}` });
    }

    expect(errors.filter((t) => /hydrat|did not match|server rendered|React/i.test(t))).toEqual([]);
  } finally {
    await ctx.close();
  }
});
