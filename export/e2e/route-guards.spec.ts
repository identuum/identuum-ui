import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Browser component proofs over the real export bundle. The controlled API
// responses exercise legacy sessions and refusals; they are not backend proofs.
let server: Server;
let baseURL = "";
const out = path.resolve(__dirname, "../../out");
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://fixture.test").pathname;
    const file = pathname.startsWith("/assets/")
      ? path.join(out, pathname)
      : path.join(out, "index.html");
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : "text/html");
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
  baseURL = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

for (const scenario of [
  {
    name: "ordinary user cannot render site administration",
    role: "org_user",
    mfa: true,
    start: "/site-admin",
    end: "/dashboard",
  },
  {
    name: "site administrator cannot render tenant administration",
    role: "site_admin",
    mfa: true,
    start: "/org-admin/users/01990000-0000-7000-8000-000000000002",
    end: "/site-admin",
  },
  {
    name: "legacy administrator without MFA cannot render tenant administration",
    role: "org_admin",
    mfa: false,
    start: "/org-admin",
    end: "/account/settings?reason=mfa_required",
  },
]) {
  test(scenario.name, async ({ page }) => {
    await page.route("**/bff/api/v1/**", async (route) => {
      const validate = new URL(route.request().url()).pathname.endsWith("/validate");
      await route.fulfill({
        status: validate ? 200 : 403,
        json: validate
          ? {
              role: scenario.role,
              user: {
                id: "01990000-0000-7000-8000-000000000001",
                email: "fixture@example.test",
                role: scenario.role,
                mfa_enabled: scenario.mfa,
              },
            }
          : {},
      });
    });
    await page.goto(baseURL + scenario.start);
    await expect(page).toHaveURL(baseURL + scenario.end);
    await expect(page.getByTestId("user-detail")).toHaveCount(0);
  });
}

test("a user-detail outage after successful validation is not a missing-user verdict", async ({
  page,
}) => {
  await page.route("**/bff/api/v1/**", async (route) => {
    const validate = new URL(route.request().url()).pathname.endsWith("/validate");
    await route.fulfill({
      status: validate ? 200 : 503,
      json: validate
        ? {
            role: "org_admin",
            user: {
              id: "01990000-0000-7000-8000-000000000001",
              email: "fixture@example.test",
              role: "org_admin",
              mfa_enabled: true,
            },
          }
        : {},
    });
  });
  const target = `${baseURL}/org-admin/users/01990000-0000-7000-8000-000000000002`;
  await page.goto(target);
  await expect(page.getByTestId("user-unavailable")).toBeVisible();
  await expect(page.getByTestId("user-not-found")).toHaveCount(0);
  await expect(page).toHaveURL(target);
});

test("a user-list outage is not an empty list", async ({ page }) => {
  await page.route("**/bff/api/v1/**", async (route) => {
    const validate = new URL(route.request().url()).pathname.endsWith("/validate");
    await route.fulfill({
      status: validate ? 200 : 503,
      json: validate
        ? {
            role: "org_admin",
            user: {
              id: "fixture",
              email: "fixture@example.test",
              role: "org_admin",
              mfa_enabled: true,
            },
          }
        : {},
    });
  });
  // Plan D: the user list is the shared /org-admin/users page.
  await page.goto(`${baseURL}/org-admin/users`);
  await expect(page.getByTestId("users-unavailable")).toBeVisible();
  await expect(page.getByTestId("user-list")).toHaveCount(0);
});

test("login transport failure is reported without an unhandled rejection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await page.route("**/bff/api/v1/auth/login", (route) => route.abort("failed"));
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email or domain").fill("fixture@example.test");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill("test-fixture-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  // The shared password form's copy for a request that got no answer.
  await expect(page.getByTestId("login-error")).toHaveText("Login failed. Try again.");
  expect(errors).toEqual([]);
});
