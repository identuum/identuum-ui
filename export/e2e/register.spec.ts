import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { enrolledHere, login, onBaseURL, orgAdminAccount, siteAdminAccount } from "./export-login";

/**
 * OSS-REGISTER-UI item 8 (D-021): self-registration through the console the
 * binary serves. The site administrator turns the installation's switch on;
 * the organization administrator opens sign-up (no approval, no email
 * verification) and copies the link; a fresh browser registers, signs in and
 * enrols MFA. With approval on, a second registrant is refused at sign-in
 * until the organization administrator approves it on the users page. Closed
 * again, the link reads "Sign-up is not available", as an unknown
 * organization's does. No other console error anywhere.
 *
 * Fixture: the e2e-full run's site and organization administrators
 * (IDENTUUM_E2E_EXPORT_FIXTURE=1). Registrants are made here; their
 * passwords, the link and the authenticator secrets stay in memory. The
 * switch and the organization's policy are restored at the end. One console
 * error is expected and pinned: the pending registrant's refused sign-in.
 */

const PHASE = process.env.IDENTUUM_E2E_EXPORT_PHASE ?? "ready";
const run = randomBytes(3).toString("hex");
const password = () => `Rg-${randomBytes(12).toString("hex")}-Aa7!`;
const BFF = { "X-Requested-With": "identuum-ui", "Content-Type": "application/json" };

// Every answer of 400 or more, by method, status and PATH only (a query can
// carry a token), so a console error names the request behind it.
const failed: string[] = [];

