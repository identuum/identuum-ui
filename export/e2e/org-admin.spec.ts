import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { login } from "./export-login";
import { proofRequest } from "./proof-privacy";

/**
 * PLAN-D-2 (THE-UI-IN-THE-BINARY): the org-admin area — the SAME page modules
 * the Next deployment renders — served by the OSS binary as the static export.
 * Per page: its read, one mutation where the page has one, and one refusal
 * (another role, or another tenant's record).
 *
 * Fixtures (ready phase only): two tenants, each with an activated org_admin,
 * and the site administrator, whose passwords arrive in the environment. The
 * site administrator is the wrong role for every org-admin page. Everything
 * else — tenant B's records and tenant A's two further members (records only:
 * OSS refuses sign-in until an email is verified) — is created here, held in
 * memory, and never printed.
 */

const PHASE = process.env.IDENTUUM_E2E_EXPORT_PHASE ?? "ready";
const BASE = process.env.IDENTUUM_E2E_EXPORT_BASE_URL ?? "http://localhost:7113";
const A_EMAIL = process.env.IDENTUUM_E2E_EXPORT_TENANT_A_EMAIL ?? "";
const A_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_TENANT_A_PASSWORD ?? "";
const B_EMAIL = process.env.IDENTUUM_E2E_EXPORT_TENANT_B_EMAIL ?? "";
const B_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_TENANT_B_PASSWORD ?? "";
const SA_EMAIL = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_EMAIL ?? "site_admin@system.local";
const SA_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_PASSWORD ?? "";

const run = randomBytes(3).toString("hex");
const A_DOMAIN = A_EMAIL.split("@")[1] ?? "invalid.test";
// Two members: one disabled from the list, one from its detail page. OSS
// cannot re-enable a disabled user (its by-id read skips banned users), so a
// member is disabled once and not restored.
const LIST_MEMBER = `list-member-${run}@${A_DOMAIN}`;
const DETAIL_MEMBER = `detail-member-${run}@${A_DOMAIN}`;
const MEMBER_PASSWORD = `Mb-${randomBytes(12).toString("hex")}-Cc3!`;
const DETAIL = (area: string) => new RegExp(`^/org-admin/${area}/[0-9a-f-]{36}$`);

test.describe.configure({ mode: "serial" });

