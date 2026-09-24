/**
 * Plan D: which administration area a path belongs to. The export's router
 * and the test harness both build a route through this one entry, so a path
 * reaches the same layout and page modules in either.
 */
import type { ReactNode } from "react";
import { buildUnavailableRoute } from "./area-routes";
import { buildOrgAdminRoute } from "./org-admin-routes";
import { buildPublicRoute, PUBLIC_PATHS } from "./public-routes";
import { buildSiteAdminRoute } from "./site-admin-routes";

const inArea = (pathname: string, area: string) =>
  pathname === area || pathname.startsWith(`${area}/`);

/** True when the path is served by a shared layout and page tree. */
export function isServerRoute(pathname: string): boolean {
  return (
    inArea(pathname, "/org-admin") ||
    inArea(pathname, "/site-admin") ||
    pathname === "/unavailable" ||
    isPublicRoute(pathname)
  );
}

/**
 * The public pages and the dashboard's security redirect (public-routes.tsx).
 * /dashboard and /account/settings are still the export's own pages
 * (main.tsx) until the shared ones pass the same specs.
 */
export function isPublicRoute(pathname: string): boolean {
  return pathname === "/dashboard/security" || PUBLIC_PATHS.some((p) => p.test(pathname));
}

export function buildServerRoute(pathname: string, query: URLSearchParams): Promise<ReactNode> {
  if (inArea(pathname, "/site-admin")) return buildSiteAdminRoute(pathname, query);
  if (pathname === "/unavailable") return buildUnavailableRoute(query);
  if (isPublicRoute(pathname)) return buildPublicRoute(pathname, query);
  return buildOrgAdminRoute(pathname, query);
}
