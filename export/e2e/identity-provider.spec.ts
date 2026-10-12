import { expect, type Page, test } from "@playwright/test";
import recorded from "../__tests__/fixtures/oss-org-admin-answers.json";
import { login, orgAdminAccount } from "./export-login";
import { proofRequest } from "./proof-privacy";

const OLD_PATH = "/org-admin/identity-provider";
const SETTINGS = "/org-admin/settings";

// UI-0912-B: the sign-in providers are listed on Settings. The old address
// opens Settings at the card; Add opens its own page.
test("org admin finds the sign-in providers on Settings in the binary", async ({ page }) => {
  const account = orgAdminAccount();
  test.skip(!account, "requires the disposable export org-admin fixture");
  if (!account) return;
  await login(page, account.email, account.password);
  await page.goto(OLD_PATH);
  await expect(page).toHaveURL(new RegExp(`${SETTINGS}#sign-in-providers$`));
  const card = page.locator("#sign-in-providers");
  await expect(card.getByRole("heading", { name: "Sign-in providers", exact: true })).toBeVisible();
  await expect(page.getByTestId("not-found")).toHaveCount(0);
  const add = card.getByRole("link", { name: "Add provider", exact: true });
  if ((await add.count()) === 1) {
    await add.click();
    await expect(
      page.getByRole("heading", { name: "Add sign-in provider", exact: true })
    ).toBeVisible();
    expect((await page.getByLabel("Client secret", { exact: true }).inputValue()) === "").toBe(
      true
    );
  } else {
    await expect(card.getByText("This edition supports one sign-in provider.")).toBeVisible();
  }
});

// deleteStatus: what DELETE answers (UI-0912-AB-FIX F4/F6). 404 means another
// tab removed the provider first; any other refusal leaves it in place.
async function fakeBoundary(page: Page, opts: { deleteStatus?: number } = {}) {
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
        provider = {
          id: "01990000-0000-7000-8000-000000000010",
          type: "oidc",
          active: true,
          updated_at: "2026-10-12T10:00:00Z",
          ...body,
          config,
        };
      } else if (method === "DELETE") {
        if (!opts.deleteStatus || opts.deleteStatus === 404) provider = null;
      }
      status =
        method === "DELETE" && opts.deleteStatus
          ? opts.deleteStatus
          : method === "GET" && !provider
            ? 404
            : 200;
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
  return { writes, providerId: "01990000-0000-7000-8000-000000000010" };
}

