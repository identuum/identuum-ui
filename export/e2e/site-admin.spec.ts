import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { login } from "./export-login";

/**
 * PLAN-D-3 (THE-UI-IN-THE-BINARY): the site-admin area — the SAME page
 * modules the Next deployment renders — served by the OSS binary as the static
 * export. Per page: its read, one mutation where the page has one that the
 * binary serves, and one refusal (an org_admin is sent to its own area).
 *
 * The organization mutations run on one organization this spec creates through
 * the shared "new" page, taken through its whole lifecycle: edit, re-issue its
 * administrator's activation, reactivate, deactivate, delete, restore. The
 * activation token the re-issue shows is never read into the test.
 *
 * Read-only pages: audit, anomaly, keys, license (probe), reports, system,
 * runtime info, admin sessions, audit chain and the three AG org-link pages
 * have no mutation the binary can serve (see
 * export/__tests__/site-admin-license-reports-org-link.test.tsx).
 *
 * Fixtures (ready phase only): the site administrator and tenant A's
 * org_admin, whose passwords arrive in the environment.
 */

const PHASE = process.env.IDENTUUM_E2E_EXPORT_PHASE ?? "ready";
const BASE = process.env.IDENTUUM_E2E_EXPORT_BASE_URL ?? "http://localhost:7113";
const A_EMAIL = process.env.IDENTUUM_E2E_EXPORT_TENANT_A_EMAIL ?? "";
const A_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_TENANT_A_PASSWORD ?? "";
const SA_EMAIL = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_EMAIL ?? "site_admin@system.local";
const SA_PASSWORD = process.env.IDENTUUM_E2E_EXPORT_SITE_ADMIN_PASSWORD ?? "";

const run = randomBytes(3).toString("hex");
const ORG_NAME = `SA proof ${run}`;
const ORG_DOMAIN = `sa-proof-${run}.test`;
const ORG_RENAMED = `SA proof renamed ${run}`;
const ORG_DETAIL = /^\/site-admin\/organizations\/[0-9a-f-]{36}$/;

test.describe.configure({ mode: "serial" });