async function watched(ctx: BrowserContext, errors: string[], who: string): Promise<Page> {
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${who}: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) {
      failed.push(`${who}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    }
  });
  return page;
}

/** Sets the organization's sign-up switches on its settings page and saves. */
async function savePolicy(page: Page, allow: boolean, approval: boolean): Promise<void> {
  await page.goto("/org-admin/settings");
  const s = page.getByTestId("org-self-registration");
  await s.getByLabel("Allow sign-up").setChecked(allow);
  await s.getByLabel(/Hold new accounts/).setChecked(approval);
  await s.getByLabel(/Require a verified email/).setChecked(false);
  await s.getByRole("button", { name: "Save" }).click();
  await expect(s.getByText("Saved.")).toBeVisible();
}

async function register(page: Page, link: string, email: string, pw: string): Promise<void> {
  await page.goto(link);
  // Where the policy asks for complexity, a password without it is refused
  // on the form before it is sent: no request, so no 400 in the console.
  const hint = (await page.locator("#register-password-hint").textContent()) ?? "";
  if (hint.includes("upper- and lower-case")) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Name").fill(`Registrant ${run}`);
    await page.getByLabel("Password").fill("abcdefghijklmnop1234");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByTestId("register-form").getByRole("alert")).toContainText(
      "an upper- and a lower-case letter"
    );
  }
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(`Registrant ${run}`);
  await page.getByLabel("Password").fill(pw);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("register-accepted")).toBeVisible();
}

test.describe("self-registration in the binary", () => {
  test.skip(PHASE !== "ready", "runs only against a bootstrapped appliance");
  test.skip(!orgAdminAccount(), "the e2e-full fixture is not configured");

  test("open → register → sign in → MFA; approval → refused → approved → sign in; closed", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const sa = siteAdminAccount();
    const oa = orgAdminAccount() as { email: string; password: string };
    const siteCtx = await browser.newContext();
    const orgCtx = await browser.newContext();
    const site = await watched(siteCtx, errors, "site_admin");
    const org = await watched(orgCtx, errors, "org_admin");
    let instanceWas: boolean | null = null;
    let policyWas: unknown = null;
    let orgId = "";
    try {
      await login(site, sa.email, sa.password);
      const instance = await site.request.get("/bff/api/v1/settings/self-registration", {
        headers: BFF,
      });
      expect(instance.status()).toBe(200);
      instanceWas = ((await instance.json()) as { enabled: boolean }).enabled;
      await site.goto("/site-admin/settings");
      const sw = site.getByTestId("instance-self-registration");
      if (!instanceWas) await sw.getByRole("button", { name: "Turn on" }).click();
      await expect(sw.getByText("On", { exact: true })).toBeVisible();

      await login(org, oa.email, oa.password);
      const current = await org.request.get("/bff/api/v1/organizations/current", { headers: BFF });
      const own = (await current.json()) as { id: string; domain: string };
      orgId = own.id;
      // Registrants sign up at the organization's own domain, so the sign-in
      // page's domain lookup finds it (a lookup miss is a logged 404).
      const at = own.domain;
      expect(at.length, "the fixture organization has a domain").toBeGreaterThan(0);
      const before = await org.request.get(`/bff/api/v1/organizations/${orgId}/registration`, {
        headers: BFF,
      });
      expect(before.status()).toBe(200);
      policyWas = await before.json();

      // Open, no approval, no verification: the account is ready at once.
      await savePolicy(org, true, false);
      const panel = org.getByTestId("org-self-registration").locator("input[readonly]");
      const link = onBaseURL(await panel.inputValue(), baseURL ?? "");
      const first = `self-${run}@${at}`;
      const firstPw = password();
      const r1 = await browser.newContext();
      try {
        const p = await watched(r1, errors, "registrant 1");
        await register(p, link, first, firstPw);
        await expect(p.getByText("the account is ready")).toBeVisible();
        await login(p, first, firstPw);
        expect(enrolledHere(first), "the registrant enrolled MFA at its first sign-in").toBe(true);
      } finally {
        await r1.close();
      }

      // Approval on: refused at sign-in until approved.
      await savePolicy(org, true, true);
      const second = `held-${run}@${at}`;
      const secondPw = password();
      const r2 = await browser.newContext();
      try {
        const p = await watched(r2, errors, "registrant 2");
        await register(p, link, second, secondPw);
        await expect(p.getByText("an administrator reviews the request")).toBeVisible();
        await expect(login(p, second, secondPw)).rejects.toThrow("login refused");

        await org.goto("/org-admin/users");
        const row = org.getByTestId("pending-registration").filter({ hasText: second });
        await row.getByRole("button", { name: "Approve" }).click();
        // The approval revalidates the page: the sign-up leaves the list.
        await expect(row).toHaveCount(0);

        await login(p, second, secondPw);
        expect(enrolledHere(second)).toBe(true);
      } finally {
        await r2.close();
      }

      // Closed: the link and an unknown organization read the same.
      await savePolicy(org, false, false);
      const r3 = await browser.newContext();
      try {
        const p = await watched(r3, errors, "visitor");
        await p.goto(link);
        await expect(p.getByText("Sign-up is not available")).toBeVisible();
        await expect(p.getByTestId("register-form")).toHaveCount(0);
        await p.goto(`/register/no-such-org-${run}`);
        await expect(p.getByText("Sign-up is not available")).toBeVisible();
      } finally {
        await r3.close();
      }

      // Exactly one console error, and it is the one the flow requires: the
      // pending registrant's refused sign-in (403 registration_pending, an
      // answer the browser logs; owner ruling, OSS-REGISTER-UI). Any other
      // console error or answer of 400 or more fails.
      expect(errors, `answers of 400 or more: ${failed.join("; ")}`).toEqual([
        "registrant 2: Failed to load resource: the server responded with a status of 403 (Forbidden)",
      ]);
      expect(failed).toEqual(["registrant 2: 403 POST /bff/api/v1/auth/login"]);
    } finally {
      if (orgId && policyWas) {
        await org.request.put(`/bff/api/v1/organizations/${orgId}/registration`, {
          headers: BFF,
          data: policyWas,
        });
      }
      if (instanceWas !== null) {
        await site.request.put("/bff/api/v1/settings/self-registration", {
          headers: BFF,
          data: { enabled: instanceWas },
        });
      }
      await siteCtx.close();
      await orgCtx.close();
    }
  });
});
