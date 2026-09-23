import { expect, type Page } from "@playwright/test";
import { unconsumedTOTP } from "../../e2e/helpers/totp";
import { proofRequest } from "./proof-privacy";

// A fresh fixture enrolls once in this worker. Neither its secret nor its
// browser credentials leave memory. A later run needs a new fixture.
const enrolledSecrets = new Map<string, string>();

function rememberSecret(email: string, secret: string): void {
  enrolledSecrets.set(email, secret);
}

function recallSecret(email: string): string {
  return enrolledSecrets.get(email) ?? "";
}

/**
 * Signs in through the export, completing whichever second-factor step the
 * appliance demands: enrolment on the first login (the secret is read from
 * the page the way a person would read the QR code), the authenticator step on
 * every later one. Codes come from the repository's ledger-backed generator so
 * a step is never presented twice (THE-SUITE-THAT-REPLAYED).
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  if (!password) throw new Error("the requested disposable login fixture is not configured");
  await page.goto("/login");
  await page.getByTestId("password-form").waitFor();
  await page.locator('input[name="email"]').fill(email);
  await proofRequest(() => page.locator('input[name="password"]').fill(password));
  await page.locator('button[type="submit"]').click();
  const outcome = page
    .getByTestId("home")
    .or(page.getByTestId("mfa-secret"))
    .or(page.getByTestId("mfa-form"))
    .or(page.getByTestId("login-error"))
    .first();
  await outcome.waitFor();
  if (await page.getByTestId("login-error").isVisible()) {
    // Fail fast without copying a potentially sensitive server response into
    // the test error. Five wrong passwords inside
    // fifteen minutes lock the account (LoginRiskService: threshold 5, window
    // 15m) and a locked account answers "Invalid credentials." by design.
    throw new Error("login refused by the disposable fixture");
  }
  if (await page.getByTestId("mfa-secret").isVisible()) {
    const secret = (await page.getByTestId("mfa-secret").textContent())?.trim() ?? "";
    expect(secret.length).toBeGreaterThan(0);
    rememberSecret(email, secret);
    const code = await proofRequest(() => unconsumedTOTP(secret, email));
    await proofRequest(() =>
      page.getByTestId("mfa-enroll-form").locator('input[name="code"]').fill(code)
    );
    await page.getByTestId("mfa-enroll-form").locator('button[type="submit"]').click();
  } else if (await page.getByTestId("mfa-form").isVisible()) {
    const secret = recallSecret(email);
    expect(
      secret.length,
      "the MFA step needs enrollment in this process; start with a fresh disposable fixture"
    ).toBeGreaterThan(0);
    const code = await proofRequest(() => unconsumedTOTP(secret, email));
    await proofRequest(() => page.getByTestId("mfa-form").locator('input[name="code"]').fill(code));
    await page.getByTestId("mfa-form").locator('button[type="submit"]').click();
  }
  await expect(page.getByTestId("home")).toBeVisible();
}