test.describe("org-admin area in the binary", () => {
  test.skip(PHASE !== "ready", "runs only against a bootstrapped appliance");
  test.skip(
    !A_PASSWORD || !B_PASSWORD || !SA_PASSWORD,
    "the two tenant org_admin fixtures and the site administrator are not configured"
  );

  let a: Page; // tenant A's org_admin
  let siteAdmin: Page; // the wrong role for every org-admin page
  const tenantB: { admin?: string; app?: string; api?: string; sa?: string } = {};
  const mine: { app?: string; api?: string; sa?: string } = {};

  async function hrefOf(page: Page, area: string, text: string): Promise<string> {
    // The record's list item or table row, then its detail link (whose own
    // text may be "View details →" rather than the record's name).
    const link = page
      .locator("main li, main tr")
      .filter({ hasText: text })
      .locator(`a[href^="/org-admin/${area}/"]`)
      .first();
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href")) ?? "";
    expect(href).toMatch(DETAIL(area));
    return href;
  }

  async function refusedByRole(path: string): Promise<void> {
    await siteAdmin.goto(path);
    await expect(siteAdmin).toHaveURL(`${BASE}/site-admin`);
    await expect(siteAdmin.getByText("Organization administration")).toHaveCount(0);
  }

  async function refusedOtherTenant(path: string, missing: string): Promise<void> {
    await a.goto(path);
    await expect(a.getByText(missing).or(a.getByText("Access denied")).first()).toBeVisible();
    await expect(a).toHaveURL(`${BASE}${path}`);
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const b = await (await browser.newContext({ baseURL: BASE })).newPage();
    await login(b, B_EMAIL, B_PASSWORD);
    // Tenant B's records, created through tenant B's own shared pages.
    await b.goto("/org-admin/applications/new");
    await b.locator('input[name="name"]').fill(`B app ${run}`);
    await b.locator('[name="redirect_uris"]').fill("https://rp-b.example.test/callback");
    await b.locator('main button[type="submit"]').click();
    await expect(b.getByText(`B app ${run} has been created.`)).toBeVisible();
    await b.goto("/org-admin/applications");
    tenantB.app = await hrefOf(b, "applications", `B app ${run}`);
    await b.goto("/org-admin/api-resources/new");
    await b.locator('input[name="name"]').fill(`B api ${run}`);
    await b.locator('input[name="audience"]').fill(`https://api-b-${run}.example.test`);
    await b.locator('main button[type="submit"]').click();
    await expect(b.getByText("API resource created")).toBeVisible();
    await b.goto("/org-admin/api-resources");
    tenantB.api = await hrefOf(b, "api-resources", `B api ${run}`);
    await b.goto("/org-admin/service-accounts/new");
    await b.locator('input[name="name"]').fill(`b-sa-${run}`);
    await b.locator('main button[type="submit"]').click();
    await expect(b.getByText("Service account created")).toBeVisible();
    await b.goto("/org-admin/service-accounts");
    tenantB.sa = await hrefOf(b, "service-accounts", `b-sa-${run}`);
    await b.goto("/org-admin/users");
    tenantB.admin = await hrefOf(b, "users", B_EMAIL);
    await b.context().close();

    a = await (await browser.newContext({ baseURL: BASE })).newPage();
    await login(a, A_EMAIL, A_PASSWORD);
    // Tenant A's two further members, created by tenant A's admin through the
    // boundary (the browser proof header, the HttpOnly cookie lifted by Go).
    // Org_admins, not org_users: the users page offers Disable to any admin
    // that is not the last active one, while a new org_user row may be
    // pending and carry no lifecycle action at all.
    for (const email of [LIST_MEMBER, DETAIL_MEMBER]) {
      const created = await proofRequest(() =>
        a.evaluate(
          async ({ email, password }) => {
            const r = await fetch("/bff/api/v1/users", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json", "X-Requested-With": "identuum-ui" },
              body: JSON.stringify({ email, password, role: "org_admin", name: "Plan D member" }),
            });
            return r.status;
          },
          { email, password: MEMBER_PASSWORD }
        )
      );
      expect(created).toBe(201);
    }
    siteAdmin = await (await browser.newContext({ baseURL: BASE })).newPage();
    await login(siteAdmin, SA_EMAIL, SA_PASSWORD);
    await expect(siteAdmin).toHaveURL(`${BASE}/site-admin`);
  });

  test("overview: read; refusal for another role", async () => {
    await a.goto("/org-admin");
    await expect(a.getByTestId("home")).toHaveText("Overview");
    await expect(a.getByText(A_EMAIL).first()).toBeVisible();
    await refusedByRole("/org-admin");
  });

  test("users list: read; disable a member; refusal for another role", async () => {
    await a.goto("/org-admin/users");
    const row = a.getByTestId("user-list").locator("tr", { hasText: LIST_MEMBER });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: "Active", exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row.getByRole("cell", { name: "Disabled", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Enable" })).toBeVisible();
    await refusedByRole("/org-admin/users");
  });

  test("user detail: read; disable from the detail page; refusal for another tenant's user", async () => {
    await a.goto("/org-admin/users");
    const href = await hrefOf(a, "users", DETAIL_MEMBER);
    await a.goto(href);
    await expect(a.getByTestId("user-detail")).toHaveAttribute(
      "data-id",
      href.split("/").pop() ?? ""
    );
    await expect(a.getByTestId("user-email")).toHaveText(DETAIL_MEMBER);
    const put = a.waitForResponse(
      (r) =>
        r.request().method() === "PUT" && new URL(r.url()).pathname.startsWith("/bff/api/v1/users/")
    );
    await a.getByTestId("user-detail").getByRole("button", { name: "Disable" }).click();
    expect((await put).status()).toBe(200);
    // OSS answers 404 for a disabled user by id (PgxUserRepository.GetByID
    // filters banned = false), so the effect is read where OSS still shows
    // the user: the list.
    await a.goto("/org-admin/users");
    const row = a.getByTestId("user-list").locator("tr", { hasText: DETAIL_MEMBER });
    await expect(row.getByRole("cell", { name: "Disabled", exact: true })).toBeVisible();
    await a.goto(tenantB.admin ?? "");
    await expect(a.getByTestId("user-not-found")).toBeVisible();
    await expect(a.getByTestId("user-detail")).toHaveCount(0);
  });

  test("applications/new: create; refusal for another role", async () => {
    await a.goto("/org-admin/applications/new");
    await a.locator('input[name="name"]').fill(`A app ${run}`);
    await a.locator('[name="redirect_uris"]').fill("https://rp-a.example.test/callback");
    await a.locator('main button[type="submit"]').click();
    await expect(a.getByText(`A app ${run} has been created.`)).toBeVisible();
    await refusedByRole("/org-admin/applications/new");
  });

  test("applications list: read; refusal for another role", async () => {
    await a.goto("/org-admin/applications");
    mine.app = await hrefOf(a, "applications", `A app ${run}`);
    await expect(a.getByText(`B app ${run}`)).toHaveCount(0);
    await refusedByRole("/org-admin/applications");
  });

  test("application detail: read; refusal for another tenant's application", async () => {
    await a.goto(mine.app ?? "");
    await expect(a.getByRole("heading", { level: 1 })).toHaveText(`A app ${run}`);
    await refusedOtherTenant(tenantB.app ?? "", "Application not found");
    await expect(a.getByText(`B app ${run}`)).toHaveCount(0);
  });

  test("application edit: rename; refusal for another tenant's application", async () => {
    await a.goto(`${mine.app}/edit`);
    await a.locator('input[name="name"]').fill(`A app ${run} renamed`);
    await a.locator('main button[type="submit"]').click();
    await expect(a.getByText(`A app ${run} renamed has been updated.`)).toBeVisible();
    await refusedOtherTenant(`${tenantB.app}/edit`, "Application not found");
  });

  test("application detail: delete with the typed confirmation", async () => {
    await a.goto(mine.app ?? "");
    await a.getByRole("button", { name: "Delete application" }).click();
    await a.locator('input[name="confirm"]').fill(`A app ${run} renamed`);
    await a.getByRole("button", { name: "Delete application" }).click();
    await expect(a).toHaveURL(/\/org-admin\/applications\?deleted=/);
    await expect(a.locator(`a[href="${mine.app}"]`)).toHaveCount(0);
  });

  test("api-resources/new: create; refusal for another role", async () => {
    await a.goto("/org-admin/api-resources/new");
    await a.locator('input[name="name"]').fill(`A api ${run}`);
    await a.locator('input[name="audience"]').fill(`https://api-a-${run}.example.test`);
    await a.locator('main button[type="submit"]').click();
    await expect(a.getByText("API resource created")).toBeVisible();
    await refusedByRole("/org-admin/api-resources/new");
  });

  test("api-resources list: read; refusal for another role", async () => {
    await a.goto("/org-admin/api-resources");
    mine.api = await hrefOf(a, "api-resources", `A api ${run}`);
    await expect(a.getByText(`B api ${run}`)).toHaveCount(0);
    await refusedByRole("/org-admin/api-resources");
  });

  test("api-resource detail: read; refusal for another tenant's resource", async () => {
    await a.goto(mine.api ?? "");
    await expect(a.getByRole("heading", { level: 1 })).toHaveText(`A api ${run}`);
    await refusedOtherTenant(tenantB.api ?? "", "API resource not found");
    await expect(a.getByText(`B api ${run}`)).toHaveCount(0);
  });

  test("api-resource edit: rename; refusal for another tenant's resource", async () => {
    await a.goto(`${mine.api}/edit`);
    await a.locator('input[name="name"]').fill(`A api ${run} renamed`);
    await a.locator('main button[type="submit"]').click();
    await expect(a.getByText(`A api ${run} renamed`).first()).toBeVisible();
    await expect(a.getByText("Saved changes to")).toBeVisible();
    await refusedOtherTenant(`${tenantB.api}/edit`, "API resource not found");
  });

  test("service-accounts/new: create; refusal for another role", async () => {
    await a.goto("/org-admin/service-accounts/new");
    await a.locator('input[name="name"]').fill(`a-sa-${run}`);
    await a.locator('main button[type="submit"]').click();
    await expect(a.getByText("Service account created")).toBeVisible();
    await refusedByRole("/org-admin/service-accounts/new");
  });

  test("service-accounts list: read; refusal for another role", async () => {
    await a.goto("/org-admin/service-accounts");
    mine.sa = await hrefOf(a, "service-accounts", `a-sa-${run}`);
    await expect(a.getByText(`b-sa-${run}`)).toHaveCount(0);
    await refusedByRole("/org-admin/service-accounts");
  });

  test("service-account detail: read; disable; refusal for another tenant's account", async () => {
    await a.goto(mine.sa ?? "");
    await expect(a.getByRole("heading", { level: 1 })).toHaveText(`a-sa-${run}`);
    await a.getByRole("button", { name: "Disable service account" }).click();
    await a.locator("#disable-confirm").fill("DISABLE");
    await a.getByRole("button", { name: "Disable service account" }).click();
    await expect(a.getByLabel("Service account status: Disabled")).toBeVisible();
    await refusedOtherTenant(tenantB.sa ?? "", "Service account not found");
    await expect(a.getByText(`b-sa-${run}`)).toHaveCount(0);
  });

  test("settings: read; add a domain; refusal for another role", async () => {
    await a.goto("/org-admin/settings");
    await expect(a.getByRole("heading", { level: 1 })).toHaveText("Organization settings");
    const domain = `verify-${run}.${A_EMAIL.split("@")[1]}`;
    await a.locator("#org-admin-add-domain").fill(domain);
    await a.locator("form:has(#org-admin-add-domain) button[type=submit]").click();
    await expect(a.locator("output", { hasText: domain })).toBeVisible();
    await refusedByRole("/org-admin/settings");
  });

  test("audit: read the tenant's own events; refusal for another role", async () => {
    await a.goto("/org-admin/audit");
    await expect(a.getByRole("heading", { level: 1 })).toHaveText("Audit log");
    // Events this spec produced in tenant A, attributed to tenant A's admin.
    const created = a.locator("main tr", { hasText: "client.created" }).first();
    await expect(created).toBeVisible();
    await expect(created.getByRole("cell", { name: A_EMAIL, exact: true })).toBeVisible();
    await expect(
      a.locator("main tr", { hasText: "service_account.disabled" }).first()
    ).toBeVisible();
    await expect(a.getByText(B_EMAIL)).toHaveCount(0);
    await refusedByRole("/org-admin/audit");
  });
});
