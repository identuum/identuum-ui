/**
 * Plan D: the org-admin area in the static export — its route table over the
 * shared layout and page modules (src/app/org-admin). The machinery that
 * composes a route is shared with the site-admin area (area-routes.tsx).
 */
import ApiResourceEditPage, {
  metadata as apiResourceEditMeta,
} from "@/app/org-admin/api-resources/[id]/edit/page";
import ApiResourceDetailPage, {
  metadata as apiResourceDetailMeta,
} from "@/app/org-admin/api-resources/[id]/page";
import ApiResourceNewPage, {
  metadata as apiResourceNewMeta,
} from "@/app/org-admin/api-resources/new/page";
import ApiResourcesPage, { metadata as apiResourcesMeta } from "@/app/org-admin/api-resources/page";
import ApplicationEditPage, {
  metadata as applicationEditMeta,
} from "@/app/org-admin/applications/[id]/edit/page";
import ApplicationDetailPage, {
  metadata as applicationDetailMeta,
} from "@/app/org-admin/applications/[id]/page";
import ApplicationNewPage, {
  metadata as applicationNewMeta,
} from "@/app/org-admin/applications/new/page";
import ApplicationsPage, { metadata as applicationsMeta } from "@/app/org-admin/applications/page";
import AuditPage, { metadata as auditMeta } from "@/app/org-admin/audit/page";
import OrgAdminLayout, { metadata as layoutMeta } from "@/app/org-admin/layout";
import OrgAdminPage from "@/app/org-admin/page";
import ServiceAccountDetailPage, {
  metadata as serviceAccountDetailMeta,
} from "@/app/org-admin/service-accounts/[id]/page";
import ServiceAccountNewPage, {
  metadata as serviceAccountNewMeta,
} from "@/app/org-admin/service-accounts/new/page";
import ServiceAccountsPage, {
  metadata as serviceAccountsMeta,
} from "@/app/org-admin/service-accounts/page";
import SettingsPage, { metadata as settingsMeta } from "@/app/org-admin/settings/page";
import UserDetailPage, { metadata as userDetailMeta } from "@/app/org-admin/users/[id]/page";
import UsersPage, { metadata as usersMeta } from "@/app/org-admin/users/page";
import { type Area, buildAreaRoute, type Route, route } from "./area-routes";

// Literal segments ("new", "edit") are matched before the dynamic id.
export const ORG_ADMIN_ROUTES: readonly Route[] = [
  route(/^\/org-admin$/, [], OrgAdminPage, undefined),
  route(/^\/org-admin\/users$/, [], UsersPage, usersMeta),
  route(/^\/org-admin\/users\/([^/]+)$/, ["id"], UserDetailPage, userDetailMeta),
  route(/^\/org-admin\/applications$/, [], ApplicationsPage, applicationsMeta),
  route(/^\/org-admin\/applications\/new$/, [], ApplicationNewPage, applicationNewMeta),
  route(
    /^\/org-admin\/applications\/([^/]+)$/,
    ["id"],
    ApplicationDetailPage,
    applicationDetailMeta
  ),
  route(
    /^\/org-admin\/applications\/([^/]+)\/edit$/,
    ["id"],
    ApplicationEditPage,
    applicationEditMeta
  ),
  route(/^\/org-admin\/api-resources$/, [], ApiResourcesPage, apiResourcesMeta),
  route(/^\/org-admin\/api-resources\/new$/, [], ApiResourceNewPage, apiResourceNewMeta),
  route(
    /^\/org-admin\/api-resources\/([^/]+)$/,
    ["id"],
    ApiResourceDetailPage,
    apiResourceDetailMeta
  ),
  route(
    /^\/org-admin\/api-resources\/([^/]+)\/edit$/,
    ["id"],
    ApiResourceEditPage,
    apiResourceEditMeta
  ),
  route(/^\/org-admin\/service-accounts$/, [], ServiceAccountsPage, serviceAccountsMeta),
  route(/^\/org-admin\/service-accounts\/new$/, [], ServiceAccountNewPage, serviceAccountNewMeta),
  route(
    /^\/org-admin\/service-accounts\/([^/]+)$/,
    ["id"],
    ServiceAccountDetailPage,
    serviceAccountDetailMeta
  ),
  route(/^\/org-admin\/settings$/, [], SettingsPage, settingsMeta),
  route(/^\/org-admin\/audit$/, [], AuditPage, auditMeta),
];

export const ORG_ADMIN_AREA: Area = {
  layout: OrgAdminLayout,
  layoutMeta,
  routes: ORG_ADMIN_ROUTES,
};

export function buildOrgAdminRoute(pathname: string, query: URLSearchParams) {
  return buildAreaRoute(ORG_ADMIN_AREA, pathname, query);
}
