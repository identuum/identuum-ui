import { execFileSync } from "node:child_process";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { resetTOTPLedgerForTests } from "../../e2e/helpers/totp";
import { login as loginAs } from "./export-login";
import { expectNoAuthMaterial, expectNoBrowserAuthMaterial, proofRequest } from "./proof-privacy";

/**
 * THE-UI-THAT-GO-CAN-SERVE (Plan B): the proof set against the export the OSS
 * binary serves. Two phases, selected by IDENTUUM_E2E_EXPORT_PHASE:
 *
 *   fresh  — a migrated, un-bootstrapped appliance: setup-state.
 *   ready  — a bootstrapped appliance: login, the dynamic-ID page, the
 *            protected mutation, logout, revocation, the negative proofs.
 *            With IDENTUUM_E2E_EXPORT_FIXTURE_CONTAINER, also proves unavailable
 *            vs expiry and local-only logout against the paused fixture store.
 *
 * No secret is read from a file or printed: the site-admin password arrives
 * in IDENTUUM_E2E_EXPORT_SITE_ADMIN_PASSWORD and is only ever typed.
 */

const PHASE = process.env.IDENTUUM_E2E_EXPORT_PHASE ?? "ready";
const EMAIL = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_EMAIL ?? "site_admin@system.local";
const PASSWORD = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_PASSWORD ?? "";
const ORG_EMAIL = process.env.IDENTUUM_E2E_EXPORT_ORG_ADMIN_EMAIL ?? "org-admin@example.test";
const ORG_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_ORG_ADMIN_PASSWORD ?? "";
const FIXTURE_CONTAINER = process.env.IDENTUUM_E2E_EXPORT_FIXTURE_CONTAINER ?? "";
const SECONDARY_BASE_URL = process.env.IDENTUUM_E2E_EXPORT_SECONDARY_BASE_URL ?? "";
const BFF_HEADER = "X-Requested-With";
const BFF_VALUE = "identuum-ui";
const RANDOM_UUID = "9f1e2d3c-4b5a-4c6d-8e7f-000000000001";

test.describe.configure({ mode: "serial" });
if (PHASE !== "fresh" && PHASE !== "ready") {
  throw new Error(
    "export proof phase must be fresh or ready; outage runs in the same ready process"
  );
}
resetTOTPLedgerForTests(null);

let outageState: Awaited<ReturnType<Awaited<ReturnType<Browser["newContext"]>>["storageState"]>>;
let storePaused = false;

// Sign-in with enrol-or-verify MFA lives in ./export-login.ts (shared with
// the org-admin spec); the site administrator is the default fixture here.
function login(page: Page, email = EMAIL, password = PASSWORD): Promise<void> {
  return loginAs(page, email, password);
}

async function cookieNames(
  page: Page
): Promise<Record<string, { httpOnly: boolean; sameSite: string; value: string }>> {
  const out: Record<string, { httpOnly: boolean; sameSite: string; value: string }> = {};
  for (const c of await page.context().cookies()) {
    out[c.name] = { httpOnly: c.httpOnly, sameSite: c.sameSite, value: c.value };
  }
  return out;
}

// ------------------------------------------------------------------ fresh

test.describe("fresh appliance", () => {
  test.skip(PHASE !== "fresh", "runs only against a migrated, un-bootstrapped appliance");

  test("setup-state: the root routes to /setup, never to the login form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("setup-required")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/setup");
    await expect(page.getByTestId("login")).toHaveCount(0);
  });

  test("setup-state: /login on a fresh appliance still renders the form (no ladder on a deep link)", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.getByTestId("password-form")).toBeVisible();
  });
});

// ------------------------------------------------------------------ ready

