/**
 * org-users-pagination-source-invariants.test.ts — ORG-USERS-PAGINATION-1
 *
 * THE-THREE-PARKED (2026-08-26), Part A: the org-admin users list pages on
 * the 1-based page/page_size contract the backend already speaks
 * (HandleListUsers reads page and page_size via parsePositiveQuery,
 * page_size cap 200). Before this, the page fetched exactly one 200-row
 * window and users beyond it were UNREACHABLE — an amber notice admitted
 * the truncation but offered no way through it.
 *
 * These pins hold reachability end to end:
 *   1. The client accepts a caller page and sends it on the wire, clamped
 *      to an integer >= 1 — never a hardcoded "1".
 *   2. The page parses ?page= strictly (integer >= 1, else fallback 1) and
 *      passes it to listOrgUsers.
 *   3. Prev/Next controls exist, bind to the derived page count, and
 *      preserve the ?status= filter across page moves.
 *
 * Source-invariant style (no React render, no network).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const src = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const clientChunk = (): string => {
  const full = src("lib/idp-admin-client.ts");
  const start = full.indexOf("export async function listOrgUsers");
  expect(start, "listOrgUsers must exist").toBeGreaterThan(-1);
  const next = full.indexOf("export async function", start + 1);
  return full.slice(start, next === -1 ? full.length : next);
};

describe("org users list — every user reachable by paging", () => {
  it("listOrgUsers sends the caller's 1-based page, not a hardcoded first window [ORG-USERS-PAGINATION-1]", () => {
    const fn = clientChunk();
    expect(fn, "the client must accept a page option").toMatch(/opts\?:\s*\{[\s\S]{0,120}?page\?:\s*number/);
    expect(
      fn,
      "the sent page must be the caller's, clamped to an integer >= 1"
    ).toMatch(/Math\.max\(1,\s*Math\.floor\(opts\?\.page\s*\?\?\s*1\)\)/);
    expect(fn, "the clamped page goes on the wire").toMatch(/params\.set\("page",\s*String\(page\)\)/);
    expect(fn, "a hardcoded first page would sever every later page").not.toMatch(/params\.set\("page",\s*"1"\)/);
  });

  it("the users page parses ?page= strictly and passes it to the client", () => {
    const page = src("app/org-admin/users/page.tsx");
    expect(
      page,
      "?page= must parse to an integer >= 1 with fallback 1 — never NaN into the wire"
    ).toMatch(/!Number\.isFinite\(n\)\s*\|\|\s*!Number\.isInteger\(n\)\s*\|\|\s*n\s*<\s*1/);
    expect(page, "the parsed page must reach the client call").toMatch(/listOrgUsers\(\{\s*page\s*\}\)/);
  });

  it("Prev/Next controls bind to the derived page count and preserve the status filter", () => {
    const page = src("app/org-admin/users/page.tsx");
    expect(page, "Prev exists only above page 1").toMatch(/page\s*>\s*1\s*\?\s*usersPageHref\(page\s*-\s*1,\s*filter\)/);
    expect(
      page,
      "Next exists only below the derived page count"
    ).toMatch(/page\s*<\s*totalPages\s*\?\s*usersPageHref\(page\s*\+\s*1,\s*filter\)/);
    expect(
      page,
      "page moves must not drop an active status filter"
    ).toMatch(/if\s*\(filter\s*!==\s*"all"\)\s*qs\.set\("status",\s*filter\)/);
  });
});
