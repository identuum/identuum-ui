/**
 * F5 (owner ruling 2026-10-01): an MFA sign-in on /login logs no browser
 * console error. Before the opt-in, the IdP answered the password step's MFA
 * next step with 401 and the browser logged "Failed to load resource: 401".
 * The UI now sends `X-Identuum-Login-Step-Status: 200` and the IdP answers
 * that step with 200 and the same body.
 *
 * A fresh sign-in (no saved session) through the real password and TOTP
 * steps. Requires the dev-loop stack with a site_admin
 * (IDENTUUM_TEST_SITE_ADMIN_*).
 */

import { expect, test } from "@playwright/test";
import { loginAsSiteAdmin, SKIP_AUTH_MSG, skipAuthTests } from "./helpers/login";

test("an MFA sign-in on /login logs no console error", async ({ browser }) => {
  test.setTimeout(120_000);
  if (skipAuthTests) test.skip(true, SKIP_AUTH_MSG);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await loginAsSiteAdmin(page, { fresh: true });
    await expect(page).toHaveURL(/\/site-admin/);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
