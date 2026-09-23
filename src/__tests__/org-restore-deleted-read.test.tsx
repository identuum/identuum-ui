import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

import RestoreOrganizationPage from "@/app/site-admin/organizations/[id]/restore/page";
import { listOrganizations } from "@/lib/idp-admin-client";

afterEach(() => vi.unstubAllGlobals());

// OSS answers GET /api/v1/organizations/:id with 404 for a soft-deleted
// organization BY CONTRACT (RULE-FLOOR ORG-RESTORE-1: "404s on read yet
// remains restorable"), and it marks a deleted row with `deleted_at`, never a
// `deleted` boolean (safeOrganization, identuum-idp-oss
// internal/handlers/organizations.go). The restore page must therefore find
// a deleted organization among the list's deleted rows.

const ID = "01990000-0000-7000-8000-0000000000d1";
const org = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Org ${id.slice(-2)}`,
  domain: `org-${id.slice(-2)}.test`,
  org_slug: `org-${id.slice(-2)}`,
  active: false,
  created_at: "2026-09-24T00:00:00Z",
  ...extra,
});
const deletedOrg = (id: string) => org(id, { deleted_at: "2026-09-24T01:00:00Z" });
const others = (n: number, from: number) =>
  Array.from({ length: n }, (_, i) =>
    deletedOrg(`01990000-0000-7000-8000-${String(from + i).padStart(12, "0")}`)
  );

type Call = { path: string; query: URLSearchParams };

/** Stubs the IdP: GET /:id answers `byId`; the list answers `pages[page-1]`. */
function oss(byId: { status: number; body?: unknown }, pages: unknown[][], total?: number) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const u = new URL(input);
      calls.push({ path: u.pathname, query: u.searchParams });
      if (u.pathname === "/api/v1/organizations") {
        const page = Number(u.searchParams.get("page"));
        const rows = pages[page - 1] ?? [];
        return new Response(
          JSON.stringify({
            organizations: rows,
            total: total ?? pages.flat().length,
            page,
            page_size: Number(u.searchParams.get("page_size")),
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(byId.body ?? { error: "not found" }), {
        status: byId.status,
      });
    })
  );
  return calls;
}

const listCalls = (calls: Call[]) => calls.filter((c) => c.path === "/api/v1/organizations");

async function render(id = ID) {
  const tree = await RestoreOrganizationPage({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(<>{tree}</>);
}

describe("listOrganizations reads OSS's deleted_at", () => {
  it("a row carrying deleted_at is deleted; one without it is not", async () => {
    oss({ status: 404 }, [[deletedOrg(ID), org("01990000-0000-7000-8000-0000000000a2")]]);
    const result = await listOrganizations({ deleted: "all", active: "all" });
    expect(result?.organizations.map((o) => o.deleted)).toEqual([true, false]);
  });
});

describe("restore page: a deleted organization OSS will not read by id", () => {
  it("finds it among the deleted rows and shows the confirm form", async () => {
    const calls = oss({ status: 404 }, [[deletedOrg(ID)]]);
    const html = await render();
    expect(html).toContain("Restore organization");
    expect(html).toContain(`value="${ID}"`);
    const list = listCalls(calls)[0];
    expect(list?.query.get("deleted")).toBe("true");
    expect(list?.query.get("active")).toBe("all");
  });

  it("keeps paging until the first match, and no further", async () => {
    const calls = oss({ status: 404 }, [others(100, 1), [deletedOrg(ID)], others(100, 300)], 500);
    const html = await render();
    expect(html).toContain("Restore organization");
    expect(listCalls(calls).map((c) => c.query.get("page"))).toEqual(["1", "2"]);
  });

  it("an id among no deleted rows is the not-found panel, after the last page", async () => {
    const calls = oss({ status: 404 }, [others(100, 1), others(3, 200)]);
    const html = await render();
    expect(html).toContain("Organization not found");
    expect(listCalls(calls)).toHaveLength(2);
  });

  it("the search is bounded: 20 pages of 100 (2,000 deleted organizations), then not found", async () => {
    const full = Array.from({ length: 30 }, (_, p) => others(100, 1000 + p * 100));
    const calls = oss({ status: 404 }, full, 100_000);
    const html = await render();
    expect(html).toContain("Organization not found");
    expect(listCalls(calls)).toHaveLength(20);
    expect(listCalls(calls).every((c) => c.query.get("page_size") === "100")).toBe(true);
  });

  it("a list outage is the not-found panel, never a form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 }))
    );
    const html = await render();
    expect(html).toContain("Organization not found");
    expect(html).not.toContain("Restore organization");
  });
});

describe("restore page: an organization OSS does read", () => {
  it("a live organization says it is not deleted and never searches the deleted rows", async () => {
    const calls = oss({ status: 200, body: org(ID, { active: true }) }, [[deletedOrg(ID)]]);
    const html = await render();
    expect(html).toContain("Not deleted");
    expect(listCalls(calls)).toHaveLength(0);
  });

  it("a malformed id is not found before any request", async () => {
    const calls = oss({ status: 404 }, [[deletedOrg(ID)]]);
    expect(await render("not-a-uuid")).toContain("Organization not found");
    expect(calls).toHaveLength(0);
  });
});
