import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { unconsumedTOTP } from "../../e2e/helpers/totp";
import { login } from "./export-login";
import { proofRequest } from "./proof-privacy";

/**
 * PLAN-D-4: the public ceremony and appliance-state pages — the SAME page
 * and action modules as Next — served by the OSS binary as the static export.
 * Per page: its read, one mutation where the binary can serve one, and one
 * refusal.
 *
 * What the binary cannot serve a success for, stated rather than skipped:
 * a claim token (OSS mints none: only GET /auth/claim/validate and POST
 * /auth/claim exist), and a verification or reset token (both only emailed,
 * and the binary has no mail transport here). Those pages prove their read
 * and the server's refusal of a token that is not one.
 *
 * The activation token below is minted by the site administrator through the
 * boundary and held in memory only; it is never logged.
 */

const PHASE = process.env.IDENTUUM_E2E_EXPORT_PHASE ?? "ready";
const BASE = process.env.IDENTUUM_E2E_EXPORT_BASE_URL ?? "http://localhost:7113";
const SA_EMAIL = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_EMAIL ?? "site_admin@system.local";
const SA_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_PASSWORD ?? "";
const A_EMAIL = process.env.IDENTUUM_E2E_EXPORT_TENANT_A_EMAIL ?? "";
const A_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_TENANT_A_PASSWORD ?? "";

const run = randomBytes(3).toString("hex");
const NOT_A_TOKEN = `not-a-token-${run}`;

test.describe.configure({ mode: "serial" });

test.describe("public pages in the binary", () => {
  test.skip(PHASE !== "ready", "runs only against a bootstrapped appliance");
  test.skip(
    !SA_PASSWORD || !A_PASSWORD,
    "the site administrator and tenant A fixtures are not configured"
  );

  let sa: Page;
  let a: Page;
  let activationToken = "";
  const orgDomain = `activate-proof-${run}.test`;
  const adminEmail = `admin@${orgDomain}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    sa = await (await browser.newContext({ baseURL: BASE })).newPage();
    await login(sa, SA_EMAIL, SA_PASSWORD);
    a = await (await browser.newContext({ baseURL: BASE })).newPage();
    await login(a, A_EMAIL, A_PASSWORD);
    const created = await proofRequest(() =>
      sa.request.post("/bff/api/v1/organizations", {
        headers: { "X-Requested-With": "identuum-ui", Origin: BASE },
        data: { name: `Activate proof ${run}`, domain: orgDomain, admin_email: adminEmail },
      })
    );
    expect(created.status()).toBe(201);
    activationToken = String((await created.json()).activation_token ?? "");
    expect(activationToken.length).toBeGreaterThan(0);
  });

  test("activate: read, activate with MFA enrolment, and the spent link refused", async ({
    page,
  }) => {
    await page.goto(`/activate?token=${encodeURIComponent(activationToken)}`);
    // The form names the administrator in a read-only field.
    await expect(page.locator(`input[value="${adminEmail}"]`)).toBeVisible();
    const password = `Act!${randomBytes(12).toString("hex")}`;
    await proofRequest(() => page.locator('input[name="password"]').fill(password));
    await proofRequest(() => page.locator('input[name="confirm"]').fill(password));
    await page.locator('button[type="submit"]').click();
    // Mandatory enrolment on the activated administrator's pending session.
    const secretEl = page
      .locator("p", { hasText: "Secret key" })
      .locator("xpath=following-sibling::code");
    await secretEl.waitFor({ timeout: 15_000 });
    const secret = ((await secretEl.textContent()) ?? "").trim();
    const code = await proofRequest(() => unconsumedTOTP(secret, adminEmail));
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await page.getByRole("button", { name: "I've saved my recovery codes" }).click();
    await expect(page.getByText("You're all set")).toBeVisible();

    await page.goto(`/activate?token=${encodeURIComponent(activationToken)}`);
    await expect(
      page.getByText(/Organization already activated|Link invalid or expired/).first()
    ).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
  });

  test("activate: no link and a false link are refused without a form", async ({ page }) => {
    await page.goto("/activate");
    await expect(page.getByText("No activation link provided")).toBeVisible();
    await page.goto(`/activate?token=${NOT_A_TOKEN}`);
    await expect(page.getByText("Link invalid or expired")).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
  });

  test("claim: a false claim link is refused and offers no form", async ({ page }) => {
    await page.goto(`/claim?token=${NOT_A_TOKEN}`);
    await expect(page.locator("main, body").first()).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    await expect(page.getByTestId("route-error")).toHaveCount(0);
  });

  test("forgot-password: read, request (always the same sent state), and a malformed address refused", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await expect(page.locator("h1", { hasText: "Forgot password" })).toBeVisible();
    await page.locator('input[name="email"]').fill(`nobody-${run}@nowhere.test`);
    const sent = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/auth/password/reset-request"
    );
    await page.locator('button[type="submit"]').click();
    expect((await sent).status()).toBe(200);
    await expect(page.getByText("Check your inbox")).toBeVisible();

    await page.goto("/forgot-password");
    await page.locator('input[name="email"]').fill("not-an-address");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText("Check your inbox")).toHaveCount(0);
  });

  test("reset-password: read, and a reset with a false token refused by the server", async ({
    page,
  }) => {
    await page.goto(`/reset-password?token=${NOT_A_TOKEN}`);
    await expect(page.locator("h1", { hasText: "Reset password" })).toBeVisible();
    const password = `Rst!${randomBytes(12).toString("hex")}`;
    await proofRequest(() => page.locator('input[name="newPassword"]').fill(password));
    await proofRequest(() => page.locator('input[name="confirmPassword"]').fill(password));
    const answered = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/auth/password/reset"
    );
    await page.locator('button[type="submit"]').click();
    expect((await answered).status()).toBeGreaterThanOrEqual(400);
    await expect(page.getByText("This reset link is no longer valid")).toBeVisible();
  });

  test("verify-email: a false token is refused by the server", async ({ page }) => {
    await page.goto(`/verify-email?token=${NOT_A_TOKEN}`);
    await expect(page.getByText("Link invalid or expired")).toBeVisible();
    await expect(page.getByText("Email verified")).toHaveCount(0);
  });

  test("setup-required and upgrade: read on a bootstrapped OSS appliance", async ({ page }) => {
    await page.goto("/setup-required");
    await expect(page.locator("h1", { hasText: "Setup required" })).toBeVisible();
    await page.goto("/upgrade");
    await expect(page.getByText("Upgrade").first()).toBeVisible();
    await expect(page.getByTestId("route-error")).toHaveCount(0);
  });

  test("dashboard/security: an org_admin is refused the org_user dashboard", async () => {
    await a.goto("/dashboard/security");
    await expect(a).toHaveURL(`${BASE}/org-admin`);
  });
});
