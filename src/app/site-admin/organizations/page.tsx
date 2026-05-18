/**
 * Organizations list page — site_admin only.
 *
 * Auth and role are enforced by the parent layout (site-admin/layout.tsx).
 * This page does not repeat the guard.
 *
 * Data is fetched server-side via listOrganizations(), which uses the runtime
 * config internal URL and forwards session cookies. Internal URLs and raw
 * cookie values are never included in props passed to OrganizationsClient.
 *
 * Pagination: ?page=N (1-based). Malformed/missing values fall back to page 1.
 * Deleted filter: ?deleted=false (default) | deleted=true | deleted=all.
 *
 * Create is at /site-admin/organizations/new.
 * Edit is at /site-admin/organizations/[id]/edit.
 * Delete is at /site-admin/organizations/[id]/delete.
 * Restore is at /site-admin/organizations/[id]/restore.
 * Assign-admin remains deferred.
 */
import { listOrganizations } from "@/lib/idp-admin-client";
import type { Metadata } from "next";
import { OrganizationsClient } from "./client";

export const metadata: Metadata = { title: "Organizations — Identuum Admin" };

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE = 10_000;

function parsePage(raw: string | string[] | undefined): number {
  const str = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  const n = Number(str);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_PAGE) return 1;
  return n;
}

/** Parses ?deleted= and returns a backend-safe value. Falls back to "false". */
function parseDeletedFilter(raw: string | string[] | undefined): "false" | "true" | "all" {
  const str = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  if (str === "true" || str === "all") return str;
  return "false";
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const deletedFilter = parseDeletedFilter(params.deleted);
  const pageSize = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const result = await listOrganizations({ offset, limit: pageSize, deleted: deletedFilter });

  return <OrganizationsClient initialData={result} page={page} deletedFilter={deletedFilter} />;
}
