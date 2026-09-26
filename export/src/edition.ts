/**
 * The binary's edition, and the IdP routes only identuum-idp-ce serves.
 *
 * The shared pages call a few IdP routes that exist only in CE. Under Next
 * its server made those calls; in the export the browser makes them, and on
 * OSS each answers 404, which the browser logs as a console error on nearly
 * every page. On any edition but "ce" the export answers them itself
 * (next-proxy.ts) with the binary's own 404, so the pages behave exactly as
 * they do on that answer and nothing reaches the network. On "ce" they pass
 * through unchanged.
 *
 * The list is measured, not inferred (OSS-V0.6.0, 2026-09-24): every path is
 * unmounted in identuum-idp-oss v0.6.0 (404 unauthenticated, where a mounted
 * route answers 401) and is a CE capability. A path both editions serve —
 * the OSS singular identity-provider, the audit events — is not here.
 */
const CE_ONLY_ROUTES: readonly RegExp[] = [
  /^\/api\/upgrade\/status$/,
  /^\/api\/setup\/license$/,
  /^\/api\/v1\/anomaly\/(events|stats)$/,
  /^\/api\/v1\/audit\/event-types$/,
  /^\/api\/v1\/system\/sessions$/,
  /^\/api\/v1\/system\/audit\/chain\/verify$/,
  /^\/api\/v1\/organizations\/[^/]+\/identity-providers$/,
  // CE-UI-2b: the org_admin's one-time reset link (identuum-idp-oss mounts
  // no reset-link route; its internal/api TestCapabilityIff_MailCapabilities
  // pins that).
  /^\/api\/v1\/users\/[^/]+\/recovery\/reset-link$/,
];

/** `pathname` is the IdP path, without the /api/idp or /bff prefix or a query. */
export function isCeOnlyRoute(pathname: string): boolean {
  return CE_ONLY_ROUTES.some((r) => r.test(pathname));
}

/** The answer the OSS binary gives an unmounted route. */
export function unmountedRouteAnswer(): Response {
  return new Response("404 page not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Reads `edition` from the binary's /api/runtime-config (pkg/uiserve), once.
 * "unknown" when it cannot be read; only "ce" lets the CE-only routes through.
 */
export async function loadEdition(fetchImpl: typeof fetch): Promise<string> {
  try {
    const res = await fetchImpl("/api/runtime-config", { cache: "no-store" });
    if (!res.ok) return "unknown";
    const body: unknown = await res.json();
    const edition = (body as { edition?: unknown } | null)?.edition;
    return typeof edition === "string" && edition ? edition : "unknown";
  } catch {
    return "unknown";
  }
}