test.describe("bootstrapped appliance", () => {
  test.skip(PHASE !== "ready", "runs only against a bootstrapped appliance");
  test.skip(PASSWORD === "", "IDENTUUM_E2E_EXPORT_SITE_ADMIN_PASSWORD is not set");

  test("setup-state: the root routes to /login once setup is complete", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("login")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("login: success sets HttpOnly cookies and exposes no token to page script", async ({
    page,
  }) => {
    const bodies: string[] = [];
    page.on("response", async (res) => {
      if (res.url().includes("/bff/api/v1/auth/login")) bodies.push(await res.text());
    });
    await login(page);
    const cookies = await cookieNames(page);
    expect(cookies.access_token?.httpOnly).toBe(true);
    expect(cookies.access_token?.sameSite).toBe("Lax");
    expect(cookies.refresh_token?.httpOnly).toBe(true);
    // Page script cannot see either cookie, and the login body carried no token.
    const knownValues = [cookies.access_token?.value ?? "", cookies.refresh_token?.value ?? ""];
    await expectNoBrowserAuthMaterial(page, knownValues);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expectNoAuthMaterial(b, knownValues);
    }
  });

  test("automatic refresh: missing access renews for a read and before a single mutation", async ({
    page,
  }) => {
    await login(page);
    const initial = await cookieNames(page);
    expect(Boolean(initial.refresh_token?.value)).toBe(true);
    let renewals = 0;
    let mutations = 0;
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/bff/session/refresh" && request.method() === "POST") renewals += 1;
      if (path === "/bff/api/v1/profile" && request.method() === "PUT") mutations += 1;
    });

    // Remove only access state. No lifetime, database row or replay rule changes.
    await page.context().clearCookies({ name: "access_token" });
    await page.reload();
    await expect(page.getByTestId("home")).toBeVisible();
    const afterRead = await cookieNames(page);
    expect(Boolean(afterRead.access_token?.value)).toBe(true);
    expect(afterRead.access_token?.httpOnly).toBe(true);
    expect(afterRead.refresh_token?.httpOnly).toBe(true);
    expect(Boolean(afterRead.refresh_token?.value)).toBe(true);
    expect(afterRead.refresh_token?.value !== initial.refresh_token?.value).toBe(true);
    expect(renewals).toBe(1);

    await page.getByTestId("nav-account").click();
    await page.getByTestId("profile-name").fill("Site Admin (renewal proof)");
    await page.context().clearCookies({ name: "access_token" });
    await page.getByTestId("profile-form").locator('button[type="submit"]').click();
    await expect(page.getByTestId("profile-outcome")).toHaveText(
      "saved:Site Admin (renewal proof)"
    );
    const afterMutation = await cookieNames(page);
    expect(Boolean(afterMutation.access_token?.value)).toBe(true);
    expect(Boolean(afterMutation.refresh_token?.value)).toBe(true);
    expect(afterMutation.refresh_token?.value !== afterRead.refresh_token?.value).toBe(true);
    expect(renewals).toBe(2);
    expect(mutations).toBe(1);
    await expectNoBrowserAuthMaterial(page, [
      afterMutation.access_token?.value ?? "",
      afterMutation.refresh_token?.value ?? "",
    ]);
  });

  test("automatic refresh: unavailable replay state refuses the mutation and retains browser state", async ({
    page,
  }) => {
    test.skip(FIXTURE_CONTAINER === "", "no disposable fixture container was supplied");
    const label = execFileSync(
      "docker",
      [
        "inspect",
        "--format",
        '{{index .Config.Labels "identuum.ui-export-proof"}}',
        FIXTURE_CONTAINER,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (label !== "disposable")
      throw new Error("outage injection requires a labelled disposable fixture");
    await login(page);
    await page.getByTestId("nav-account").click();
    await page.getByTestId("profile-name").fill("Must not be submitted during outage");
    const before = await cookieNames(page);
    expect(Boolean(before.refresh_token?.value)).toBe(true);
    await page.context().clearCookies({ name: "access_token" });
    let renewals = 0;
    let mutations = 0;
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/bff/session/refresh" && request.method() === "POST") renewals += 1;
      if (path === "/bff/api/v1/profile" && request.method() === "PUT") mutations += 1;
    });
    execFileSync("docker", ["pause", FIXTURE_CONTAINER], { stdio: "ignore" });
    try {
      await page.getByTestId("profile-form").locator('button[type="submit"]').click();
      await expect(page.getByTestId("profile-outcome")).toHaveText("error:503", {
        timeout: 30_000,
      });
      const after = await cookieNames(page);
      expect(renewals).toBe(1);
      expect(mutations).toBe(0);
      expect(after.access_token === undefined).toBe(true);
      expect(after.refresh_token?.value === before.refresh_token?.value).toBe(true);
      expect(new URL(page.url()).pathname).toBe("/account/settings");
      await expect(page.getByTestId("login")).toHaveCount(0);
    } finally {
      execFileSync("docker", ["unpause", FIXTURE_CONTAINER], { stdio: "ignore" });
    }
  });

  test("automatic refresh: two processes share rotation and reject reuse after grace", async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(SECONDARY_BASE_URL === "", "no second disposable process was supplied");
    const primary = new URL(baseURL ?? "");
    const secondary = new URL(SECONDARY_BASE_URL);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(primary.hostname) ||
      secondary.hostname !== primary.hostname ||
      secondary.protocol !== primary.protocol ||
      secondary.origin === primary.origin ||
      secondary.username ||
      secondary.password ||
      secondary.pathname !== "/" ||
      secondary.search ||
      secondary.hash
    ) {
      throw new Error("two-process proof requires distinct loopback ports on the same host");
    }
    await login(page);
    const before = await cookieNames(page);
    const predecessor = before.refresh_token?.value ?? "";
    expect(predecessor.length > 0).toBe(true);
    const refresh = (origin: string, value: string) =>
      proofRequest(() =>
        request.post(`${origin}/bff/session/refresh`, {
          headers: {
            Cookie: `refresh_token=${value}`,
            Origin: origin,
            [BFF_HEADER]: BFF_VALUE,
          },
          maxRedirects: 0,
        })
      );
    const responses = await Promise.all([
      refresh(primary.origin, predecessor),
      refresh(secondary.origin, predecessor),
    ]);
    for (const response of responses) {
      expect(response.status()).toBe(204);
      expect((await response.body()).length).toBe(0);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
    const successors = responses.flatMap((response) =>
      response
        .headersArray()
        .filter((header) => header.name.toLowerCase() === "set-cookie")
        .map((header) => header.value.split(";")[0] ?? "")
        .filter((cookie) => cookie.startsWith("refresh_token="))
        .map((cookie) => cookie.slice("refresh_token=".length))
    );
    expect(successors.length).toBe(1);
    expect(Boolean(successors[0]) && successors[0] !== predecessor).toBe(true);

    // The service's unchanged grace window is 10 seconds. Wait beyond it;
    // never advance a fake clock or rewrite persisted rotation timestamps.
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    const reused = await refresh(secondary.origin, predecessor);
    expect(reused.status()).toBe(401);
    expect((await reused.text()).includes("refresh_refused")).toBe(true);
    expect(reused.headersArray().some((h) => h.name.toLowerCase() === "set-cookie")).toBe(false);
    // The winning successor is refused by the other process too: family
    // revocation is persisted and shared, not an in-memory verdict.
    const revoked = await refresh(primary.origin, successors[0] ?? "");
    expect(revoked.status()).toBe(401);
    expect(revoked.headersArray().some((h) => h.name.toLowerCase() === "set-cookie")).toBe(false);
  });

  test("dynamic-ID page: direct navigation, refresh, client navigation, different IDs, back/forward", async ({
    page,
  }) => {
    await login(page, ORG_EMAIL, ORG_PASSWORD);
    // Plan D: /org-admin is the shared overview page; the user list is the
    // shared /org-admin/users page, reached from the overview's Users card.
    await page.getByRole("link", { name: "Open Users" }).click();
    const list = page.getByTestId("user-list");
    await expect(list).toBeVisible();
    const firstLink = list.locator("a").first();
    const href = await firstLink.getAttribute("href");
    expect(href).toMatch(/^\/org-admin\/users\/[0-9a-f-]{36}$/);
    const id = (href ?? "").split("/").pop() ?? "";

    // Client navigation: no document load.
    let documentLoads = 0;
    page.on("load", () => {
      documentLoads += 1;
    });
    await firstLink.click();
    await expect(page.getByTestId("user-detail")).toHaveAttribute("data-id", id);
    await expect(page.getByTestId("user-email")).toHaveText(ORG_EMAIL);
    expect(documentLoads).toBe(0);

    // Refresh: the binary answers the deep path with the shell, the record reloads.
    await page.reload();
    await expect(page.getByTestId("user-detail")).toHaveAttribute("data-id", id);
    await expect(page.getByTestId("user-email")).toHaveText(ORG_EMAIL);

    // Direct navigation to a different, unknown ID: today's not-found panel at 200.
    const res = await page.goto(`/org-admin/users/${RANDOM_UUID}`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()["content-type"]).toContain("text/html");
    await expect(page.getByTestId("user-not-found")).toBeVisible();
    await expect(page.getByTestId("user-detail")).toHaveCount(0);

    // Back/forward: the correct record, never a stale one.
    await page.goBack();
    await expect(page.getByTestId("user-detail")).toHaveAttribute("data-id", id);
    await page.goForward();
    await expect(page.getByTestId("user-not-found")).toBeVisible();
    await expect(page.getByTestId("user-detail")).toHaveCount(0);

    // A non-UUID id is refused client-side before any request.
    await page.goto("/org-admin/users/not-a-uuid");
    await expect(page.getByTestId("user-not-found")).toBeVisible();
  });

  test("protected mutation: authorized success through the boundary, refusals without authority", async ({
    page,
  }) => {
    await login(page);
    await page.getByTestId("nav-account").click();
    await page.getByTestId("profile-name").fill("Site Admin (export proof)");
    await page.getByTestId("profile-form").locator('button[type="submit"]').click();
    await expect(page.getByTestId("profile-outcome")).toHaveText("saved:Site Admin (export proof)");

    // MFA disable on a user with no MFA: the server's refusal, rendered as today.
    await page.locator('input[name="code"]').fill("000000");
    await page.locator('input[name="confirm"]').fill("DISABLE");
    await page.getByTestId("mfa-disable-form").locator('button[type="submit"]').click();
    // The site admin enrolled at first login and site policy requires MFA for
    // admins: the server refuses the disable with 403 mfa_required_by_policy
    // (auth_mfa_disable.go), rendered with today's copy.
    await expect(page.getByTestId("mfa-disable-outcome")).toHaveText(
      "Your organization requires MFA; it cannot be disabled."
    );

    // From page context, the same PUT without the boundary's request header —
    // the cookie IS sent — is refused before it reaches the API.
    const withoutHeader = await page.evaluate(async () => {
      const r = await fetch("/bff/api/v1/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "csrf" }),
      });
      return { status: r.status, body: await r.text() };
    });
    expect(withoutHeader.status).toBe(403);
    expect(withoutHeader.body.includes("csrf_failed")).toBe(true);
    await page.reload();
    await expect(page.getByTestId("who")).toHaveText(EMAIL);
  });

  test("negative: direct API requests carrying only the cookie are refused; Bearer precedence holds", async ({
    page,
    request,
  }) => {
    await login(page);
    const cookies = await cookieNames(page);
    const token = cookies.access_token?.value ?? "";
    expect(token.length).toBeGreaterThan(0);
    const cookieHeader = `access_token=${token}`;

    // Bearer-only resource classes ignore the cookie: no principal, 401.
    const direct = await proofRequest(() =>
      request.get("/api/v1/users", { headers: { Cookie: cookieHeader } })
    );
    expect(direct.status()).toBe(401);
    expect((await direct.text()).includes("no_credential")).toBe(true);

    // The same route with the Bearer the boundary would lift: 200.
    const bearer = await proofRequest(() =>
      request.get("/api/v1/users", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    expect(bearer.status()).toBe(200);

    // Conflicting identities: a bad explicit Bearer beside the good cookie is refused.
    const conflict = await proofRequest(() =>
      request.get("/bff/api/v1/users", {
        headers: { Cookie: cookieHeader, Authorization: "Bearer not-a-token" },
      })
    );
    expect(conflict.status()).toBe(401);

    // validate-and-logout is the one class that reads the cookie: 200 with the cookie alone.
    const validate = await proofRequest(() =>
      request.get("/api/v1/validate", { headers: { Cookie: cookieHeader } })
    );
    expect(validate.status()).toBe(200);

    // CSRF on a proxied mutation, credentials attached, no request header: 403.
    const csrf = await proofRequest(() =>
      request.put("/bff/api/v1/profile", {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: { name: "csrf" },
      })
    );
    expect(csrf.status()).toBe(403);
    // ...and with the header but a foreign Origin: 403.
    const origin = await proofRequest(() =>
      request.put("/bff/api/v1/profile", {
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
          [BFF_HEADER]: BFF_VALUE,
          Origin: "https://evil.example",
        },
        data: { name: "csrf" },
      })
    );
    expect(origin.status()).toBe(403);
    expect((await origin.text()).includes("origin_not_permitted")).toBe(true);

    // Login CSRF: a form-encoded cross-site POST is not a JSON login.
    const formLogin = await proofRequest(() =>
      request.post("/api/v1/auth/login", {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: `email=${encodeURIComponent(EMAIL)}&password=x`,
      })
    );
    expect(formLogin.status()).toBe(400);

    // Permitted destinations and static safety.
    for (const path of ["/bff/health", "/bff/api/setup/status", "/bff/bff/api/v1/users"]) {
      const r = await proofRequest(() => request.get(path, { headers: { Cookie: cookieHeader } }));
      expect(r.status(), path).toBe(404);
      expect((await r.text()).includes("bff_destination_refused"), path).toBe(true);
    }
    // Dot-segment traversal is NOT probed from here: Playwright's request
    // client normalises `/%2e%2e/etc/passwd` to `/etc/passwd` before sending,
    // so the binary never sees the traversal. It is proved by the Go unit test
    // (TestUI_StaticRefusesTraversalDotfilesAndUnsafeMethods) and by
    // `curl --path-as-is`, both of which deliver the raw path.
    for (const path of ["/api/v1/does-not-exist", "/assets/does-not-exist.js", "/.hidden"]) {
      const r = await proofRequest(() => request.get(path));
      expect(r.status(), path).toBe(404);
      expect((await r.text()).includes("<html"), path).toBe(false);
    }
    const shell = await proofRequest(() => request.get("/org-admin/users/anything"));
    expect(shell.status()).toBe(200);
    expect(shell.headers()["cache-control"]).toBe("no-store");
    expect(shell.headers()["x-frame-options"]).toBe("DENY");
  });

  test("logout: revocation, cookie clearing, and the old token is dead afterwards", async ({
    page,
    request,
  }) => {
    await login(page);
    const before = await cookieNames(page);
    const oldToken = before.access_token?.value ?? "";
    expect(oldToken.length).toBeGreaterThan(0);

    await page.getByTestId("sign-out").click();
    await expect(page.getByTestId("login-reason")).toHaveText("You have been signed out.");
    const after = await cookieNames(page);
    expect(after.access_token === undefined).toBe(true);
    expect(after.refresh_token === undefined).toBe(true);

    // Revoked server-side: the old token no longer opens a bearer-only route,
    // and no longer validates.
    const reuse = await proofRequest(() =>
      request.get("/api/v1/users", {
        headers: { Authorization: `Bearer ${oldToken}` },
      })
    );
    expect(reuse.status()).toBe(401);
    const revalidate = await proofRequest(() =>
      request.get("/api/v1/validate", {
        headers: { Cookie: `access_token=${oldToken}` },
      })
    );
    expect(revalidate.status()).toBe(401);

    // A guarded page after logout leaves for /login with the expiry reason.
    await page.goto("/site-admin");
    await expect(page.getByTestId("login-reason")).toHaveText(
      "Your session has expired. Sign in again."
    );
  });

  // LAST, and once per run: every wrong password counts toward the account
  // lockout (five inside fifteen minutes), so this probe follows the logins
  // that need the account open.
  test("login: wrong credentials are refused and set no cookie", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill("definitely-not-the-password");
    await page.locator('button[type="submit"]').click();
    await expect
      .poll(
        async () => (await page.getByTestId("login-error").textContent()) === "Invalid credentials."
      )
      .toBe(true);
    const cookies = await cookieNames(page);
    expect(cookies.access_token === undefined).toBe(true);
    expect(cookies.refresh_token === undefined).toBe(true);
  });
});

