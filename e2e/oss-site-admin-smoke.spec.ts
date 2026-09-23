/**
 * OSS site-admin overview smoke — exactly ONE Playwright test.
 *
 * Canonical entrypoint: identuum-ui/e2e/scripts/run-oss-site-admin-smoke.sh
 * (boots identuum-idp-oss against a disposable Postgres, --bootstrap-s a
 * site_admin, then runs this spec against a UI pointed at that backend).
 *
 * This spec is GATED on IDENTUUM_E2E_OSS_SITE_ADMIN_SMOKE=1 (set by the
 * up-script) so it never runs during the default `pnpm e2e` suite. It logs
 * in as the bootstrapped site_admin (email + password; the freshly
 * bootstrapped admin has no MFA enrolled) and asserts the /site-admin
 * overview renders its three cards: Identity, Deployed capabilities,
 * Backend health.
 *
 * SECURITY: the password is read from env (supplied by the up-script) and is
 * NEVER printed/logged/asserted by value. No cookie/session value is read.
 */
import { expect, test } from "@playwright/test";
import { unconsumedTOTP } from "./helpers/totp";
import { uiOriginHeader } from "./helpers/ui-origin";

const ENABLED = process.env.IDENTUUM_E2E_OSS_SITE_ADMIN_SMOKE === "1";
const ADMIN_EMAIL = process.env.IDENTUUM_E2E_OSS_SMOKE_ADMIN_EMAIL ?? "site_admin@system.local";
const ADMIN_PASSWORD = process.env.IDENTUUM_E2E_OSS_SMOKE_ADMIN_PASSWORD ?? "";
const ADMIN_TOTP_SECRET = process.env.IDENTUUM_E2E_OSS_SMOKE_ADMIN_TOTP_SECRET ?? "";

test.describe("OSS site-admin overview smoke", () => {
  test.skip(
    !ENABLED,
    "Set IDENTUUM_E2E_OSS_SITE_ADMIN_SMOKE=1 — run via e2e/scripts/run-oss-site-admin-smoke.sh"
  );
  test.setTimeout(60_000);

  test("bootstrapped site_admin logs in and the overview cards render", async ({ page }) => {
    // 1. Authenticate as the bootstrapped site_admin via the REAL cookie-login
    //    endpoint — the exact /api/v1/auth/login the UI's PasswordForm posts to
    //    (same-origin via the /api/idp proxy). page.request shares the browser
    //    context cookie jar, so the minted session cookie is carried into the
    //    page navigation below. OSS ALWAYS requires MFA for site_admin, so the
    //    up-script seeds a known base32 TOTP secret and enables MFA; we compute
    //    the live RFC 6238 code and submit it in the same login call
    //    (localLoginRequest accepts totp_code). This is a REAL MFA login — it
    //    does NOT bypass any authorization guard: /site-admin is still gated
    //    server-side by the site-admin layout guard + RequireSiteAdmin. No
    //    credential or TOTP value is logged.
    expect(ADMIN_TOTP_SECRET, "IDENTUUM_E2E_OSS_SMOKE_ADMIN_TOTP_SECRET must be set").not.toBe("");
    const loginRes = await page.request.post("/api/idp/api/v1/auth/login", {
      headers: uiOriginHeader(),
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        totp_code: await unconsumedTOTP(ADMIN_TOTP_SECRET, ADMIN_EMAIL),
        remember_me: false,
      },
    });
    expect(loginRes.ok(), `proxy login status=${loginRes.status()}`).toBeTruthy();

    // 2. Navigate to the protected overview. The session cookie authenticates
    //    us; the site-admin guard admits the site_admin role.
    await page.goto("/site-admin");
    await page.waitForURL(/\/site-admin(\?|$|\/)/, { timeout: 30_000 });

    // 4. The three overview cards must render (Section titles in
    //    src/app/site-admin/client.tsx). This is the load-bearing assertion:
    //    it proves the authed site_admin reached the real overview behind the
    //    server-side RequireSiteAdmin / layout guard — not a fallback page.
    // The Section titles render as <p> elements (CSS-uppercased; DOM text is
    // mixed-case), so match by exact text rather than a heading role.
    await expect(
      page.getByText("Identity", { exact: true }),
      "Identity card must render on the site-admin overview"
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("Deployed capabilities", { exact: true }),
      "Deployed capabilities card must render on the site-admin overview"
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("Backend health", { exact: true }),
      "Backend health card must render on the site-admin overview"
    ).toBeVisible({ timeout: 10_000 });
  });
});
