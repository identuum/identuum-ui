/**
 * server-runtime-state.ts
 *
 * Cached server-side wrapper for runtime discovery.
 * Uses React cache() so the discovery call runs at most once per server
 * render cycle even when multiple layouts and pages call it.
 *
 * Security: this module is server-only. Internal backend URLs used for
 * discovery are never returned to browser-side code.
 */
import "server-only";

import { cache } from "react";
import { discoverRuntime } from "./runtime-composition";
import { agBaseUrl, idpBaseUrl, loadRuntimeConfig } from "./runtime-config";
import type { RuntimeState } from "./types";

/**
 * Returns the current RuntimeState by calling each configured backend's
 * /api/v1/component endpoint. Returns null when the UI is not configured.
 * Cached per-request so multiple callers in the same render tree share one result.
 */
export const getServerRuntimeState = cache(async (): Promise<RuntimeState | null> => {
  const cfg = loadRuntimeConfig();
  if (!cfg) return null;

  const idpUrl = cfg.idp.enabled ? idpBaseUrl(cfg) : null;
  const agUrl = cfg.ag.enabled ? agBaseUrl(cfg) : null;

  return discoverRuntime(idpUrl, agUrl);
});
