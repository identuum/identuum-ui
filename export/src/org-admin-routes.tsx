/**
 * Plan D: the org-admin area in the static export — the SAME layout and page
 * modules the Next deployment renders (src/app/org-admin), not copies. Each
 * route awaits the shared layout (its session, role and MFA guard runs first,
 * exactly as in Next), then the shared page, and renders the composed tree.
 *
 * /unavailable is the shared destination org-admin's own outage redirects
 * name (getServerSession → unavailablePath); it is routed here so an outage
 * keeps its meaning in the export instead of reading as "page not found".
 */
import { createContext, type ReactNode, useContext } from "react";
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
import UserDetailPage, { metadata as userDetailMeta } from "@/app/org-admin/users/[id]/page";
import UsersPage, { metadata as usersMeta } from "@/app/org-admin/users/page";
import UnavailablePage from "@/app/unavailable/page";

type SearchParams = Record<string, string | string[]>;
type PageProps = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<SearchParams>;
};
// Each page declares only the props it reads; every one accepts this shape.
type AnyPage = (props: PageProps) => Promise<ReactNode> | ReactNode;
type Meta = { title?: unknown } | undefined;

interface Route {
  pattern: RegExp;
  keys: string[];
  page: AnyPage;
  metadata: Meta;
}

const route = (pattern: RegExp, keys: string[], page: unknown, metadata: Meta): Route => ({
  pattern,
  keys,
  page: page as AnyPage,
  metadata,
});

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
];

/** Next's searchParams shape: one value is a string, a repeated key an array. */
export function toSearchParams(query: URLSearchParams): SearchParams {
  const out: SearchParams = {};
  for (const key of new Set(query.keys())) {
    const all = query.getAll(key);
    out[key] = all.length === 1 ? (all[0] ?? "") : all;
  }
  return out;
}

export function matchOrgAdmin(
  pathname: string
): { route: Route; params: Record<string, string> } | null {
  for (const r of ORG_ADMIN_ROUTES) {
    const m = pathname.match(r.pattern);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(m[i + 1] ?? "");
    });
    return { route: r, params };
  }
  return null;
}

const Slot = createContext<ReactNode>(null);
function PageSlot() {
  return <>{useContext(Slot)}</>;
}

function titleOf(meta: Meta): string | null {
  return typeof meta?.title === "string" ? meta.title : null;
}

/** Layout first (its guard may redirect), then the page, then the composed tree. */
export async function buildOrgAdminRoute(
  pathname: string,
  query: URLSearchParams
): Promise<ReactNode> {
  const match = matchOrgAdmin(pathname);
  const layout = await OrgAdminLayout({ children: <PageSlot /> });
  if (!match) {
    const missing = (
      <section data-testid="not-found">
        <h1>Page not found</h1>
      </section>
    );
    return <Slot.Provider value={missing}>{layout}</Slot.Provider>;
  }
  const props: PageProps = {
    params: Promise.resolve(match.params),
    searchParams: Promise.resolve(toSearchParams(query)),
  };
  const page = await match.route.page(props);
  document.title = titleOf(match.route.metadata) ?? titleOf(layoutMeta) ?? document.title;
  return <Slot.Provider value={page}>{layout}</Slot.Provider>;
}

export async function buildUnavailableRoute(query: URLSearchParams): Promise<ReactNode> {
  const page = UnavailablePage as unknown as AnyPage;
  return page({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(toSearchParams(query)),
  });
}
