import { expect, test } from "@playwright/test";
import recorded from "../__tests__/fixtures/oss-org-admin-answers.json";
import { login, orgAdminAccount } from "./export-login";
import { proofRequest } from "./proof-privacy";

const PATH = "/org-admin/identity-provider";

test("org admin follows Settings to the provider page in the binary", async ({ page }) => {
  const account = orgAdminAccount();
  test.skip(!account, "requires the disposable export org-admin fixture");
  if (!account) return;
  await login(page, account.email, account.password);
  await page.goto("/org-admin/settings");
  await page.getByRole("link", { name: "Configure the sign-in provider →" }).click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await expect(page.getByRole("heading", { name: "Sign-in provider", exact: true })).toBeVisible();
  await expect(page.getByTestId("not-found")).toHaveCount(0);
  expect((await page.getByLabel("Client secret", { exact: true }).inputValue()) === "").toBe(true);
});

// UI-only browser proof, using the existing export config and recorded OSS
// read answers. Writes are a fake boundary: this proves the shared actions
// and revalidation wiring, not backend discovery or persistence.
test("export provider create, reload, update and delete through the boundary", async ({ page }) => {
  let signedIn = false;
  let provider: Record<string, unknown> | null = null;
  const writes: string[] = [];
  const org = recorded.answers["GET /api/v1/organizations/current"].json.id;
  const providerPath = `/api/v1/organizations/${org}/identity-provider`;
  await page.route("**/bff/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(4);
    const method = request.method();
    let status = 200;
    let json: unknown = {};
    if (path === "/api/v1/validate") {
      status = signedIn ? 200 : 401;
      json = signedIn ? recorded.answers["GET /api/v1/validate"].json : {};
    } else if (path === "/api/v1/auth/organization-lookup") {
      json = { error: "organization_not_found" };
    } else if (path === "/api/v1/auth/login") {
      signedIn = true;
      json = { success: true, role: "org_admin" };
    } else if (path === providerPath) {
      if (method !== "GET") {
        expect(request.headers()["x-requested-with"]).toBe("identuum-ui");
        writes.push(method);
      }
      if (method === "POST" || method === "PUT") {
        const body = request.postDataJSON();
        // Never retain the submitted secret in the mock response/state.
        const { client_secret: _writeOnly, ...config } = body.config;
        provider = { id: "01990000-0000-7000-8000-000000000010", active: true, ...body, config };
      } else if (method === "DELETE") {
        provider = null;
      }
      status = method === "GET" && !provider ? 404 : 200;
      json = { identity_provider: provider };
      expect(JSON.stringify(json).includes("client_secret")).toBe(false);
    } else {
      const answers = recorded.answers as Record<string, { status: number; json: unknown }>;
      const answer = answers[`${method} ${path}`];
      status = answer?.status ?? 404;
      json = answer?.json ?? {};
    }
    await route.fulfill({ status, json });
  });
  await page.route("**/api/v1/component", (route) =>
    route.fulfill({
      json: {
        component: "identuum-idp",
        product: "identuum-idp-oss",
        status: "ok",
        capability_map_schema_version: "idp-capabilities.v1",
        capabilities: { identity_provider: true },
        license: { status: "valid", license_type: "oss", tier: "starter" },
      },
    })
  );
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({ json: { state: "setup_complete" } })
  );

  await login(page, "admin@capture.test", "disposable-browser-fixture");
  await page.goto("/org-admin/settings");
  await page.getByRole("link", { name: "Configure the sign-in provider →" }).click();
  await expect(page.getByRole("heading", { name: "Sign-in provider", exact: true })).toBeVisible();
  await expect(page.getByTestId("not-found")).toHaveCount(0);
  await expect(page).toHaveTitle("Sign-in provider — Identuum Org Admin");
  const secret = page.getByLabel("Client secret", { exact: true });
  expect((await secret.inputValue()) === "").toBe(true);
  await page.getByLabel("Name", { exact: true }).fill("Browser provider");
  await page.getByLabel("Short identifier").fill("browser-provider");
  await page.getByLabel("Issuer URL", { exact: true }).fill("https://issuer.example.test");
  await page.getByLabel("Client ID", { exact: true }).fill("browser-client");
  await proofRequest(() => secret.fill("disposable-provider-fixture"));
  await page.getByLabel("Email domains").fill("capture.test");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.getByTestId("provider-callback")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Browser provider");
  expect((await secret.inputValue()) === "").toBe(true);
  await page.getByLabel("Name", { exact: true }).fill("Updated provider");
  const updated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/bff${providerPath}` &&
      response.request().method() === "PUT"
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await updated;
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Updated provider");
  expect((await secret.inputValue()) === "").toBe(true);
  await page.getByRole("button", { name: "Remove provider…", exact: true }).click();
  await page.getByRole("button", { name: "Remove provider", exact: true }).click();
  // The form replaces itself with the removal notice; the create form returns
  // on reload (provider-form.tsx's "deleted" phase).
  await expect(page.getByText("Provider removed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Save provider", exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  expect((await secret.inputValue()) === "").toBe(true);
  expect(writes).toEqual(["POST", "PUT", "DELETE"]);
});
