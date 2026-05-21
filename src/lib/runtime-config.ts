import fs from "node:fs";
import path from "node:path";
import type { PublicRuntimeConfig, RuntimeConfig } from "./types";

/**
 * DeploymentMode encodes the three supported runtime modes and the unconfigured state.
 *
 *   auth-service   — IdP only (idp.enabled=true, ag.enabled=false)
 *   governor-only  — AG only  (idp.enabled=false, ag.enabled=true)
 *   hybrid         — both     (idp.enabled=true,  ag.enabled=true)
 *   unconfigured   — no configured backend
 *
 * AG-only (governor-only) is a valid deployment topology: identuum-ui talks only to
 * identuum-ag; no identuum-idp is required. Human identity login is not available
 * in this mode; operator authentication happens via AG's own operator path.
 *
 * Phase 5.1 note: the AG health probe endpoint (/health) is management-surface-only.
 * ag.public_base_url and ag.internal_base_url must point to the AG management
 * surface (default port 7215 in dev). The agent surface (7213) and identity surface
 * (7214) do not expose /health.
 */
export type DeploymentMode = "auth-service" | "governor-only" | "hybrid" | "unconfigured";

/**
 * runtimeMode derives the current deployment mode from the runtime config.
 * Returns "unconfigured" when cfg is null or configured=false.
 */
export function runtimeMode(cfg: RuntimeConfig | null): DeploymentMode {
  if (!cfg || !cfg.configured) return "unconfigured";
  if (cfg.idp.enabled && cfg.ag.enabled) return "hybrid";
  if (cfg.idp.enabled) return "auth-service";
  if (cfg.ag.enabled) return "governor-only";
  return "unconfigured";
}

function configFilePath(): string {
  // Explicit env var takes priority in all environments.
  const explicit = process.env.IDENTUUM_UI_CONFIG_FILE;
  if (explicit) return explicit;

  // Production container: config is always at the well-known volume mount path.
  // Using a string literal avoids the dynamic process.cwd() call that causes
  // Turbopack's file tracer to sweep the entire project tree.
  if (process.env.NODE_ENV === "production") {
    return "/app/config/ui-runtime.json";
  }

  // Local dev: config lives under <cwd>/config/. path.join is intentional here;
  // it only runs in development where Turbopack's NFT tracer is not a concern.
  return path.join(process.cwd(), "config", "ui-runtime.json");
}

// loadRuntimeConfig reads the runtime config from disk.
// Returns null when the file is missing or unparseable (setup-required state).
export function loadRuntimeConfig(): RuntimeConfig | null {
  try {
    const raw = fs.readFileSync(configFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as RuntimeConfig;
    if (!parsed.configured) return null;
    return parsed;
  } catch {
    return null;
  }
}

// toPublicConfig strips server-only fields (internal_base_url).
export function toPublicConfig(cfg: RuntimeConfig): PublicRuntimeConfig {
  return {
    configured: cfg.configured,
    ui_origin: cfg.ui_origin,
    idp: {
      enabled: cfg.idp.enabled,
      public_base_url: cfg.idp.public_base_url,
    },
    ag: {
      enabled: cfg.ag.enabled,
      public_base_url: cfg.ag.public_base_url,
    },
  };
}

// idpBaseUrl returns the URL the UI server uses to call the IdP backend.
// Uses internal_base_url when present (server-side efficiency), otherwise public_base_url.
export function idpBaseUrl(cfg: RuntimeConfig): string {
  return cfg.idp.internal_base_url?.trim() || cfg.idp.public_base_url;
}

// agBaseUrl returns the URL the UI server uses to call the AG management surface.
// Used for health checks and admin API calls. Never exposed to the browser.
// Priority: internal_base_url → management_base_url (legacy alias) → public_base_url.
export function agBaseUrl(cfg: RuntimeConfig): string {
  return (
    cfg.ag.internal_base_url?.trim() ||
    cfg.ag.management_base_url?.trim() ||
    cfg.ag.public_base_url
  );
}

// agIdentityBaseUrl returns the URL the UI server uses to call the AG identity
// surface (operator login, OIDC discovery). Default port 7214 in dev.
// Falls back to agBaseUrl when identity_base_url is not configured.
export function agIdentityBaseUrl(cfg: RuntimeConfig): string {
  return (
    cfg.ag.identity_internal_base_url?.trim() || cfg.ag.identity_base_url?.trim() || agBaseUrl(cfg)
  );
}

// agIdentityPublicUrl returns the browser-facing public URL for the AG identity
// surface. Used for 302 redirects into AG OIDC login flows — the browser must
// be able to reach this URL, so internal_base_url is intentionally skipped.
// Falls back to ag.public_base_url when identity_base_url is not configured.
// Never exposes internal_base_url to the browser.
export function agIdentityPublicUrl(cfg: RuntimeConfig): string {
  return cfg.ag.identity_base_url?.trim() || cfg.ag.public_base_url;
}
