import { expect, type Page, test } from "@playwright/test";
import { loadOrgAdminFixtureOrgDomain } from "../../e2e/helpers/fixture";
import recorded from "../__tests__/fixtures/oss-org-admin-answers.json";
import { login, orgAdminAccount } from "./export-login";
import { proofRequest } from "./proof-privacy";

// UI-0912-A (C3). H1: a tab whose access token died without a reload still
// saves the sign-in provider — identuum-idp-oss answers the dead cookie with
// 401 no_credential (the boundary retries it anonymously), the console renews
// once and the write is sent once. H2: one network failure of the
// organization read is retried once, so the save still succeeds. The live
// test runs against the binary with the run's org_admin (e2e-full); the
// fake-boundary tests run wherever the export is served.

const SETTINGS = "/org-admin/settings";
const ORG_READ = "/bff/api/v1/organizations/current";
const FAILURE_LINES = [
  /The server did not answer\./,
  /Your organization could not be read\./,
  /You do not have permission/,
  /Reload the page/i,
];

/** Counts renewals and provider writes as the browser sends them. */
function watch(page: Page): { renewals: () => number; writes: () => string[] } {
  let renewals = 0;
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/bff/session/refresh" && request.method() === "POST") renewals += 1;
    if (path.endsWith("/identity-provider") && request.method() !== "GET") {
      writes.push(request.method());
    }
  });
  return { renewals: () => renewals, writes: () => writes };
}

