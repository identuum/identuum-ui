import { expect, type Page } from "@playwright/test";
import { unconsumedTOTP } from "../../e2e/helpers/totp";
import { proofRequest } from "./proof-privacy";

// A fresh fixture enrolls once in this worker. Neither its secret nor its
// codes leave this process, and nothing here writes them anywhere.
const enrolledSecrets = new Map<string, string>();

function rememberSecret(email: string, secret: string): void {
  enrolledSecrets.set(email, secret);
}

function recallSecret(email: string): string {
  return enrolledSecrets.get(email) ?? "";
}

/**
 * Signs in through the SHARED login page (src/components/auth/login-flow.tsx,
 * served by the export since PLAN-D-4) with whatever second factor the
 * appliance demands: enrolment on the first login (the secret is read from
 * the page once, the recovery codes are acknowledged and never read), or a
 * code for an account enrolled earlier in this process.
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  if (!password) throw new Error("the requested disposable login fixture is not configured");
  await page.goto("/login");
  await page.getByLabel("Email or domain").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await proofRequest(() => page.getByLabel("Password").fill(password));
  await page.getByRole("button", { name: "Sign in" }).click();
  const secretEl = page
    .locator("p", { hasText: "Secret key" })
    .locator("xpath=following-sibling::code");
  const code = page.getByLabel("Verification code");
  const outcome = page
    .getByTestId("home")
    .or(secretEl)
    .or(code)
    .or(page.getByTestId("login-error"))
    .first();
  await outcome.waitFor();
  if (await page.getByTestId("login-error").isVisible()) {
    // Fail fast without copying a potentially sensitive server response into
    // the test error.
    throw new Error("login refused by the disposable fixture");
  }
  if (await secretEl.isVisible()) {
    const secret = ((await secretEl.textContent()) ?? "").trim();
    expect(secret.length).toBeGreaterThan(0);
    rememberSecret(email, secret);
    const totp = await proofRequest(() => unconsumedTOTP(secret, email));
    await proofRequest(() => code.fill(totp));
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    // Shown once; acknowledged, never read.
    await page.getByRole("button", { name: "I've saved my recovery codes" }).click();
  } else if (await code.isVisible()) {
    const secret = recallSecret(email);
    expect(
      secret.length,
      "the MFA step needs enrollment in this process; start with a fresh disposable fixture"
    ).toBeGreaterThan(0);
    const totp = await proofRequest(() => unconsumedTOTP(secret, email));
    await proofRequest(() => code.fill(totp));
    await page.getByRole("button", { name: "Verify", exact: true }).click();
  }
  await expect(page.getByTestId("home")).toBeVisible();
}

/**
 * Clicks an account action (nav-account, sign-out). The shared layouts keep
 * them in the AccountMenu dropdown, which opens first.
 */
export async function accountAction(page: Page, testid: "nav-account" | "sign-out"): Promise<void> {
  const target = page.getByTestId(testid);
  const menu = page.getByTestId("account-menu");
  if (!(await target.isVisible()) && (await menu.isVisible())) await menu.click();
  await target.click();
}
