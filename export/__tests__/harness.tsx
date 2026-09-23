/**
 * Plan D test harness: runs the SHARED org-admin layout and pages exactly as
 * the static export does (the vitest "export" project applies the export's
 * platform substitutions), against a recorded fake of the Go boundary.
 *
 * Every request is recorded with its method, path, whether it went through
 * /bff, and whether it carried the browser proof header, so a test can prove
 * both what a page shows and how it asked for it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import { buildOrgAdminRoute } from "../src/org-admin-routes";
import { ExportRedirect } from "../src/platform/next-navigation";
import { revalidate } from "../src/router";

export const ORG_ID = "01990000-0000-7000-8000-00000000000a";
export const ADMIN_ID = "01990000-0000-7000-8000-000000000001";
export const ORIGIN = "http://idp.test";

export interface Recorded {
  method: string;
  path: string;
  viaBff: boolean;
  proof: boolean;
  body: unknown;
}

type Answer = { status?: number; json?: unknown; headers?: Record<string, string> };
export type Routes = Record<string, Answer | ((req: Recorded) => Answer)>;

/** Real OSS capability map, as the Plan-C binary reports it (2026-09-23). */
export const OSS_COMPONENT = {
  component: "identuum-idp",
  product: "identuum-idp-oss",
  status: "ok",
  capability_map_schema_version: "idp-capabilities.v1",
  capabilities: {
    account_self_service: true,
    api_resources: true,
    audit_log: true,
    auth_provider_discovery: true,
    authorization_server: true,
    client_credentials: true,
    component_discovery: true,
    identity_provider: true,
    license_status: true,
    mfa: true,
    oauth_clients: true,
    org_roles: true,
    protocol_settings: true,
    scope_templates: true,
    service_accounts: true,
    user_sessions: true,
    webauthn: true,
  },
  license: { status: "valid", license_type: "oss", tier: "starter" },
};

export function session(role = "org_admin", extra: Record<string, unknown> = {}) {
  return {
    role,
    user: {
      id: ADMIN_ID,
      email: "admin@tenant-a.test",
      role,
      organization_id: ORG_ID,
      mfa_enabled: true,
      ...extra,
    },
  };
}

const BASE_ROUTES: Routes = {
  "GET /api/v1/validate": { json: session() },
  "GET /api/v1/component": { json: OSS_COMPONENT },
  "GET /api/setup/status": { json: { state: "setup_complete" } },
};

/**
 * Installs the browser globals the export relies on and a fake boundary.
 * Unrouted requests answer 404 {} — a page that asks for something unexpected
 * shows up in `calls` and in its own not-found handling.
 */
export function installExport(path: string, routes: Routes = {}) {
  const url = new URL(path, ORIGIN);
  const location = {
    origin: ORIGIN,
    href: url.href,
    pathname: url.pathname,
    search: url.search,
    hash: "",
  };
  const setPath = (next: string) => {
    const u = new URL(next, ORIGIN);
    location.href = u.href;
    location.pathname = u.pathname;
    location.search = u.search;
  };
  vi.stubGlobal("window", {
    location,
    history: {
      pushState: (_s: unknown, _t: string, next: string) => setPath(next),
      replaceState: (_s: unknown, _t: string, next: string) => setPath(next),
      back: () => undefined,
      forward: () => undefined,
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal("document", { title: "" });

  const all: Routes = { ...BASE_ROUTES, ...routes };
  const calls: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const u = new URL(input, ORIGIN);
      const viaBff = u.pathname.startsWith("/bff/");
      const req: Recorded = {
        method: (init.method ?? "GET").toUpperCase(),
        path: (viaBff ? u.pathname.slice(4) : u.pathname) + u.search,
        viaBff,
        proof: new Headers(init.headers).get("X-Requested-With") === "identuum-ui",
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(req);
      const key = `${req.method} ${req.path.split("?")[0]}`;
      const route = all[key];
      const answer =
        typeof route === "function" ? route(req) : (route ?? { status: 404, json: {} });
      return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), {
        status: answer.status ?? 200,
        headers: { "Content-Type": "application/json", ...answer.headers },
      });
    })
  );
  // A fresh "request": the per-route session and discovery results reset.
  revalidate();
  return {
    calls,
    location,
    /** Builds and renders the route; a redirect resolves to its destination. */
    async render(): Promise<{ html: string; redirectedTo: string | null }> {
      const [pathname, search = ""] = `${location.pathname}${location.search}`.split("?");
      try {
        const tree = await buildOrgAdminRoute(pathname ?? "/", new URLSearchParams(search));
        return { html: renderToStaticMarkup(<>{tree}</>), redirectedTo: null };
      } catch (error) {
        if (error instanceof ExportRedirect) return { html: "", redirectedTo: error.to };
        throw error;
      }
    },
  };
}

/** Every /api/v1 call except discovery and setup went through /bff with the proof. */
export function everyApiCallThroughTheBoundary(calls: Recorded[]): boolean {
  return calls
    .filter((c) => c.path.startsWith("/api/v1/") && !c.path.startsWith("/api/v1/component"))
    .every((c) => c.viaBff && c.proof);
}
