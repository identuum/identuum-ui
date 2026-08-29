/**
 * THE-NINE-DARK-PAGES (2026-08-29) — the three /site-admin/org-link pages,
 * previously NOT-VISITED by any spec (UI census).
 *
 * This suite runs against the IdP-only runtime (ag.enabled=false — the same
 * posture platform-status.spec.ts pins as "Identity Only"), so the honest
 * assertable content is each page's explicit AG-disabled boundary state — the
 * same class as the audit-chain edition-boundary pin. No AG upstream is
 * faked; when a real AG backend is configured these assertions would need the
 * enabled-state siblings, which is that future runtime's slice.
 *
 * All three pages sit behind the site-admin shell, so the suite logs in as
 * site_admin (shared context) and gates on the same centralized credential
 * predicate the rest of the suite uses; in the provisioned e2e-full harness
 * the envelope supplies the credentials, so nothing here self-skips there.
 */
import { type BrowserContext, expect, test } from "@playwright/test";
import { loginAsSiteAdmin, SKIP_AUTH_MSG, skipAuthTests } from "./helpers/login";

test.describe.configure({ mode: "serial" });

test.describe("/site-admin/org-link pages — AG-disabled boundary states", () => {
  let ctx: BrowserContext | undefined;

  test.beforeAll(async ({ browser }) => {
    if (skipAuthTests) return;
    test.setTimeout(90_000);
    ctx = await browser.newContext();
    const p = await ctx.newPage();
    await loginAsSiteAdmin(p);
    await p.close();
  });

  test.afterAll(async () => {
    await ctx?.close();
  });

  test("org-link landing renders the not-configured notice for the absent AG backend", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }
    const page = await (ctx as BrowserContext).newPage();
    try {
      await page.goto("/site-admin/org-link");
      await expect(page.getByText("Agent Governance not configured")).toBeVisible();
      await expect(
        page.getByText(/identuum-ag is not enabled in the current runtime configuration/)
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("ag-plan renders its heading and the AG-not-configured plan card", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }
    const page = await (ctx as BrowserContext).newPage();
    try {
      await page.goto("/site-admin/org-link/ag-plan");
      await expect(page.getByRole("heading", { name: "AG Org-Link Plan" })).toBeVisible();
      await expect(page.getByText("AG not configured")).toBeVisible();
      await expect(page.getByText(/ag\.enabled=false/)).toBeVisible();
      // The page's own navigation affordances render too.
      await expect(page.getByRole("link", { name: "Back to Organization Link" })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("readiness renders the not-configured notice under its own title", async () => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }
    const page = await (ctx as BrowserContext).newPage();
    try {
      await page.goto("/site-admin/org-link/readiness");
      await expect(page.getByText("Agent Governance not configured")).toBeVisible();
      await expect(
        page.getByText(/identuum-ag is not enabled in the current runtime configuration/)
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });
});
