import { expect, type Page } from "@playwright/test";
import { loadOrgAdminFixture, loadSiteAdminFixture } from "../../e2e/helpers/fixture";
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

const enrolled = new Set<string>();

/** True once `email` enrolled its authenticator in this process. */
export function enrolledHere(email: string): boolean {
  return enrolled.has(email);
}

// OSS-REGISTER-UI item 7: inside e2e-full (IDENTUUM_E2E_EXPORT_FIXTURE=1) the
// appliance's site administrator and organization administrator enrolled
// earlier in the run; their authenticators come from the run's fixture
// envelope (e2e/helpers/fixture.ts), read here and never printed.
interface Account {
  email: string;
  password: string;
}
let siteAdmin: Account | null = null;
let orgAdmin: Account | null = null;
if (process.env.IDENTUUM_E2E_EXPORT_FIXTURE === "1") {
  const sa = loadSiteAdminFixture();
  const oa = loadOrgAdminFixture();
  if (sa) {
    rememberSecret(sa.email, sa.totpSecret);
    siteAdmin = { email: sa.email, password: sa.password };
  }
  if (oa) {
    rememberSecret(oa.email, oa.totpSecret);
    orgAdmin = { email: oa.email, password: oa.password };
  }
  // Inside the run an absent envelope is a failure, never a quiet skip: a
  // phase whose specs all skipped would read green having proven nothing.
  if (!siteAdmin || !orgAdmin) {
    throw new Error("IDENTUUM_E2E_EXPORT_FIXTURE=1 but the run's fixture envelope is absent");
  }
}

/** The site administrator: the run's fixture inside e2e-full, else the environment. */
export function siteAdminAccount(): Account {
  return (
    siteAdmin ?? {
      email: process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_EMAIL ?? "site_admin@system.local",
      password: process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_PASSWORD ?? "",
    }
  );
}

/** The run fixture's organization administrator (e2e-full only). */
export function orgAdminAccount(): Account | null {
  return orgAdmin;
}

/**
 * A link the appliance issued names the UI origin it was configured with;
 * the proof follows it on the binary under test, keeping path and query.
 */
export function onBaseURL(link: string, baseURL: string): string {
  const u = new URL(link);
  return new URL(`${u.pathname}${u.search}`, baseURL).href;
}

/**
 * Signs in through the SHARED login page (src/components/auth/login-flow.tsx,
 * served by the export since PLAN-D-4) with whatever second factor the
 * appliance demands: enrolment on the first login (the secret is read from
 * the page once, the recovery codes are acknowledged and never read), or a
 * code for an account enrolled earlier in this process.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
  newPassword?: string
): Promise<void> {
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
  const loginError = page.getByTestId("login-error");
  // D-017: an admin-set password is changed first, when the caller gives the
  // new one (OSS-HARDEN's password-change walk); then the second factor.
  const change = page.getByTestId("password-change-form");
  await page.getByTestId("home").or(secretEl).or(code).or(change).or(loginError).first().waitFor();
  if (newPassword && (await change.isVisible())) {
    await proofRequest(() => page.getByLabel("New password", { exact: true }).fill(newPassword));
    await proofRequest(() => page.getByLabel("Confirm new password").fill(newPassword));
    await page.getByRole("button", { name: "Change password and continue" }).click();
    await page.getByTestId("home").or(secretEl).or(code).or(loginError).first().waitFor();
  }
  if (await page.getByTestId("login-error").isVisible()) {
    // Fail fast without copying a potentially sensitive server response into
    // the test error.
    throw new Error("login refused by the disposable fixture");
  }
  if (await secretEl.isVisible()) {
    const secret = ((await secretEl.textContent()) ?? "").trim();
    expect(secret.length).toBeGreaterThan(0);
    rememberSecret(email, secret);
    enrolled.add(email);
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
