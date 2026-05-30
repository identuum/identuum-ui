/**
 * license-warnings.ts
 *
 * Pure helper for deriving operator-facing license warning messages from
 * backend component discovery state. No rendering, no server-only imports —
 * testable in any environment.
 *
 * Safe field contract: only reads fields from ComponentLicenseInfo that are
 * already validated by runtime-composition.ts. Never reads entitlements,
 * features, customer_id, license_id, signature, ciphertext, or key material.
 */

import type { BackendComponentState } from "./types";

export type LicenseWarningSeverity = "warning" | "critical";

export interface LicenseWarning {
  backendId: string;
  severity: LicenseWarningSeverity;
  message: string;
}

const COMPONENT_LABELS: Record<string, string> = {
  "identuum-idp": "Identity Provider",
  "identuum-ag": "Agent Governance",
};

function componentLabel(backendId: string, backend: BackendComponentState): string {
  const comp = backend.component ?? backendId;
  return COMPONENT_LABELS[comp] ?? comp;
}

/**
 * deriveLicenseWarnings returns operator-facing license warnings derived from
 * the current backend component states. Returns [] when everything is fine.
 *
 * Silence rules (no warning emitted):
 *   - Backend not configured (intentionally disabled).
 *   - Backend not reachable or not usable (reachability is the primary signal;
 *     the platform-status page and degraded-mode badge already surface this).
 *   - Valid license with days_remaining null/undefined (perpetual or unknown).
 *   - Valid license with days_remaining > 30.
 *
 * Warning rules (severity="warning"):
 *   - Valid license, 0 < days_remaining <= 30: expiry approaching.
 *   - Unknown/missing/unrecognised license status for a reachable backend.
 *
 * Critical rules (severity="critical"):
 *   - Valid license, days_remaining <= 0: expired.
 *   - License status is "expired".
 *   - License status is "invalid".
 */
export function deriveLicenseWarnings(backends: {
  idp: BackendComponentState;
  ag: BackendComponentState;
}): LicenseWarning[] {
  const entries: Array<[string, BackendComponentState]> = [
    ["idp", backends.idp],
    ["ag", backends.ag],
  ];

  const warnings: LicenseWarning[] = [];

  for (const [id, backend] of entries) {
    if (!backend.configured) continue;
    if (!backend.reachable || !backend.usable) continue;

    const lic = backend.license;
    const label = componentLabel(id, backend);

    switch (lic.status) {
      case "valid": {
        const days = lic.days_remaining;
        if (days == null) continue;
        if (days > 30) continue;
        if (days <= 0) {
          warnings.push({ backendId: id, severity: "critical", message: `${label} license has expired.` });
        } else {
          warnings.push({
            backendId: id,
            severity: "warning",
            message: `${label} license expires in ${days} day${days === 1 ? "" : "s"}.`,
          });
        }
        break;
      }
      case "expired":
        warnings.push({ backendId: id, severity: "critical", message: `${label} license has expired.` });
        break;
      case "invalid":
        warnings.push({ backendId: id, severity: "critical", message: `${label} license is invalid.` });
        break;
      default:
        // unknown, missing, empty, or any unrecognised status for a reachable backend
        warnings.push({ backendId: id, severity: "warning", message: `${label} license status is unknown.` });
        break;
    }
  }

  return warnings;
}
