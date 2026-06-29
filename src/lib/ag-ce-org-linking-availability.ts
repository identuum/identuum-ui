/**
 * ag-ce-org-linking-availability.ts
 *
 * Pure helper for deriving AG CE org-linking UI availability from the
 * two AG CE-owned authorities: the component capability map
 * (`GET /api/v1/component`) and the org-link readiness probe
 * (`GET /api/v1/org-link/readiness`). No rendering, no server-only
 * imports — testable in any environment.
 *
 * This helper is INTENTIONALLY SEPARATE from
 * `org-linking-readiness.ts::deriveOrganizationLinkingReadiness` which
 * evaluates IDP↔AG bilateral readiness from capability flags only.
 * The 2026-07-01 AG CE closure audit confirmed AG CE additionally
 * exposes a SECOND readiness signal — the dedicated
 * `/api/v1/org-link/readiness` probe — that reflects the live route-
 * mount state on the management surface. The UI should gate the
 * AG-side actionable org-link affordance on BOTH signals being
 * positive so the UI never offers a button that points at a route
 * AG CE has not actually mounted.
 *
 * SCOPE:
 *   - AG CE org-linking ONLY. IDP-side org-export/import readiness
 *     remains the responsibility of
 *     `deriveOrganizationLinkingReadiness`.
 *   - Read-only honesty derivation. No side effects, no fetches.
 *
 * Safe field contract: reads only the typed bounded shape returned by
 * `fetchAGOrgLinkReadiness` + the `organization_linking` capability
 * boolean. Never reads operator tokens, IDs, names, statuses, or any
 * sensitive material.
 */

import type { AGOrgLinkReadinessResult } from "./ag-org-link-readiness-client";
import type { ComponentCapabilities } from "./types";

/**
 * Discriminated availability verdict the UI renders from. Each variant
 * carries the minimum context the renderer needs to display an honest
 * state without re-checking inputs.
 *
 *   actionable          — AG capability says organization_linking=true
 *                          AND AG CE readiness says configured=true,
 *                          ready=true. The UI may render the org-link
 *                          plan + link/unlink CTAs.
 *   capability_missing  — AG reports organization_linking is not
 *                          true (false / undefined). Show a "the AG
 *                          backend does not advertise org-linking
 *                          capability" notice.
 *   readiness_pending   — Capability is true but readiness reports
 *                          either configured=false or ready=false (or
 *                          both). The UI shows the readiness notes
 *                          verbatim — they describe the operator-
 *                          actionable next step (e.g. "provision
 *                          IDENTUUM_AG_CE_OPERATOR_TOKEN_FILE"). NO
 *                          actionable CTAs.
 *   readiness_unknown   — AG CE could not be probed (unconfigured /
 *                          unreachable / malformed body). The UI
 *                          renders a neutral "AG status unavailable"
 *                          state. NO actionable CTAs.
 */
export type AGCEOrgLinkAvailability =
  | { state: "actionable" }
  | { state: "capability_missing" }
  | { state: "readiness_pending"; reasons: string[] }
  | { state: "readiness_unknown"; reason: "not_configured" | "ag_unavailable" | "error" };

/**
 * Derives the AG CE org-link UI availability verdict from the two
 * input signals.
 *
 * Decision matrix (capability × readiness):
 *
 *                   readiness:ok                readiness:!ok
 *   cap:true   →    cap:true + ready:true       readiness_pending
 *                   →  actionable               (notes from probe)
 *                   cap:true + !ready
 *                   →  readiness_pending
 *
 *   cap:!true  →    capability_missing          capability_missing
 *
 * The capability check fires FIRST so an operator who has deployed
 * AG CE without flipping OrganizationLinking sees the
 * capability_missing state regardless of readiness — preventing the
 * UI from advertising a capability the operator deliberately did
 * not enable.
 *
 * The readiness_unknown branch is reached only when capability is
 * true AND the readiness probe failed (network / unconfigured /
 * malformed body). A capability of false short-circuits to
 * capability_missing even when readiness is unknown.
 */
export function deriveAGCEOrgLinkAvailability(
  agCapabilities: ComponentCapabilities | null | undefined,
  readiness: AGOrgLinkReadinessResult
): AGCEOrgLinkAvailability {
  const cap = agCapabilities?.organization_linking === true;
  if (!cap) return { state: "capability_missing" };

  if (readiness.status === "ok") {
    if (readiness.readiness.configured && readiness.readiness.ready) {
      return { state: "actionable" };
    }
    // Surface the AG CE editorial notes verbatim — they are bounded
    // operator-readable strings by AG CE contract.
    return { state: "readiness_pending", reasons: [...readiness.readiness.notes] };
  }

  // Non-ok readiness with capability=true → readiness_unknown.
  return { state: "readiness_unknown", reason: readiness.status };
}
