import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { login } from "./export-login";

/**
 * OSS-HARDEN (2026-10-01): what the binary serves logs no browser console
 * error on three expected-state walks — a signed-out visit to /, a sign-in
 * that must change an admin-set password (D-017) and continues to MFA
 * enrolment, and an MFA sign-in. Each logged "Failed to load resource: 401"
 * for an answer that was not a failure; the console now opts in with
 * X-Identuum-Login-Step-Status: 200.
 *
 * Fixture (ready phase): one account whose password was admin-set
 * (users.requires_password_change) and which has not enrolled MFA. Its
 * password arrives in the environment; the new one is made here, held in
 * memory and never printed. Two sign-ins in all.
 */

const PHASE = process.env.IDENTUUM_E2E_EXPORT_PHASE ?? "ready";
const EMAIL = process.env.IDENTUUM_E2E_EXPORT_PASSWORD_CHANGE_EMAIL ?? "";
const PASSWORD = process.env.IDENTUUM_E2E_EXPORT_PASSWORD_CHANGE_PASSWORD ?? "";
const NEW_PASSWORD = `Pc-${randomBytes(12).toString("hex")}-Aa7!`;

async function watched(ctx: BrowserContext): Promise<{ page: Page; errors: string[] }> {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, errors };
}

test.describe.configure({ mode: "serial" });

test.describe("expected states log no console error in the binary", () => {
  test.skip(PHASE !== "ready", "runs only against a bootstrapped appliance");

  test("a signed-out visit to / reaches /login with no console error", async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const { page, errors } = await watched(ctx);
      await page.goto("/");
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByLabel("Email or domain")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test.describe("the password-change and MFA sign-ins", () => {
    test.skip(!EMAIL || !PASSWORD, "the password-change fixture is not configured");

    test("a sign-in that must change its password logs no console error", async ({ browser }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext();
      try {
        const { page, errors } = await watched(ctx);
        await login(page, EMAIL, PASSWORD, NEW_PASSWORD);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    test("an MFA sign-in logs no console error", async ({ browser }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext();
      try {
        const { page, errors } = await watched(ctx);
        await login(page, EMAIL, NEW_PASSWORD);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  });
});