test.describe("site-admin area in the binary", () => {
  test.skip(PHASE !== "ready", "runs only against a bootstrapped appliance");
  test.skip(
    !A_PASSWORD || !SA_PASSWORD,
    "the site administrator and tenant A's org_admin fixtures are not configured"
  );

  let sa: Page; // the site administrator
  let a: Page; // tenant A's org_admin: the wrong role for every site-admin page
  let org = ""; // the organization this spec creates, /site-admin/organizations/<id>

  async function refusedByRole(path: string): Promise<void> {
    await a.goto(path);
    await expect(a).toHaveURL(`${BASE}/org-admin`);
    await expect(a.locator('a[href="/site-admin/organizations"]')).toHaveCount(0);
  }

  async function heading(page: Page, text: string): Promise<void> {
    await expect(page.locator("main h1").filter({ hasText: text }).first()).toBeVisible();
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    sa = await (await browser.newContext({ baseURL: BASE })).newPage();
    await login(sa, SA_EMAIL, SA_PASSWORD);
    await expect(sa).toHaveURL(`${BASE}/site-admin`);
    a = await (await browser.newContext({ baseURL: BASE })).newPage();
    await login(a, A_EMAIL, A_PASSWORD);
  });

  test("organizations/new: create; refusal for another role", async () => {
    await sa.goto("/site-admin/organizations/new");
    await sa.locator('input[name="name"]').fill(ORG_NAME);
    await sa.locator('input[name="domain"]').fill(ORG_DOMAIN);
    await sa.locator('input[name="admin_email"]').fill(`admin@${ORG_DOMAIN}`);
    await sa.locator('main button[type="submit"]').click();
    await expect(sa.getByText("Organization created")).toBeVisible();
    await refusedByRole("/site-admin/organizations/new");
  });

  test("organizations list: read; refusal for another role", async () => {
    // A new organization stays inactive until its administrator activates it,
    // and the list's default filter (state=current) shows active ones only.
    await sa.goto("/site-admin/organizations?state=all");
    await heading(sa, "Organizations");
    const link = sa
      .locator("main li, main tr")
      .filter({ hasText: ORG_NAME })
      .locator('a[href^="/site-admin/organizations/"]')
      .first();
    await expect(link).toBeVisible();
    org = (await link.getAttribute("href")) ?? "";
    expect(org).toMatch(ORG_DETAIL);
    await refusedByRole("/site-admin/organizations");
  });

  test("organization detail: read; refusal for another role", async () => {
    await sa.goto(org);
    await expect(sa.getByText(ORG_NAME).first()).toBeVisible();
    await expect(sa.getByText(ORG_DOMAIN).first()).toBeVisible();
    await refusedByRole(org);
  });

  test("edit: rename; refusal for another role", async () => {
    await sa.goto(`${org}/edit`);
    await sa.locator('input[name="name"]').fill(ORG_RENAMED);
    await sa.locator('main button[type="submit"]').click();
    await expect(sa).toHaveURL(`${BASE}${org}`);
    await expect(sa.getByText(ORG_RENAMED).first()).toBeVisible();
    await refusedByRole(`${org}/edit`);
  });

  test("assign-admin: re-issue the pending administrator's activation; refusal for another role", async () => {
    await sa.goto(`${org}/assign-admin`);
    await sa.locator('main button[type="submit"]').click();
    await expect(sa.getByText("Activation token re-issued")).toBeVisible();
    await refusedByRole(`${org}/assign-admin`);
  });

  test("reactivate: activate the new organization; refusal for another role", async () => {
    await sa.goto(`${org}/reactivate`);
    await sa.locator('main button[type="submit"]').click();
    await expect(sa).toHaveURL(`${BASE}/site-admin/organizations`);
    await sa.goto(`${org}/reactivate`);
    await expect(sa.getByText("Already active", { exact: true })).toBeVisible();
    await refusedByRole(`${org}/reactivate`);
  });

  test("deactivate: confirm and deactivate; refusal for another role", async () => {
    await sa.goto(`${org}/deactivate`);
    await sa.locator('input[name="confirmed"]').check();
    await sa.locator('main button[type="submit"]').click();
    await expect(sa).toHaveURL(`${BASE}/site-admin/organizations`);
    await sa.goto(`${org}/deactivate`);
    await expect(sa.getByText("Already inactive", { exact: true })).toBeVisible();
    await refusedByRole(`${org}/deactivate`);
  });

  test("delete: confirm and delete; refusal for another role", async () => {
    await sa.goto(`${org}/delete`);
    await sa.locator('input[name="confirmed"]').check();
    await sa.locator('main button[type="submit"]').click();
    await expect(sa).toHaveURL(`${BASE}/site-admin/organizations?deleted=true`);
    await expect(sa.getByText(ORG_RENAMED).first()).toBeVisible();
    await refusedByRole(`${org}/delete`);
  });

  // BLOCKED on the Go binary (listed, not converted into a pass): the restore
  // page reads the organization by id, and OSS answers GET
  // /api/v1/organizations/:id with 404 for a soft-deleted organization
  // (HandleGetOrganization: `o.DeletedAt != nil` → not found), so the page —
  // in Next and in the export alike — shows "Organization not found" and no
  // restore form. The restore action itself (POST .../restore) is proven
  // through /bff in site-admin-organizations.test.tsx.
  test("restore: a deleted organization reads as not found (blocked); refusal for another role", async () => {
    await sa.goto(`${org}/restore`);
    await expect(sa.getByText("Organization not found").first()).toBeVisible();
    await expect(sa.locator('main button[type="submit"]')).toHaveCount(0);
    await refusedByRole(`${org}/restore`);
  });

  for (const [path, title, readProof] of [
    ["/site-admin/audit", "Audit log", "organization.created"],
    ["/site-admin/anomaly", "Anomaly", "Anomaly statistics require Enterprise/CE"],
    ["/site-admin/keys", "Signing keys", "EdDSA"],
    ["/site-admin/license", "License", ""],
    ["/site-admin/reports", "Reports", "Reports require Enterprise/CE"],
    ["/site-admin/system", "System", ""],
    ["/site-admin/system/info", "Runtime info", "identuum-idp-oss"],
    ["/site-admin/system/sessions", "Admin sessions", "Admin sessions require Enterprise/CE"],
    [
      "/site-admin/system/audit-chain",
      "Audit chain verify",
      "Audit chain verification requires Enterprise/CE",
    ],
    ["/site-admin/org-link", "Organization Link", ""],
    ["/site-admin/org-link/readiness", "Organization linking", ""],
    ["/site-admin/org-link/ag-plan", "AG Org-Link Plan", ""],
  ] as const) {
    test(`${path}: read; refusal for another role`, async () => {
      await sa.goto(path);
      await heading(sa, title);
      if (readProof) await expect(sa.getByText(readProof).first()).toBeVisible();
      await expect(sa.getByTestId("route-error")).toHaveCount(0);
      await refusedByRole(path);
    });
  }
});
