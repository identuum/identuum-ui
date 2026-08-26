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
 * Lifecycle filter: ?state=current (default) | deactivated | deleted | all,
 * mapped onto the backend's two tri-state axes (?active=, ?deleted=).
 * Legacy ?deleted=true|all links are honored as state aliases.
 *
 * Create is at /site-admin/organizations/new.
 * Edit is at /site-admin/organizations/[id]/edit.
 * Delete is at /site-admin/organizations/[id]/delete.
 * Restore is at /site-admin/organizations/[id]/restore.
 * Assign-admin remains deferred.
 */

import type { Metadata } from "next";
import { listOrganizations } from "@/lib/idp-admin-client";
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

export type LifecycleStateFilter = "current" | "deactivated" | "deleted" | "all";

/**
 * The four lifecycle states an organization can actually be in, mapped onto
 * the backend's two tri-state axes (?active=, ?deleted=). One combined
 * control instead of two selects: the operator thinks in STATES, not axis
 * combinations, and no invalid combination is expressible. DELETED widens
 * the active axis on purpose — an org deactivated before deletion must not
 * hide from the deleted list.
 */
const STATE_QUERY: Record<
  LifecycleStateFilter,
  { active: "true" | "false" | "all"; deleted: "false" | "true" | "all" }
> = {
  current: { active: "true", deleted: "false" },
  deactivated: { active: "false", deleted: "false" },
  deleted: { active: "all", deleted: "true" },
  all: { active: "all", deleted: "all" },
};

/**
 * Parses ?state= (current | deactivated | deleted | all), honoring the
 * legacy ?deleted=true|all links as aliases. Falls back to "current".
 */
function parseStateFilter(
  rawState: string | string[] | undefined,
  legacyDeleted: string | string[] | undefined
): LifecycleStateFilter {
  const state = Array.isArray(rawState) ? (rawState[0] ?? "") : (rawState ?? "");
  if (state === "current" || state === "deactivated" || state === "deleted" || state === "all") {
    return state;
  }
  const legacy = Array.isArray(legacyDeleted) ? (legacyDeleted[0] ?? "") : (legacyDeleted ?? "");
  if (legacy === "true") return "deleted";
  if (legacy === "all") return "all";
  return "current";
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const stateFilter = parseStateFilter(params.state, params.deleted);
  const query = STATE_QUERY[stateFilter];
  const pageSize = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const result = await listOrganizations({
    offset,
    limit: pageSize,
    deleted: query.deleted,
    active: query.active,
  });

  return <OrganizationsClient initialData={result} page={page} stateFilter={stateFilter} />;
}
