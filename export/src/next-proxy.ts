/**
 * The Next deployment's IdP proxy path, answered in the export.
 *
 * The shared browser clients (src/lib/idp-client.ts, idp-account-client,
 * idp-setup-client, idp-setup-mfa-client, idp-upgrade-client,
 * idp-license-client) call /api/idp/<path>, which the Next server forwards to
 * the IdP (src/app/api/idp/[...path]/route.ts). The export has no Next
 * server, so the same paths are answered here, in the page:
 *
 *   /api/idp/api/v1/...   → the boundary (bff(): the browser proof on every
 *                           request, owner decision D1; the cookie lifted by
 *                           Go, never read by script)
 *   /api/idp/<other>      → the binary's own public route (/api/setup/*,
 *                           /api/upgrade/*), directly — /bff forwards /api/v1
 *                           only
 *
 * Nothing else is touched: other paths, other origins and Request objects go
 * to the original fetch unchanged.
 */
import { bff } from "./bff";

const NEXT_IDP_PROXY = "/api/idp";

export function nextProxyFetch(original: typeof fetch): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" || input instanceof URL) {
      const url = new URL(String(input), window.location.href);
      const here = new URL(window.location.href).origin;
      if (url.origin === here && url.pathname.startsWith(`${NEXT_IDP_PROXY}/`)) {
        const target = url.pathname.slice(NEXT_IDP_PROXY.length) + url.search;
        if (target.startsWith("/api/v1/")) return bff(target, init);
        return original(target, init);
      }
    }
    return original(input, init);
  };
}
