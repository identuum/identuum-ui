/**
 * runtime-config for the static export. The binary that serves the export IS
 * the IdP, so the configuration is fixed: IdP enabled, same origin, no AG.
 * The admin client's base URL is "" so its paths stay /api/v1/..., which the
 * browser transport sends through /bff.
 */
import type { RuntimeConfig } from "@/lib/types";

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
