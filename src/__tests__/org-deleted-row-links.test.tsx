import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrganizationsClient } from "@/app/site-admin/organizations/client";
import type { OrgListResult } from "@/lib/types";

// OSS-POLISH item 6 (ORG-RESTORE-1): OSS answers 404 by contract for a
// soft-deleted organization read by id, so its detail, edit, delete,
// deactivate, reactivate and assign-admin pages all show "Organization not
// found". The list's deleted row therefore links only to Restore — the one
// page that serves it — and never to Details. A live row keeps Details.
const ID = "0198b2d0-0000-7000-8000-00000000d0d0";
const row = (deleted: boolean): OrgListResult => ({
  organizations: [
    {
      id: ID,
      name: "Gone Corp",
      domain: "gone.example",
      slug: "gone",
      active: false,
      deleted,
      has_admin: true,
      can_assign_admin: false,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    },
  ],
  total_count: 1,
  count: 1,
  offset: 0,
  limit: 20,
});

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h.includes(ID));

describe("a deleted organization's row links only where OSS serves it", () => {
  it("offers Restore and no page that answers 404", () => {
    const html = renderToStaticMarkup(
      <OrganizationsClient initialData={row(true)} page={1} stateFilter="deleted" />
    );
    expect(hrefs(html)).toEqual([`/site-admin/organizations/${ID}/restore`]);
  });
  it("a live row keeps Details", () => {
    const html = renderToStaticMarkup(
      <OrganizationsClient initialData={row(false)} page={1} stateFilter="current" />
    );
    expect(hrefs(html)).toContain(`/site-admin/organizations/${ID}`);
  });
});