async function expectSaved(page: Page, line: string): Promise<void> {
  const card = page.locator("#sign-in-providers");
  await expect(page).toHaveURL(/\/org-admin\/settings#sign-in-providers$/);
  await expect(card.getByRole("status")).toHaveText(line);
  for (const failure of FAILURE_LINES) await expect(page.getByText(failure)).toHaveCount(0);
}

async function fillNew(page: Page, domain: string): Promise<void> {
  await page.getByLabel("Name", { exact: true }).fill("Renewal provider");
  await page.getByLabel("Short identifier").fill("renewal-provider");
  await page.getByLabel("Issuer URL", { exact: true }).fill("https://issuer.example.test");
  await page.getByLabel("Client ID", { exact: true }).fill("renewal-client");
  await proofRequest(() =>
    page.getByLabel("Client secret", { exact: true }).fill("disposable-provider-fixture")
  );
  await page.getByLabel("Email domains").fill(domain);
}

/** Replaces the access cookie with an unusable value; the page is not reloaded. */
async function garbleAccessCookie(page: Page): Promise<void> {
  const access = (await page.context().cookies()).find((c) => c.name === "access_token");
  expect(Boolean(access?.value), "signed in with an access cookie").toBe(true);
  if (!access) return;
  await page.context().addCookies([{ ...access, value: "garbled.access.token" }]);
}

/** Fails the next organization read once at the network level; later reads pass. */
async function abortOrgReadOnce(page: Page): Promise<() => number> {
  let aborted = 0;
  await page.route(`**${ORG_READ}`, async (route) => {
    if (aborted === 0) {
      aborted += 1;
      await route.abort("failed");
    } else {
      await route.fallback();
    }
  });
  return () => aborted;
}

test("live: a dead access cookie and a failed org read still save the provider", async ({
  page,
}) => {
  const account = orgAdminAccount();
  test.skip(!account, "requires the disposable export org-admin fixture");
  if (!account) return;
  const domain = loadOrgAdminFixtureOrgDomain();
  expect(domain, "the run's fixture envelope names the organization's domain").toBeTruthy();
  await login(page, account.email, account.password);
  const seen = watch(page);
  const card = page.locator("#sign-in-providers");

  // H1. The appliance allows one provider: add one when there is none,
  // else edit the one there is. Either way the write follows one renewal.
  await page.goto(SETTINGS);
  await expect(card.getByRole("heading", { name: "Sign-in providers", exact: true })).toBeVisible();
  const added = (await card.getByRole("link", { name: "Add provider", exact: true }).count()) === 1;
  if (added) {
    await card.getByRole("link", { name: "Add provider", exact: true }).click();
    await fillNew(page, domain ?? "");
  } else {
    await card.getByRole("link", { name: "Edit", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Renewal provider");
  }
  await garbleAccessCookie(page);
  await page
    .getByRole("button", { name: added ? "Save provider" : "Save changes", exact: true })
    .click();
  await expectSaved(page, added ? "Provider saved." : "Provider updated.");
  expect(seen.renewals()).toBe(1);
  expect(seen.writes()).toEqual([added ? "POST" : "PUT"]);

  // H2. The provider exists now: edit it with the org read failing once.
  await card.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Renewal provider 2");
  const aborted = await abortOrgReadOnce(page);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expectSaved(page, "Provider updated.");
  expect(aborted()).toBe(1);
  expect(seen.writes()).toEqual([added ? "POST" : "PUT", "PUT"]);
  await page.unroute(`**${ORG_READ}`);

  // Leave the organization as found: remove the provider this test added.
  if (added) {
    await card.getByRole("button", { name: "Remove…", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove provider", exact: true })
      .click();
    await expect(card.getByRole("status")).toHaveText("Provider removed.");
  }
});

// ------------------------------------------------------------ fake boundary

// The measured identuum-idp-oss answers (PREP-UI-A §0.3): a dead access token
// reaches the browser as 401 no_credential on every guarded call until the
// refresh cookie renews it. Writes are faked; this proves the console's
// renewal and retry, not backend persistence.
async function fakeBoundary(page: Page) {
  const state = { dead: false };
  let provider: Record<string, unknown> | null = null;
  const org = recorded.answers["GET /api/v1/organizations/current"].json.id;
  const providerPath = `/api/v1/organizations/${org}/identity-provider`;
  await page.route("**/bff/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(4);
    const method = request.method();
    let status = 200;
    let json: unknown = {};
    if (path === "/session/refresh") {
      state.dead = false;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (state.dead && path.startsWith("/api/v1/")) {
      await route.fulfill({ status: 401, json: { reason: "no_credential" } });
      return;
    }
    if (path === providerPath) {
      if (method === "POST" || method === "PUT") {
        const { client_secret: _writeOnly, ...config } = request.postDataJSON().config;
        provider = {
          id: "01990000-0000-7000-8000-000000000010",
          type: "oidc",
          active: true,
          updated_at: "2026-10-12T10:00:00Z",
          ...request.postDataJSON(),
          config,
        };
      }
      status = method === "GET" && !provider ? 404 : method === "POST" ? 201 : 200;
      json = { identity_provider: provider };
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
  return state;
}

test("H1: the access token died in an open tab; one renewal, one write", async ({ page }) => {
  const state = await fakeBoundary(page);
  const seen = watch(page);
  await page.goto("/org-admin/settings/sign-in-providers/new");
  await expect(
    page.getByRole("heading", { name: "Add sign-in provider", exact: true })
  ).toBeVisible();
  await fillNew(page, "capture.test");
  expect(seen.renewals()).toBe(0);
  state.dead = true;
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expectSaved(page, "Provider saved.");
  expect(seen.renewals()).toBe(1);
  expect(seen.writes()).toEqual(["POST"]);
});

test("H2: one failed organization read is retried; the save succeeds", async ({ page }) => {
  await fakeBoundary(page);
  const seen = watch(page);
  await page.goto("/org-admin/settings/sign-in-providers/new");
  await expect(
    page.getByRole("heading", { name: "Add sign-in provider", exact: true })
  ).toBeVisible();
  await fillNew(page, "capture.test");
  const aborted = await abortOrgReadOnce(page);
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expectSaved(page, "Provider saved.");
  expect(aborted()).toBe(1);
  expect(seen.renewals()).toBe(0);
  expect(seen.writes()).toEqual(["POST"]);
});