// ----------------------------------------------------------------- outage

async function contextWithState(browser: Browser) {
  if (!outageState) throw new Error("outage proof has no in-memory authenticated fixture");
  return browser.newContext({ storageState: outageState });
}

test.describe("appliance with its store paused", () => {
  test.skip(PHASE !== "ready", "runs after ready proofs in the same process");
  test.skip(FIXTURE_CONTAINER === "", "no disposable fixture container was supplied");

  test.beforeAll(async ({ browser }) => {
    // Inspect only the label, never the container's credential-bearing config.
    const label = execFileSync(
      "docker",
      [
        "inspect",
        "--format",
        '{{index .Config.Labels "identuum.ui-export-proof"}}',
        FIXTURE_CONTAINER,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (label !== "disposable")
      throw new Error("outage injection requires a labelled disposable fixture");
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    outageState = await context.storageState();
    await context.close();
    execFileSync("docker", ["pause", FIXTURE_CONTAINER], { stdio: "ignore" });
    storePaused = true;
  });

  test.afterAll(() => {
    if (storePaused) {
      execFileSync("docker", ["unpause", FIXTURE_CONTAINER], { stdio: "ignore" });
      storePaused = false;
    }
  });

  test("unavailable: a guarded page renders in place, keeps the cookie, and never redirects to /login", async ({
    browser,
  }) => {
    const context = await contextWithState(browser);
    const page = await context.newPage();
    const before = (await context.cookies()).find((c) => c.name === "access_token");
    expect(before).toBeDefined();
    await page.goto("/site-admin");
    await expect(page.getByTestId("unavailable")).toBeVisible({ timeout: 30_000 });
    // Either the store-unavailable 503 or, when the blocked store outlives the
    // browser's per-attempt budget, a network timeout: both are the
    // UNAVAILABLE arm. Neither is ever read as expiry.
    const status = (await page.getByTestId("unavailable-status").textContent()) ?? "";
    expect(status === "network" || Number(status) >= 500, `status=${status}`).toBe(true);
    expect(Number(await page.getByTestId("unavailable-attempts").textContent())).toBeGreaterThan(0);
    expect(new URL(page.url()).pathname).toBe("/site-admin");
    await expect(page.getByTestId("login")).toHaveCount(0);
    const after = (await context.cookies()).find((c) => c.name === "access_token");
    expect(after?.value === before?.value).toBe(true);
    await context.close();
  });

  test("setup-state: the root reports the provider unavailable, not setup-required", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("platform-status")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("setup-required")).toHaveCount(0);
  });

  test("logout during the outage is local-only and says so", async ({ browser }) => {
    const context = await contextWithState(browser);
    const page = await context.newPage();
    await page.goto("/login");
    // Sign out through the boundary directly: the page is not signed in
    // enough to render the shell (validation is unavailable), so the call
    // is made the way the shell would make it.
    const result = await page.evaluate(
      async ([header, value, path]) => {
        const r = await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: { [header]: value },
        });
        return { status: r.status, body: await r.text() };
      },
      [BFF_HEADER, BFF_VALUE, "/bff/session/logout"] as const
    );
    expect(result.status).toBe(200);
    expect(result.body.includes('"logout":"local_only"')).toBe(true);
    const after = (await context.cookies()).find((c) => c.name === "access_token");
    expect(after === undefined).toBe(true);
    await context.close();
  });
});
