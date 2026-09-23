/**
 * Plan D: the site-admin area in the static export — its route table over the
 * shared layout and page modules (src/app/site-admin). The machinery that
 * composes a route is shared with the org-admin area (area-routes.tsx).
 */
import AnomalyPage, { metadata as anomalyMeta } from "@/app/site-admin/anomaly/page";
import AuditPage, { metadata as auditMeta } from "@/app/site-admin/audit/page";
import KeysPage, { metadata as keysMeta } from "@/app/site-admin/keys/page";
import SiteAdminLayout, { metadata as layoutMeta } from "@/app/site-admin/layout";
import LicensePage, { metadata as licenseMeta } from "@/app/site-admin/license/page";
import OrgLinkAgPlanPage, {
  metadata as orgLinkAgPlanMeta,
} from "@/app/site-admin/org-link/ag-plan/page";
import OrgLinkPage, { metadata as orgLinkMeta } from "@/app/site-admin/org-link/page";
import OrgLinkReadinessPage, {
  metadata as orgLinkReadinessMeta,
} from "@/app/site-admin/org-link/readiness/page";
import AssignAdminPage, {
  metadata as assignAdminMeta,
} from "@/app/site-admin/organizations/[id]/assign-admin/page";
import DeactivatePage, {
  metadata as deactivateMeta,
} from "@/app/site-admin/organizations/[id]/deactivate/page";
import DeletePage, {
  metadata as deleteMeta,
} from "@/app/site-admin/organizations/[id]/delete/page";
import OrgEditPage, {
  metadata as orgEditMeta,
} from "@/app/site-admin/organizations/[id]/edit/page";
import OrgDetailPage, { metadata as orgDetailMeta } from "@/app/site-admin/organizations/[id]/page";
import ReactivatePage, {
  metadata as reactivateMeta,
} from "@/app/site-admin/organizations/[id]/reactivate/page";
import RestorePage, {
  metadata as restoreMeta,
} from "@/app/site-admin/organizations/[id]/restore/page";
import OrgNewPage, { metadata as orgNewMeta } from "@/app/site-admin/organizations/new/page";
import OrganizationsPage, {
  metadata as organizationsMeta,
} from "@/app/site-admin/organizations/page";
import ReportsPage, { metadata as reportsMeta } from "@/app/site-admin/reports/page";
import AuditChainPage, {
  metadata as auditChainMeta,
} from "@/app/site-admin/system/audit-chain/page";
import SystemInfoPage, { metadata as systemInfoMeta } from "@/app/site-admin/system/info/page";
import SystemPage, { metadata as systemMeta } from "@/app/site-admin/system/page";
import SessionsPage, { metadata as sessionsMeta } from "@/app/site-admin/system/sessions/page";
import { type Area, buildAreaRoute, type Route, route } from "./area-routes";

const ORG = "\\/site-admin\\/organizations\\/([^/]+)";
const org = (suffix: string) => new RegExp(`^${ORG}${suffix}$`);

// Literal segments ("new") are matched before the dynamic id.
//
// Not routed (PLAN-D-3, blocked on the Go binary): the overview
// (src/app/site-admin/page.tsx) reads the Next-only UI routes GET /api/status
// and GET /api/runtime-config, which the binary does not serve; settings
// (src/app/site-admin/settings/page.tsx) probes the IdP at GET /healthz, which
// OSS does not serve and the binary's UI fallback answers with the app shell
// (200 text/html), so the export would report a health it never measured.
export const SITE_ADMIN_ROUTES: readonly Route[] = [
  route(/^\/site-admin\/organizations$/, [], OrganizationsPage, organizationsMeta),
  route(/^\/site-admin\/organizations\/new$/, [], OrgNewPage, orgNewMeta),
  route(org(""), ["id"], OrgDetailPage, orgDetailMeta),
  route(org("\\/edit"), ["id"], OrgEditPage, orgEditMeta),
  route(org("\\/assign-admin"), ["id"], AssignAdminPage, assignAdminMeta),
  route(org("\\/deactivate"), ["id"], DeactivatePage, deactivateMeta),
  route(org("\\/reactivate"), ["id"], ReactivatePage, reactivateMeta),
  route(org("\\/delete"), ["id"], DeletePage, deleteMeta),
  route(org("\\/restore"), ["id"], RestorePage, restoreMeta),
  route(/^\/site-admin\/audit$/, [], AuditPage, auditMeta),
  route(/^\/site-admin\/anomaly$/, [], AnomalyPage, anomalyMeta),
  route(/^\/site-admin\/keys$/, [], KeysPage, keysMeta),
  route(/^\/site-admin\/license$/, [], LicensePage, licenseMeta),
  route(/^\/site-admin\/reports$/, [], ReportsPage, reportsMeta),
  route(/^\/site-admin\/system$/, [], SystemPage, systemMeta),
  route(/^\/site-admin\/system\/info$/, [], SystemInfoPage, systemInfoMeta),
  route(/^\/site-admin\/system\/sessions$/, [], SessionsPage, sessionsMeta),
  route(/^\/site-admin\/system\/audit-chain$/, [], AuditChainPage, auditChainMeta),
  route(/^\/site-admin\/org-link$/, [], OrgLinkPage, orgLinkMeta),
  route(/^\/site-admin\/org-link\/readiness$/, [], OrgLinkReadinessPage, orgLinkReadinessMeta),
  route(/^\/site-admin\/org-link\/ag-plan$/, [], OrgLinkAgPlanPage, orgLinkAgPlanMeta),
];

export const SITE_ADMIN_AREA: Area = {
  layout: SiteAdminLayout,
  layoutMeta,
  routes: SITE_ADMIN_ROUTES,
};

export function buildSiteAdminRoute(pathname: string, query: URLSearchParams) {
  return buildAreaRoute(SITE_ADMIN_AREA, pathname, query);
}
