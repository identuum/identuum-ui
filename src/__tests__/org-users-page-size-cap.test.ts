/**
 * org-users-page-size-cap.test.ts — V3-039 (OSS-0913-PAGESIZE-FIX)
 *
 * The IdP caps a users page at 100 rows (identuum-idp-oss
 * repository.NewPagination). The console asked for 200 and counted pages as
 * ceil(total / 200), so an organization with 101..200 users saw the 100
 * newest and no Next page. The client must ask for no more than the cap, and
 * the page count must come from the page size the server answered with.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

import { listOrgUsers } from "@/lib/idp-admin-client";

afterEach(() => vi.unstubAllGlobals());

const SERVER_CAP = 100;
const TOTAL = 150;
const ALL = Array.from({ length: TOTAL }, (_, i) => ({
  id: `01990000-0000-7000-8000-${String(i).padStart(12, "0")}`,
  email: `user${i}@tenant-a.test`,
  role: i === TOTAL - 1 ? "org_admin" : "org_user",
  banned: false,
}));

// A server that behaves like HandleListUsers: page_size clamped to the cap,
// offset from the clamped size, and the clamped size echoed back.
function cappedServer(): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      seen.push(url.searchParams.get("page_size") ?? "");
      const page = Number(url.searchParams.get("page") ?? "1");
      const size = Math.min(SERVER_CAP, Number(url.searchParams.get("page_size") ?? "50"));
      const users = ALL.slice((page - 1) * size, page * size);
      return new Response(JSON.stringify({ users, total: TOTAL, page, page_size: size }), {
        status: 200,
      });
    })
  );
  return seen;
}

it("150 users at a server cap of 100 make 2 pages and the second page is reachable [V3-039]", async () => {
  const sent = cappedServer();
  const first = await listOrgUsers({ page: 1 });
  expect(first?.users).toHaveLength(SERVER_CAP);
  expect(first?.pageSize, "the page size is the server's answer, not the request").toBe(SERVER_CAP);
  const pages = Math.ceil((first?.total ?? 0) / (first?.pageSize ?? 0));
  expect(pages).toBe(2);

  const second = await listOrgUsers({ page: 2 });
  expect(second?.users).toHaveLength(TOTAL - SERVER_CAP);
  const ids = new Set([...(first?.users ?? []), ...(second?.users ?? [])].map((u) => u.id));
  expect(ids.size, "every user is reachable across the pages").toBe(TOTAL);
  expect(
    [...(second?.users ?? [])].some((u) => u.role === "org_admin"),
    "the early-created admin is on page 2"
  ).toBe(true);

  for (const s of sent) expect(Number(s)).toBeLessThanOrEqual(SERVER_CAP);
});

it("the users page counts pages from the response's page size, not a request constant [V3-039]", () => {
  const page = readFileSync(resolve(__dirname, "../app/org-admin/users/page.tsx"), "utf8");
  expect(page).toMatch(/Math\.ceil\(totalUsers\s*\/\s*listResult\.pageSize\)/);
  expect(page).not.toMatch(/USERS_PAGE_SIZE\s*=\s*200/);
});