// UI-only browser proof, using the existing export config and recorded OSS
// read answers. Writes are a fake boundary: this proves the shared actions,
// the return to Settings and the in-place removal, not backend persistence.
// page.reload() appears only as a persistence control after a step, never as
// a requirement to see its result.
test("providers on Settings: add, edit, remove in place, keyboard only", async ({ page }) => {
  const { writes, providerId } = await fakeBoundary(page);
  await login(page, "admin@capture.test", "disposable-browser-fixture");
  await page.goto(SETTINGS);
  const card = page.locator("#sign-in-providers");
  await expect(card.getByRole("heading", { name: "Sign-in providers", exact: true })).toBeVisible();
  await expect(
    card.getByText("No sign-in provider yet. Members sign in with a password.")
  ).toBeVisible();

  // Add.
  await card.getByRole("link", { name: "Add provider", exact: true }).click();
  await expect(page).toHaveURL(/\/org-admin\/settings\/sign-in-providers\/new$/);
  await expect(
    page.getByRole("heading", { name: "Add sign-in provider", exact: true })
  ).toBeVisible();
  await expect(page).toHaveTitle("Add sign-in provider — Identuum Org Admin");
  const secret = page.getByLabel("Client secret", { exact: true });
  expect((await secret.inputValue()) === "").toBe(true);
  await page.getByLabel("Name", { exact: true }).fill("Browser provider");
  await page.getByLabel("Short identifier").fill("browser-provider");
  await page.getByLabel("Issuer URL", { exact: true }).fill("https://issuer.example.test");
  await page.getByLabel("Client ID", { exact: true }).fill("browser-client");
  await proofRequest(() => secret.fill("disposable-provider-fixture"));
  await page.getByLabel("Email domains").fill("capture.test");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();

  // Back on Settings with the result line and the redirect URI, no reload.
  await expect(page).toHaveURL(/\/org-admin\/settings#sign-in-providers$/);
  await expect(card.getByRole("status")).toHaveText("Provider saved.");
  await expect(card.getByTestId("provider-callback")).toHaveText(
    new RegExp(`/api/v1/auth/idp/${providerId}/callback$`)
  );
  await expect(card.getByText("Browser provider", { exact: true })).toBeVisible();
  // One provider: Add is disabled and the reason is written next to it.
  const disabledAdd = card.getByRole("button", { name: "Add provider", exact: true });
  await expect(disabledAdd).toBeDisabled();
  await expect(disabledAdd).toHaveAccessibleDescription(
    "This edition supports one sign-in provider."
  );
  // Copy.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await card.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(card.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  // Persistence control: the row stays, the line does not repeat.
  await page.reload();
  await expect(card.getByText("Browser provider", { exact: true })).toBeVisible();
  await expect(card.getByText("Provider saved.")).toHaveCount(0);

  // Edit, secret left empty.
  await card.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Browser provider", exact: true })
  ).toBeVisible();
  expect((await secret.inputValue()) === "").toBe(true);
  await page.getByLabel("Name", { exact: true }).fill("Updated provider");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/org-admin\/settings#sign-in-providers$/);
  await expect(card.getByRole("status")).toHaveText("Provider updated.");
  await expect(card.getByText("Updated provider", { exact: true })).toBeVisible();

  // Remove…, keyboard only: Enter opens, focus is on Cancel, Esc cancels and
  // focus returns to Remove…; then Enter, Tab, Enter removes.
  const removeButton = card.getByRole("button", { name: "Remove…", exact: true });
  await removeButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Remove Updated provider?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(removeButton).toBeFocused();
  await expect(card.getByText("Updated provider", { exact: true })).toBeVisible();
  // Cancel by click keeps the row too.
  await removeButton.click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByText("Updated provider", { exact: true })).toBeVisible();
  // Remove.
  await removeButton.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Remove provider", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("status")).toHaveText("Provider removed.");
  await expect(
    card.getByText("No sign-in provider yet. Members sign in with a password.")
  ).toBeVisible();
  await expect(card.getByRole("link", { name: "Add provider", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/org-admin\/settings#sign-in-providers$/);
  await expect(page.getByText(/Reload the page/i)).toHaveCount(0);
  // Persistence control.
  await page.reload();
  await expect(
    card.getByText("No sign-in provider yet. Members sign in with a password.")
  ).toBeVisible();
  expect(writes).toEqual(["POST", "PUT", "DELETE"]);

  // The old address still works.
  await page.goto(OLD_PATH);
  await expect(page).toHaveURL(/\/org-admin\/settings#sign-in-providers$/);
  await expect(card.getByRole("heading", { name: "Sign-in providers", exact: true })).toBeVisible();
});

/** Add one provider through the shared Add page; back on Settings. */
async function addOne(page: Page) {
  await page.goto("/org-admin/settings/sign-in-providers/new");
  await page.getByLabel("Name", { exact: true }).fill("Browser provider");
  await page.getByLabel("Short identifier").fill("browser-provider");
  await page.getByLabel("Issuer URL", { exact: true }).fill("https://issuer.example.test");
  await page.getByLabel("Client ID", { exact: true }).fill("browser-client");
  await proofRequest(() =>
    page.getByLabel("Client secret", { exact: true }).fill("disposable-provider-fixture")
  );
  await page.getByLabel("Email domains").fill("capture.test");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.locator("#sign-in-providers").getByRole("status")).toHaveText(
    "Provider saved."
  );
}

// UI-0912-AB-FIX F6: a failed remove keeps the row, says so, and moves focus to
// that line (it was moved to the empty status line); a retry is reachable.
test("a failed remove moves focus to the line that says so", async ({ page }) => {
  await fakeBoundary(page, { deleteStatus: 500 });
  await login(page, "admin@capture.test", "disposable-browser-fixture");
  await addOne(page);
  const card = page.locator("#sign-in-providers");
  await card.getByRole("button", { name: "Remove…", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  const alert = card.getByRole("alert").filter({ hasText: "The provider was not removed." });
  await expect(alert).toHaveText("The provider was not removed. Try again.");
  await expect(alert).toBeFocused();
  await expect(card.getByText("Browser provider", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Remove…", exact: true })).toBeVisible();
});

// UI-0912-AB-FIX F4: another tab removed the provider first (DELETE 404). The
// removal is what was asked: the row leaves and the card says so.
test("a remove answered 404 (already removed) leaves the list", async ({ page }) => {
  await fakeBoundary(page, { deleteStatus: 404 });
  await login(page, "admin@capture.test", "disposable-browser-fixture");
  await addOne(page);
  const card = page.locator("#sign-in-providers");
  await card.getByRole("button", { name: "Remove…", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove provider", exact: true })
    .click();
  await expect(card.getByRole("status")).toHaveText("Provider removed.");
  await expect(card.getByText("The provider was not removed. Try again.")).toHaveCount(0);
  await expect(
    card.getByText("No sign-in provider yet. Members sign in with a password.")
  ).toBeVisible();
});

// RQ-1 (a), owner 2026-10-12: the console shell keeps a fixed 240 px sidebar,
// so at phone widths the page already scrolls sideways and the content column
// is very narrow (a known issue, queued apart). What this goal proves at
// 390 and 320 px: the providers card adds no sideways scroll, the redirect
// URI wraps, and the card's buttons stay at least 44 px tall.
for (const width of [390, 320]) {
  test(`at ${width} px the providers card adds no sideways scroll`, async ({ page }) => {
    await fakeBoundary(page);
    await login(page, "admin@capture.test", "disposable-browser-fixture");
    await page.goto("/org-admin/settings/sign-in-providers/new");
    await page.getByLabel("Name", { exact: true }).fill("A provider with a rather long name");
    await page
      .getByLabel("Short identifier")
      .fill("a-provider-with-a-rather-long-short-identifier");
    await page.getByLabel("Issuer URL", { exact: true }).fill("https://issuer.example.test");
    await page.getByLabel("Client ID", { exact: true }).fill("browser-client");
    await proofRequest(() =>
      page.getByLabel("Client secret", { exact: true }).fill("disposable-provider-fixture")
    );
    await page.getByLabel("Email domains").fill("capture.test example.org example.net");
    await page.getByRole("button", { name: "Save provider", exact: true }).click();
    const card = page.locator("#sign-in-providers");
    await expect(card.getByRole("status")).toHaveText("Provider saved.");
    await page.setViewportSize({ width, height: 800 });
    const added = await card.evaluate((el) => {
      const main = document.querySelector("main") as HTMLElement;
      const shown = [document.documentElement.scrollWidth, main.scrollWidth];
      (el as HTMLElement).style.display = "none";
      const hidden = [document.documentElement.scrollWidth, main.scrollWidth];
      (el as HTMLElement).style.display = "";
      return shown.map((v, i) => v - (hidden[i] ?? 0));
    });
    expect(added).toEqual([0, 0]);
    // At 320 px the shell leaves the card no content width at all (measured
    // 2026-10-12: card 16 px wide inside 48 px of padding), so nothing can
    // wrap there; the wrap check runs where a column exists.
    if (width === 390) {
      const uri = card.getByTestId("provider-callback");
      expect(await uri.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    }
    for (const [role, name] of [
      ["button", "Copy"],
      ["link", "Edit"],
      ["button", "Remove…"],
    ] as const) {
      const box = await card.getByRole(role, { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
}
