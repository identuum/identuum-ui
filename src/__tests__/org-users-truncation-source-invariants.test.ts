/**
 * org-users-truncation-source-invariants.test.ts — ORG-USERS-TRUNCATION-1
 *
 * Measured 2026-08-26 (THE-INERT-USER-LIST): listOrgUsers fetched
 * `/api/v1/users?limit=200&sort=created_at&order=asc` — all three params
 * INERT (the backend reads only page/page_size, caps page_size at 200, and
 * hardcodes created_at-descending sort). page_size therefore defaulted to
 * 50, and the org-admin users page silently showed at most 50 users with
 * no pagination and no notice. The client also dropped the backend's
 * `total`, so the page could not even know it had truncated.
 *
 * These pins hold three things:
 *   1. The client speaks the real wire contract: page/page_size (the
 *      backend's cap is 200), and never the inert limit/sort/order.
 *   2. The client carries the backend's `total` to the caller.
 *   3. TRUNCATION IS VISIBLE: when total exceeds the rows held, the users
 *      page says so — a partial list is never rendered as complete.
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

describe("org users list — wire contract and visible truncation", () => {
  it("listOrgUsers speaks page/page_size and never the inert limit/sort/order [ORG-USERS-TRUNCATION-1]", () => {
    const fn = clientChunk();
    expect(fn, "the backend paginates 1-based page/page_size").toMatch(/params\.set\("page",/);
    expect(fn).toMatch(/params\.set\("page_size",\s*"200"\)/);
    expect(fn, "limit is inert on /api/v1/users").not.toMatch(/[?&]limit=/);
    expect(fn, "sort is inert — the backend hardcodes created_at desc").not.toMatch(/[?&]sort=/);
    expect(fn, "order is inert").not.toMatch(/[?&]order=/);
  });

  it("listOrgUsers carries the backend's total to the caller", () => {
    expect(
      clientChunk(),
      "without total the page cannot know it truncated"
    ).toMatch(/total:\s*Number\(data\.total/);
  });

  it("the users page makes truncation VISIBLE when total exceeds the rows held", () => {
    const page = src("app/org-admin/users/page.tsx");
    expect(
      page,
      "the page must derive a truncation flag from total vs rows held"
    ).toMatch(/totalUsers\s*>\s*users\.length/);
    expect(
      page,
      "the truncation notice must state the partial window to the operator"
    ).toMatch(/Showing the first \{users\?\.length\} of \{totalUsers\} users/);
  });
});
