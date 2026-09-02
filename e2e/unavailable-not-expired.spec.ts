/**
 * THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02) — live pin of the three
 * session states against the real appliance PLUS a 503 stub fronting the
 * IdP for the UI server:
 *
 *   1. signed in as site_admin, /site-admin renders (control);
 *   2. the UI's runtime config is repointed at a local stub that answers the
 *      OP's honest AUTH-503 shape (503, Retry-After: 1, X-Request-ID,
 *      {correlation_id}) — the page shows the unavailable state WITH that
 *      correlation id, the URL stays on /site-admin (no /login), and the
 *      auth cookies are untouched;
 *   3. the stub is removed (config restored) — a reload resumes the session
 *      WITHOUT re-login;
 *   4. a genuine verdict (cookies dropped) still lands on
 *      /login?reason=session_expired.
 *
 * The UI dev server reads its runtime config file on every request
 * (loadRuntimeConfig has no cache), so the config path the harness hands it
 * (IDENTUUM_UI_CONFIG_FILE) is rewritten in place and restored in finally.
 * The stub answers every path with the 503 shape: the layout consults the
 * session state first and renders in place, so nothing else is fetched.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { loginAsSiteAdmin, SKIP_AUTH_MSG, skipAuthTests } from "./helpers/login";

const STUB_CID = "e2e-stub-503";

function configFilePath(): string | null {
  const explicit = process.env.IDENTUUM_UI_CONFIG_FILE;
  if (explicit && existsSync(explicit)) return explicit;
  const dynamic = resolve(__dirname, ".auth", "ui-runtime.e2e.json");
  if (existsSync(dynamic)) return dynamic;
  return null;
}

async function startStub(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(503, {
      "content-type": "application/json",
      "retry-after": "1",
      "x-request-id": STUB_CID,
    });
    res.end(
      JSON.stringify({
        error: "temporarily_unavailable",
        error_description: "authentication store unavailable; retry",
        reason: "auth_store_error",
        correlation_id: STUB_CID,
      })
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("stub did not bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test.describe("UNAVAILABLE-NOT-EXPIRED-1 — an outage is not a sign-out", () => {
  test("503 stub → unavailable state with the correlation id, no /login, cookies kept; stub gone → session resumes; real 401 → /login", async ({
    page,
  }) => {
    if (skipAuthTests) {
      test.skip(true, SKIP_AUTH_MSG);
    }
    const cfgPath = configFilePath();
    if (!cfgPath) {
      test.skip(
        true,
        "no writable UI runtime config file for this run (IDENTUUM_UI_CONFIG_FILE unset)"
      );
      return;
    }
    test.setTimeout(120_000);

    await loginAsSiteAdmin(page);
    await page.goto("/site-admin");
    await expect(page).toHaveURL(/\/site-admin/);
    const cookiesBefore = (await page.context().cookies()).map((c) => c.name);
    expect(cookiesBefore).toContain("access_token");

    const original = readFileSync(cfgPath, "utf-8");
    const stub = await startStub();
    try {
      const cfg = JSON.parse(original) as { idp: Record<string, unknown> };
      cfg.idp.internal_base_url = stub.url;
      writeFileSync(cfgPath, `${JSON.stringify(cfg)}\n`);

      // The guard retries within its 8 s cap (Retry-After 1 s honored), then
      // renders the unavailable state IN PLACE.
      await page.goto("/site-admin", { waitUntil: "domcontentloaded" });
      const state = page.getByTestId("service-unavailable");
      await expect(state).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("service-unavailable-correlation-id")).toHaveText(STUB_CID);
      await expect(page).toHaveURL(/\/site-admin/);
      expect(page.url()).not.toContain("/login");
      const cookiesDuring = (await page.context().cookies()).map((c) => c.name);
      expect(cookiesDuring, "an outage clears no cookie").toContain("access_token");
    } finally {
      writeFileSync(cfgPath, original);
      await new Promise<void>((r) => stub.server.close(() => r()));
    }

    // Stub gone: the same session resumes without any re-login.
    await page.goto("/site-admin");
    await expect(page).toHaveURL(/\/site-admin/);
    await expect(page.getByTestId("service-unavailable")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    // The /unavailable landing (used by non-rendering callers) renders the id it is given.
    await page.goto("/unavailable?cid=e2e-direct&status=503&retry=1");
    await expect(page.getByTestId("service-unavailable-correlation-id")).toHaveText("e2e-direct");

    // A genuine verdict still redirects: drop the cookies, the guard sends us to /login.
    await page.context().clearCookies();
    await page.goto("/site-admin");
    await expect(page).toHaveURL(/\/login\?reason=session_expired/);
  });
});
