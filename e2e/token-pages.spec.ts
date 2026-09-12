/**
 * THE-NINE-DARK-PAGES (2026-08-29) — the token-landing and static pages that
 * had NO spec at all (UI census NOT-VISITED class), plus the /dashboard/security
 * compat redirect's actual transition.
 *
 * Routes lit here: /setup-required, /forgot-password, /reset-password,
 * /activate, /dashboard/security. (/invitation was covered here until
 * THE-DEAD-INVITATION deleted the page — dead on both backends, owner
 * ruling: removed, not mounted.) Every test asserts rendered
 * content or a state transition, and each page's failure/missing state where
 * one exists. Tokens come from surfaces that ALREADY exist:
 *   - /activate: site_admin creates a disposable org and re-issues its
 *     activation token (POST /organizations/:id/resend-activation — the same
 *     surface the e2e-full sweeps use).
 * No mail catcher; the mail-only path (a REAL emailed reset token for
 * /reset-password's success phase) is out of scope by design — the page's
 * missing-token, weak-password (P0-9: policy is checked BEFORE token
 * validity), and invalid-token states are all assertable without it.
 *
 * Gating: the anonymous tests run everywhere. The token-minting tests gate on
 * the same centralized credential predicates the rest of the suite uses; in
 * the provisioned e2e-full harness the envelope supplies all of them, so
 * NOTHING here self-skips there (rule 1 of the slice).
 *
 * SECURITY: tokens are used, never logged; failure messages assert page copy
 * only.
 */
import { expect, test } from "@playwright/test";
import { api, expectStatus } from "./helpers/appliance-fixture";
import {
  loginAsOrgUser,
  SITE_ADMIN_EMAIL,
  SITE_ADMIN_PASSWORD,
  SITE_ADMIN_TOTP_SECRET,
  SKIP_AUTH_MSG,
  skipAuthTests,
  skipOrgUserTests,
} from "./helpers/login";
import { generateTOTP } from "./helpers/totp";

const IDP_BASE = process.env.IDENTUUM_IDP_BASE_URL ?? "http://localhost:7113";

test.describe.configure({ mode: "serial" });

/**
 * API bearer for an ALREADY-TOTP-enrolled account: login (401 + session_id)
 * then MFA-verify, walking up to three 30-second windows because an adjacent
 * spec's login may have consumed the current window's code (replay guard).
 */
async function bearerFor(email: string, password: string, totpSecret: string): Promise<string> {
  const login = await api(IDP_BASE, "POST", "/api/v1/auth/login", { email, password });
  if (login.status !== 401 || !login.json.session_id) {
    throw new Error(`bearerFor: want 401+session_id, got ${login.status}`);
  }
  const sessionId = login.json.session_id as string;
  for (let win = 0; win <= 2; win++) {
    const v = await api(IDP_BASE, "POST", "/api/v1/auth/login/mfa", {
      session_id: sessionId,
      code: generateTOTP(totpSecret, win),
    });
    if (v.status === 200 && v.json.access_token) return v.json.access_token as string;
  }
  throw new Error("bearerFor: no TOTP window accepted (replay guard)");
}

