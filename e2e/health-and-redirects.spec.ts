/**
 * Local-demo regression coverage for the unauthenticated surface.
 *
 * Pins six behaviors that have been manually validated repeatedly during
 * recent IDP/UI work and are easy to regress silently:
 *
 *   1. UI /api/health returns {status:"ok", configured:true}.
 *   2. IDP /health returns status:"healthy".
 *   3. /login renders the email-step form.
 *   4. /site-admin/login is intentionally NOT a real route — must stay 404.
 *      (Operators occasionally mistype this URL.)
 *   5. Unauthenticated /site-admin redirects to /login.
 *   6. Unauthenticated /org-admin redirects to /login.
 *
 * These tests are fully unauthenticated. They require no env vars and run
 * in any environment where both services are reachable. If either service
 * is offline the affected test fails — these are local-demo regression
 * checks and silent skips would defeat their purpose.
 *
 * Service URLs:
 *   UI    : IDENTUUM_E2E_BASE_URL or http://localhost:7104 (Playwright baseURL)
 *   IDP   : IDENTUUM_IDP_BASE_URL or http://localhost:7113
 */

import { expect, test } from "@playwright/test";

const IDP_BASE_URL = process.env.IDENTUUM_IDP_BASE_URL ?? "http://localhost:7113";

test.describe("local-demo: service health endpoints", () => {
  test("UI /api/health returns ok + configured", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status?: string; configured?: boolean };
    expect(body.status).toBe("ok");
    expect(body.configured).toBe(true);
  });

  test("IDP /health returns healthy", async ({ request }) => {
    const res = await request.get(`${IDP_BASE_URL}/health`);
    expect(res.status()).toBe(200);
    // IDP health shape: {status, product, version, is_air_gapped}
    // Pin only `status` — product/version/is_air_gapped vary by build.
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("healthy");
  });
});

test.describe("local-demo: route shape pins", () => {
  test("/login renders the email step", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    // /login lands on the email step. The page does not redirect anywhere
    // else and renders the email-or-domain input + Continue button.
    expect(new URL(page.url()).pathname).toBe("/login");

    await expect(page.getByLabel("Email or domain")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();

    // Title must not be a framework error frame.
    expect(await page.title()).not.toMatch(/500|internal error|application error/i);
  });

  test("/site-admin/login is NOT a real route and must stay 404", async ({ request }) => {
    // Operators sometimes type /site-admin/login by analogy with /site-admin/*.
    // The correct login URL is /login. /site-admin/login has never been a real
    // route. If it ever starts 200-ing or redirecting we want to know.
    const res = await request.get("/site-admin/login", { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});

test.describe("local-demo: unauthenticated layout guards redirect to /login", () => {
  // Both layouts use server-side session checks. An unauthenticated request
  // should land on /login with a reason param (session_expired). We pin the
  // pathname only — the reason param is documented in the layout files and
  // verified by other specs.

  test("/site-admin redirects to /login when unauthenticated", async ({ page }) => {
    await page.goto("/site-admin");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("/org-admin redirects to /login when unauthenticated", async ({ page }) => {
    await page.goto("/org-admin");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe("/login");
  });
});
