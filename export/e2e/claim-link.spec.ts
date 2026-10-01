import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { unconsumedTOTP } from "../../e2e/helpers/totp";
import { login } from "./export-login";

/**
 * OSS-CLAIM-UI (D-022): in the binary, a site_admin issues a claim link for
 * an organization with no administrator from its page; a second issue warns
 * first and retires the first link; a fresh browser opens the new link on the
 * binary's /claim, sets a password, enrols MFA and lands in the org-admin
 * console as the organization's administrator. No console error anywhere.
 *
 * Fixture (ready phase): the site administrator, whose password arrives in
 * the environment. The organization and the claimant are made here; links,
 * passwords and the authenticator secret stay in memory and are not printed.
 * Two sign-ins in all.
 */

const PHASE = process.env.IDENTUUM_E2E_EXPORT_PHASE ?? "ready";
const SA_EMAIL = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_EMAIL ?? "site_admin@system.local";
const SA_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_PASSWORD ?? "";
const run = randomBytes(3).toString("hex");
const OWNER = `owner-${run}@claim-${run}.example`;
const OWNER_PASSWORD = `Cl-${randomBytes(12).toString("hex")}-Aa7!`;

async function watched(ctx: BrowserContext): Promise<{ page: Page; errors: string[] }> {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, errors };
}

// Issues from the open form and returns the link the panel then shows: a
// re-issue waits for the panel to show a different link than `previous`.
// Links are compared as booleans so a failure never prints one.
async function issueFromPage(page: Page, previous = ""): Promise<string> {
  await page.getByRole("button", { name: "Issue link" }).click();
  const input = page.getByTestId("claim-issued").locator("input").first();
  await expect
    .poll(async () => {
      const v = await input.inputValue().catch(() => "");
      return v !== "" && v !== previous;
    })
    .toBe(true);
  return input.inputValue();
}

test.describe("claim link in the binary", () => {
  test.skip(PHASE !== "ready", "runs only against a bootstrapped appliance");
  test.skip(!SA_PASSWORD, "the site administrator fixture is not configured");

  test("issue, re-issue retires, claim in a fresh browser, sign in as org_admin", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const admin = await browser.newContext();
    const fresh = await browser.newContext();
    try {
      const a = await watched(admin);
      await login(a.page, SA_EMAIL, SA_PASSWORD);
      const created = await a.page.request.post("/bff/api/v1/organizations", {
        headers: { "X-Requested-With": "identuum-ui", "Content-Type": "application/json" },
        data: { name: `Claim ${run}`, domain: `claim-${run}.example` },
      });
      expect(created.status()).toBe(201);
      const org = (await created.json()) as { id: string };

      await a.page.goto(`/site-admin/organizations/${org.id}`);
      await a.page.getByRole("button", { name: "Issue claim link" }).click();
      const first = await issueFromPage(a.page);
      await a.page.getByRole("button", { name: "Issue a new claim link" }).click();
      await expect(a.page.getByText("The link issued before stops working.")).toBeVisible();
      const second = await issueFromPage(a.page, first);

      const c = await watched(fresh);
      await c.page.goto(first);
      await expect(c.page.getByText("Link invalid or expired")).toBeVisible();
      await c.page.goto(second);
      await c.page.locator("#claim-email").first().fill(OWNER);
      await c.page.locator("#claim-name").fill("Claim Owner");
      await c.page.locator("#claim-password").fill(OWNER_PASSWORD);
      await c.page.locator("#claim-confirm").fill(OWNER_PASSWORD);
      await c.page.getByRole("button", { name: "Set up account" }).click();
      const secretEl = c.page.locator('p:has-text("Secret key") + code');
      await secretEl.waitFor();
      const code = await unconsumedTOTP(((await secretEl.textContent()) ?? "").trim(), OWNER);
      await c.page.getByLabel("Verification code").fill(code);
      await c.page.getByRole("button", { name: /Verify/ }).click();
      const ack = c.page.getByRole("button", { name: /saved my recovery codes/i });
      const cont = c.page.getByRole("button", { name: /Continue to org admin/ });
      await ack.or(cont).first().waitFor();
      if (await ack.isVisible()) await ack.click();
      await cont.click();
      await expect(c.page).toHaveURL(/\/org-admin/);
      await expect(c.page.getByTestId("home")).toBeVisible();

      expect(a.errors).toEqual([]);
      expect(c.errors).toEqual([]);
    } finally {
      await admin.close();
      await fresh.close();
    }
  });
});
