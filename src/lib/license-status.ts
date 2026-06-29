import "server-only";

/**
 * license-status.ts — shared server-side probe for the CE backend's
 * `/api/setup/license` status surface (the safe public projection).
 *
 * Used by `/site-admin/settings` (the live License card) and
 * `/site-admin/license` (the read-only status section above the
 * bearer-token-gated LicenseManager). Single source of truth for the
 * safe-field policy.
 *
 * SAFETY contract — DO NOT widen without a paired security review:
 *
 *   1. The fetch runs ENTIRELY server-side. No internal IDP URL ever
 *      reaches the browser.
 *   2. The `SafeLicenseStatus` projection extracts ONLY four wire
 *      fields: `state` + `product` + `distribution` + optional `tier`.
 *      Every other wire field is dropped at the projection boundary
 *      and is unreachable to any caller of `loadLicenseStatus()`.
 *   3. License envelope contents, signing material, `licensee`,
 *      `expires_at`, `license_id`, `license_type`, `next_action`, and
 *      any admin bearer token are NEVER referenced here.
 *   4. The exported types AND the projection logic are pinned by a
 *      source-invariant vitest test
 *      (src/__tests__/license-status-lib-safety.test.ts). Any change
 *      that adds an unsafe field will fail CI.
 *
 * Auth model: no auth required. `/api/setup/license` GET is the
 * public status surface (the customer-smoke runbook's invariant #12
 * backend agreement test hits it without auth). The cookie session
 * IS NOT consulted; the admin bearer token IS NOT consulted.
 */

import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";

export type LicenseStatusState =
  | "license_missing"
  | "license_valid"
  | "license_invalid"
  | "license_expired";

export interface SafeLicenseStatus {
  state: LicenseStatusState;
  product: string;
  distribution: string;
  tier?: string;
}

export type LicenseProbeOutcome = { kind: "ok"; status: SafeLicenseStatus } | { kind: "unknown" };

function isLicenseStatusState(value: unknown): value is LicenseStatusState {
  return (
    value === "license_missing" ||
    value === "license_valid" ||
    value === "license_invalid" ||
    value === "license_expired"
  );
}

export async function probeLicenseStatus(idpUrl: string): Promise<LicenseProbeOutcome> {
  try {
    const res = await fetch(`${idpUrl.replace(/\/$/, "")}/api/setup/license`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { kind: "unknown" };
    const raw = (await res.json()) as Record<string, unknown>;
    if (!isLicenseStatusState(raw.state)) return { kind: "unknown" };
    return {
      kind: "ok",
      status: {
        state: raw.state,
        product: typeof raw.product === "string" ? raw.product : "",
        distribution: typeof raw.distribution === "string" ? raw.distribution : "",
        tier: typeof raw.tier === "string" ? raw.tier : undefined,
      },
    };
  } catch {
    return { kind: "unknown" };
  }
}

export async function loadLicenseStatus(): Promise<LicenseProbeOutcome> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { kind: "unknown" };
  return probeLicenseStatus(idpBaseUrl(cfg));
}

export function licenseBadge(outcome: LicenseProbeOutcome): { label: string; cls: string } {
  if (outcome.kind === "unknown") {
    return { label: "Unknown", cls: "bg-amber-50 text-amber-700" };
  }
  switch (outcome.status.state) {
    case "license_valid":
      return { label: "Valid", cls: "bg-emerald-50 text-emerald-700" };
    case "license_missing":
      return { label: "Missing", cls: "bg-amber-50 text-amber-700" };
    case "license_invalid":
      return { label: "Invalid", cls: "bg-red-50 text-red-600" };
    case "license_expired":
      return { label: "Expired", cls: "bg-red-50 text-red-600" };
  }
}
