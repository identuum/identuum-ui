import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { login, orgAdminAccount, siteAdminAccount } from "./export-login";

/**
 * UI-SEC-HEADERS (review UI-XSS-REVIEW-2026-10-06, M1 and M2): the binary
 * serves the console shell with a script policy and no-referrer, and EVERY
 * route of the export still loads under that policy, enforced, with no
 * policy violation in the browser.
 *
 * The route list is read from the export's own route tables (public, org-admin,
 * site-admin), so a new route is walked without editing this spec. A route
 * with a parameter gets a placeholder; /logout is left out (it signs the
 * walk out) and is the only one.
 *
 * Fixtures (ready phase): the run's site administrator and org administrator.
 */

const PHASE = process.env.IDENTUUM_E2E_EXPORT_PHASE ?? "ready";

const SHELL_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const PLACEHOLDER = "00000000-0000-7000-8000-000000000000";

function routesOf(file: string): string[] {
  const src = readFileSync(resolve(__dirname, "../src", file), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/route\(\/\^(.+?)\$\//g)) {
    out.push((m[1] ?? "").replaceAll("\\/", "/").replaceAll("([^/]+)", PLACEHOLDER));
  }
  expect(out.length, `${file} yielded no routes: the census would judge nothing`).toBeGreaterThan(
    0
  );
  return out;
}

async function watch(ctx: BrowserContext): Promise<{ page: Page; violations: string[] }> {
  const page = await ctx.newPage();
  const violations: string[] = [];
  // Registered by the browser before any page script, on every document.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("CSP-VIOLATION") || /Content Security Policy/i.test(t)) {
      violations.push(`${new URL(page.url()).pathname}: ${t.split("\n")[0]?.slice(0, 200)}`);
    }
  });
  return { page, violations };
}

async function walk(page: Page, paths: string[]): Promise<void> {
  for (const p of paths) {
    const res = await page.goto(p);
    expect(res, `${p}: no response`).not.toBeNull();
    // The shell rendered: the export's root holds the page.
    await page.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0);
    // Let the page's own requests run under the policy. A page that polls
    // never goes idle; the rendered root above is the load proof.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("the shell's policy in the binary", () => {
  test.skip(PHASE !== "ready", "runs only against a bootstrapped appliance");

  test("every shell response carries the script policy and no-referrer; the API keeps its headers", async ({
    request,
  }) => {
    for (const p of [
      "/",
      "/login",
      "/claim?token=x",
      "/invite?token=x",
      "/reset-link?token=x",
      "/site-admin",
    ]) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status(), p).toBe(200);
      expect(res.headers()["content-security-policy"], p).toBe(SHELL_CSP);
      expect(res.headers()["referrer-policy"], p).toBe("no-referrer");
    }
    const api = await request.get("/api/status");
    expect(api.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(api.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("an account-link page sends no Referer with its requests", async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const referers: string[] = [];
      let subrequests = 0;
      page.on("request", (r) => {
        if (r.isNavigationRequest()) return;
        subrequests++;
        if (r.headers().referer) referers.push(new URL(r.url()).pathname);
      });
      await page.goto("/claim?token=e2e-not-a-real-token");
      await page.waitForFunction(
        () => (document.getElementById("root")?.childElementCount ?? 0) > 0
      );
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      // The page's scripts, stylesheet and API calls: without them there is
      // nothing to judge.
      expect(subrequests, "the claim page made no request to judge").toBeGreaterThan(0);
      expect(referers, "requests that carried a Referer").toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test("every export route loads under the policy with no violation", async ({ browser }) => {
    test.setTimeout(300_000);
    const sa = siteAdminAccount();
    const oa = orgAdminAccount();
    test.skip(!sa.password || !oa, "the run's site and org administrators are not configured");

    const publicRoutes = ["/", ...routesOf("public-routes.tsx").filter((p) => p !== "/logout")];
    const siteAdmin = [...routesOf("site-admin-routes.tsx"), "/account/settings"];
    const orgAdmin = routesOf("org-admin-routes.tsx");
    const all: string[] = [];

    const anon = await browser.newContext();
    const saCtx = await browser.newContext();
    const oaCtx = await browser.newContext();
    try {
      const a = await watch(anon);
      await walk(a.page, publicRoutes);
      all.push(...a.violations);

      const s = await watch(saCtx);
      await login(s.page, sa.email, sa.password);
      await walk(s.page, siteAdmin);
      all.push(...s.violations);

      const o = await watch(oaCtx);
      if (oa) await login(o.page, oa.email, oa.password);
      await walk(o.page, orgAdmin);
      all.push(...o.violations);
    } finally {
      await anon.close();
      await saCtx.close();
      await oaCtx.close();
    }
    expect(all, "policy violations").toEqual([]);
  });
});
