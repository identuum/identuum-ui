/**
 * runtime-config for the static export. The binary that serves the export IS
 * the IdP, so the configuration is fixed: IdP enabled, same origin, no AG.
 * The admin client's base URL is "" so its paths stay /api/v1/..., which the
 * browser transport sends through /bff.
 */
import type { PublicRuntimeConfig, RuntimeConfig } from "@/lib/types";

export function loadRuntimeConfig(): RuntimeConfig | null {
  return {
    configured: true,
    ui_origin: window.location.origin,
    idp: { enabled: true, public_base_url: "" },
    ag: { enabled: false, public_base_url: "" },
  };
}

export function idpBaseUrl(cfg: RuntimeConfig): string {
  return cfg.idp.internal_base_url?.trim() || cfg.idp.public_base_url;
}

export function agBaseUrl(cfg: RuntimeConfig): string {
  return (
    cfg.ag.internal_base_url?.trim() || cfg.ag.management_base_url?.trim() || cfg.ag.public_base_url
  );
}

// The rest of src/lib/runtime-config.ts's surface, same bodies: it is pure
// (only loadRuntimeConfig reads the disk), and a shared page that imports any
// of it (the login page: toPublicConfig) must find it here.

export type DeploymentMode = "auth-service" | "governor-only" | "hybrid" | "unconfigured";

export function runtimeMode(cfg: RuntimeConfig | null): DeploymentMode {
  if (!cfg || !cfg.configured) return "unconfigured";
  if (cfg.idp.enabled && cfg.ag.enabled) return "hybrid";
  if (cfg.idp.enabled) return "auth-service";
  if (cfg.ag.enabled) return "governor-only";
  return "unconfigured";
}

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

export function agIdentityBaseUrl(cfg: RuntimeConfig): string {
  return (
    cfg.ag.identity_internal_base_url?.trim() || cfg.ag.identity_base_url?.trim() || agBaseUrl(cfg)
  );
}

export function agIdentityPublicUrl(cfg: RuntimeConfig): string {
  return cfg.ag.identity_base_url?.trim() || cfg.ag.public_base_url;
}