test.describe("token-landing + static pages (NINE-DARK-PAGES)", () => {
  test("/setup-required renders its static explanation", async ({ page }) => {
    await page.goto("/setup-required");
    await expect(page.getByRole("heading", { name: "Setup required" })).toBeVisible();
  });

  test("/forgot-password: form renders; submit answers with the anti-enumeration copy", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Forgot password" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();

    // STATE TRANSITION: the generic confirmation is the SAME whether or not
    // the address exists — assert it with a syntactically valid ghost address
    // so no real account is touched.
    await page.getByLabel("Email").fill("ghost-nine-dark-pages@e2e.invalid");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/If an account exists for that email address/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("/reset-password: missing-token, weak-password-before-token (P0-9), invalid-token", async ({
    page,
  }) => {
    // MISSING STATE: no token in the URL.
    await page.goto("/reset-password");
    await expect(page.getByText("No reset token in this URL")).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a reset link" })).toBeVisible();

    // FORM renders for a garbage token (the token is only spent on submit).
    await page.goto("/reset-password?token=invalid_e2e_token_nine_dark_pages");
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();

    // BAD-PASSWORD-NEVER-BURNS-THE-LINK, as the PAGE enforces it: the input's
    // native minlength=8 blocks a shorter password before any request leaves
    // the browser (measured — no server call happens), so the token is never
    // judged and the invalid-link surface must NOT appear. The server-side
    // P0-9 ordering (weak_password before token validity) is pinned at the
    // API layer by auth-sweep; through the browser the native constraint is
    // the front line.
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Confirm new password").fill("short");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await expect(page.getByText("This reset link is no longer valid")).not.toBeVisible();

    // FAILURE STATE: a strong password with a garbage token → the invalid-link
    // surface (the token was judged only once the password passed policy).
    await page.getByLabel("New password", { exact: true }).fill("Str0ng!nine-dark-pages");
    await page.getByLabel("Confirm new password").fill("Str0ng!nine-dark-pages");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("This reset link is no longer valid")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("/activate: missing + invalid states, and the valid token renders the activation form", async ({
    page,
  }) => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }

    // MISSING + INVALID states need no fixture.
    await page.goto("/activate");
    await expect(page.getByRole("heading", { name: "No activation link provided" })).toBeVisible();
    await page.goto("/activate?token=invalid_e2e_token_nine_dark_pages");
    await expect(page.getByRole("heading", { name: "Link invalid or expired" })).toBeVisible();

    // VALID: site_admin creates a disposable org and re-issues its activation
    // token — the surface that already exists (no new fixture, no mail).
    const bearer = await bearerFor(SITE_ADMIN_EMAIL, SITE_ADMIN_PASSWORD, SITE_ADMIN_TOTP_SECRET);
    const runId = Date.now().toString(36);
    const org = await api(
      IDP_BASE,
      "POST",
      "/api/v1/organizations",
      {
        name: `ninedark ${runId}`,
        slug: `ninedark-${runId}`,
        domain: `ninedark-${runId}.test`,
        admin_email: `admin@ninedark-${runId}.test`,
      },
      bearer
    );
    expectStatus(org, 201, "disposable org for the activation link → 201");
    const orgId = ((org.json.organization as { id?: string })?.id ?? org.json.id) as string;
    const reissue = await api(
      IDP_BASE,
      "POST",
      `/api/v1/organizations/${orgId}/resend-activation`,
      {},
      bearer
    );
    expectStatus(reissue, 200, "re-issue activation token → 200");
    const token = (reissue.json.activation_token as string) ?? "";
    expect(token.length).toBeGreaterThan(0);

    // The valid link renders the activation form with the pending admin's
    // email bound and the password field ready.
    await page.goto(`/activate?token=${encodeURIComponent(token)}`);
    await expect(page.getByText("Activate your organization").first()).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

    // STATE TRANSITION: set the password. The ceremony consumes the token and
    // renders "Organization activated" — as the mfa_setup phase (inline TOTP
    // enrollment, the live shape: the appliance opens a pending MFA session)
    // or the plain success panel. Both carry the same activated copy.
    await page.getByLabel("Password", { exact: true }).fill(`Adm!${runId}9wqX`);
    await page.getByLabel("Confirm password").fill(`Adm!${runId}9wqX`);
    await page.getByRole("button", { name: "Set password and activate" }).click();
    await expect(page.getByText("Organization activated").first()).toBeVisible({
      timeout: 15_000,
    });

    // The consumed token is DEAD: revisiting the same link is the invalid state.
    await page.goto(`/activate?token=${encodeURIComponent(token)}`);
    await expect(
      page.getByRole("heading", { name: /Link invalid or expired|Organization already activated/ })
    ).toBeVisible();
  });

  test("/dashboard/security: the compat redirect lands an org_user on the passkeys tab", async ({
    page,
  }) => {
    if (skipOrgUserTests) {
      test.skip(true, "org_user credentials unavailable (envelope or IDENTUUM_TEST_ORG_USER_*)");
    }
    await loginAsOrgUser(page);

    // STATE TRANSITION: the route is a pure server redirect —
    // /dashboard/security → /account/settings?tab=passkeys — and the target
    // renders real content for the logged-in user.
    await page.goto("/dashboard/security");
    await page.waitForURL(/\/account\/settings\?tab=passkeys/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /account settings/i })).toBeVisible();
  });
});
