/**
 * server-runtime-state.ts
 *
 * Cached server-side wrapper for runtime discovery.
 * Uses React cache() so the discovery call runs at most once per server
 * render cycle even when multiple layouts and pages call it.
 *
 * Security: this module is server-only. Internal backend URLs used for
 * discovery are never returned to browser-side code.
 *
 * 2026-07-08: the AG CE org-link availability verdict (from
 * `lib/ag-ce-org-linking-availability.ts::deriveAGCEOrgLinkAvailability`
 * + `lib/ag-org-link-readiness-client.ts::fetchAGOrgLinkReadiness`) is
 * now composed alongside the component-discovery state here. Pages MUST
 * read `state.agCEOrgLinkAvailability` rather than re-fetching the
 * readiness probe themselves — that duplication was the explicit
 * de-duplication target of the 2026-07-08 slice.
 */
import "server-only";

import { cache } from "react";
import { deriveAGCEOrgLinkAvailability } from "./ag-ce-org-linking-availability";
import { fetchAGOrgLinkReadiness } from "./ag-org-link-readiness-client";
import { discoverRuntime } from "./runtime-composition";
import { agBaseUrl, idpBaseUrl, loadRuntimeConfig } from "./runtime-config";
import type { RuntimeState } from "./types";

/**
 * Returns the current RuntimeState by calling each configured backend's
 * /api/v1/component endpoint AND (when AG is enabled) AG CE's
 * /api/v1/org-link/readiness probe in parallel. Returns null when the
 * UI is not configured.
 *
 * Cached per-request so multiple callers in the same render tree share
 * one result. The readiness probe is pre-login by AG CE design — no
 * operator session cookie or Authorization header is attached.
 *
 * `agCEOrgLinkAvailability` is set to:
 *   - a derived verdict object when AG is enabled (capability +
 *     readiness signals combined),
 *   - `null` when AG is NOT enabled (no probe runs).
 */
export const getServerRuntimeState = cache(async (): Promise<RuntimeState | null> => {
  const cfg = loadRuntimeConfig();
  if (!cfg) return null;

  const idpUrl = cfg.idp.enabled ? idpBaseUrl(cfg) : null;
  const agUrl = cfg.ag.enabled ? agBaseUrl(cfg) : null;

  // Run the component-discovery + AG CE readiness probes in parallel so
  // a configured AG backend adds zero serial-latency penalty. The
  // readiness probe internally short-circuits to `{status:
  // "not_configured"}` when AG is disabled — safe to call
  // unconditionally, but we still skip it explicitly to avoid an
  // unnecessary `loadRuntimeConfig` re-read inside the client.
  const [state, agCEReadinessResult] = await Promise.all([
    discoverRuntime(idpUrl, agUrl),
    agUrl ? fetchAGOrgLinkReadiness() : Promise.resolve(null),
  ]);

  // Derive the AG CE-specific org-link availability verdict from BOTH
  // the capability-map signal (already on `state.components.ag`) and
  // the live readiness probe. `null` when AG is not enabled — pages
  // skip rendering the AG CE availability card in that case.
  state.agCEOrgLinkAvailability = agCEReadinessResult
    ? deriveAGCEOrgLinkAvailability(state.components.ag.capabilities, agCEReadinessResult)
    : null;

  return state;
});
