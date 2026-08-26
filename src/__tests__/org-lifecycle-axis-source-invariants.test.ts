/**
 * org-lifecycle-axis-source-invariants.test.ts — ORG-LIFECYCLE-AXIS-1
 *
 * The backend's organization list honors two tri-state lifecycle axes:
 * ?active=true|false|all (default true) beside ?deleted=false|true|all
 * (default false), and paginates with page/page_size (1-based) — it IGNORES
 * offset/limit. Measured 2026-08-26 (THE-UI-ACTIVE-AXIS), two client/server
 * mismatches:
 *   M1 listOrganizations never sent ?active=, so a deactivated organization
 *      was invisible in the admin list — unreachable and unrecoverable.
 *   M2 listOrganizations sent offset/limit, which the backend ignores, so
 *      page 2 silently served page 1 (invisible below 51 organizations).
 *
 * These pins hold four things:
 *   1. The client sends the active axis explicitly on every list call.
 *   2. The client paginates with page/page_size and never offset/limit.
 *   3. The list page exposes the four lifecycle states that actually exist
 *      (current / deactivated / deleted / all) and maps DEACTIVATED to
 *      active=false&deleted=false — the state M1 hid.
 *   4. The DELETED view widens the active axis (active=all), so an org that
 *      was deactivated before deletion cannot hide from the deleted list.
 *
 * Source-invariant style (no React render, no network) — matches
 * edition-surface-source-invariants.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveOrganizationActions } from "../app/site-admin/organizations/[id]/operational-status";

const ROOT = resolve(__dirname, "..");
const src = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const client = () => src("lib/idp-admin-client.ts");
const listPage = () => src("app/site-admin/organizations/page.tsx");
const listClient = () => src("app/site-admin/organizations/client.tsx");

describe("organization lifecycle axis — client wire contract", () => {
  it("listOrganizations sends the active axis on every call [ORG-LIFECYCLE-AXIS-1]", () => {
    const fn = client();
    expect(
      fn,
      "listOrganizations must send ?active= (true|false|all) — without it a deactivated org is invisible in the list"
    ).toMatch(/params\.set\("active",/);
    // The option must be the tri-state the backend speaks, not a boolean.
    expect(fn).toMatch(/active\?:\s*"true"\s*\|\s*"false"\s*\|\s*"all"/);
  });

  it("listOrganizations paginates with page/page_size and never offset/limit", () => {
    const fn = client();
    expect(
      fn,
      "the backend reads page/page_size and IGNORES offset/limit — sending offset silently serves page 1"
    ).toMatch(/params\.set\("page",/);
    expect(fn).toMatch(/params\.set\("page_size",/);
    expect(fn, "offset must never reach the wire").not.toMatch(/params\.set\("offset",/);
    expect(fn, "limit must never reach the wire").not.toMatch(/params\.set\("limit",/);
  });
});

describe("organization lifecycle axis — the list page's state filter", () => {
  it("the four lifecycle states exist and DEACTIVATED maps to active=false&deleted=false", () => {
    const page = listPage();
    expect(page, "the list page must map the deactivated state onto the two backend axes").toMatch(
      /deactivated:\s*\{\s*active:\s*"false",\s*deleted:\s*"false"\s*\}/
    );
    expect(page).toMatch(/current:\s*\{\s*active:\s*"true",\s*deleted:\s*"false"\s*\}/);
    expect(page).toMatch(/all:\s*\{\s*active:\s*"all",\s*deleted:\s*"all"\s*\}/);
    // The control surfaces all four states to the operator.
    expect(listClient()).toMatch(/Deactivated/);
  });

  it("the DELETED view widens the active axis so deactivated-then-deleted orgs cannot hide", () => {
    expect(
      listPage(),
      "deleted must query active=all — a row deactivated before deletion would otherwise vanish from the deleted list"
    ).toMatch(/deleted:\s*\{\s*active:\s*"all",\s*deleted:\s*"true"\s*\}/);
  });
});

describe("organization lifecycle axis — recoverability", () => {
  it("a deactivated (inactive, non-deleted) org's detail offers reactivate", () => {
    const actions = deriveOrganizationActions({
      active: false,
      deleted: false,
      has_admin: true,
      can_assign_admin: false,
    });
    expect(
      actions,
      "a deactivated org must be RECOVERABLE from its detail page — reactivate must be offered"
    ).toContain("reactivate");
  });
});
