/**
 * Plan D: an administration area in the static export — the SAME layout and
 * page modules the Next deployment renders (src/app/<area>), not copies.
 * Each route awaits the shared layout (its session, role and MFA guard runs
 * first, exactly as in Next), then the shared page, and renders the composed
 * tree. The org-admin and site-admin areas differ only in their route table
 * and layout (org-admin-routes.tsx, site-admin-routes.tsx).
 *
 * /unavailable is the shared destination the areas' own outage redirects
 * name (getServerSession → unavailablePath); it is routed here so an outage
 * keeps its meaning in the export instead of reading as "page not found".
 */
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";
import UnavailablePage from "@/app/unavailable/page";

type SearchParams = Record<string, string | string[]>;
type PageProps = {
  params: Promise<Record<string, string>>;
  searchParams: Promise<SearchParams>;
};
// Each page declares only the props it reads; every one accepts this shape.
type AnyPage = (props: PageProps) => Promise<ReactNode> | ReactNode;
export type Meta = { title?: unknown } | undefined;

export interface Route {
  pattern: RegExp;
  keys: string[];
  page: AnyPage;
  metadata: Meta;
}

export interface Area {
  layout: (props: { children: ReactNode }) => Promise<ReactNode> | ReactNode;
  layoutMeta: Meta;
  routes: readonly Route[];
}

export const route = (pattern: RegExp, keys: string[], page: unknown, metadata: Meta): Route => ({
  pattern,
  keys,
  page: page as AnyPage,
  metadata,
});

/** Next's searchParams shape: one value is a string, a repeated key an array. */
export function toSearchParams(query: URLSearchParams): SearchParams {
  const out: SearchParams = {};
  for (const key of new Set(query.keys())) {
    const all = query.getAll(key);
    out[key] = all.length === 1 ? (all[0] ?? "") : all;
  }
  return out;
}

export function matchRoute(
  routes: readonly Route[],
  pathname: string
): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
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

const isAsyncComponent = (type: unknown): type is (props: unknown) => Promise<ReactNode> =>
  typeof type === "function" && type.constructor?.name === "AsyncFunction";

/**
 * Next renders a shared layout or page on the server, where a nested async
 * component (a server component such as PlatformLicenseWarnings) is awaited
 * before anything reaches the browser. The export renders the tree in the
 * browser, where React cannot render an async component, so the tree is
 * resolved first: each async function component is awaited with its props and
 * replaced by what it returned, recursively, through children. Client
 * components are left as elements; React renders them as usual. A redirect or
 * error thrown by an async component propagates exactly as from the page.
 */
export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolveServerTree(child)));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (isAsyncComponent(element.type)) {
    return resolveServerTree(await element.type(element.props));
  }
  const children = element.props?.children;
  if (children === undefined || typeof children === "function") return element;
  return cloneElement(element, { children: await resolveServerTree(children) });
}

const Slot = createContext<ReactNode>(null);
function PageSlot() {
  return <>{useContext(Slot)}</>;
}

function titleOf(meta: Meta): string | null {
  return typeof meta?.title === "string" ? meta.title : null;
}

/** Layout first (its guard may redirect), then the page, then the composed tree. */
export async function buildAreaRoute(
  area: Area,
  pathname: string,
  query: URLSearchParams
): Promise<ReactNode> {
  const match = matchRoute(area.routes, pathname);
  const layout = await resolveServerTree(await area.layout({ children: <PageSlot /> }));
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
  const page = await resolveServerTree(await match.route.page(props));
  document.title = titleOf(match.route.metadata) ?? titleOf(area.layoutMeta) ?? document.title;
  return <Slot.Provider value={page}>{layout}</Slot.Provider>;
}

export async function buildUnavailableRoute(query: URLSearchParams): Promise<ReactNode> {
  const page = UnavailablePage as unknown as AnyPage;
  return page({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(toSearchParams(query)),
  });
}
