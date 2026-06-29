/**
 * ag-org-link-readiness-client.ts
 *
 * Server-only client for the AG CE pre-login org-link readiness probe.
 * Calls AG CE's GET /api/v1/org-link/readiness on the management surface.
 *
 * This endpoint is PRE-LOGIN — it does NOT require the operator-auth
 * gate (unlike /api/v1/org-link/plan + /organizations/{id} + PUT/DELETE
 * link/unlink which ARE behind RequireOperator). The body is bounded
 * editorial metadata: configured + ready + plan_endpoint +
 * detail_endpoint_pattern + notes. No org IDs, names, link statuses,
 * counts, operator tokens, or any privileged data are returned.
 *
 * SCOPE:
 *   - Read-only honesty probe. No link/unlink/import behaviour — those
 *     live in `ag-org-link-write-client.ts` and are NOT extended here.
 *   - Backend contract: AG CE 2026-06-24 wave 3 (org-link WRITE flow
 *     + fully-mounted readiness). See wiki/repos/identuum-ag-ce.md
 *     §"Latest landed slice — 2026-07-01" + §"AG CE org-link WRITE
 *     flow (2026-06-24)" for the canonical contract.
 *
 * Security:
 *   - Server-only: client components may not import this module.
 *   - No operator token / Authorization header attached (the route is
 *     pre-login by design).
 *   - Internal AG backend URL is never exposed to the response.
 *   - Raw AG error messages and unknown response fields are never
 *     forwarded.
 *   - Sensitive-looking keys on the wire (operator_id, idp_org_id,
 *     organizations, total, linked_count, unlinked_count, etc.) are
 *     NEVER copied through — the sanitiser only reads the documented
 *     bounded set.
 */
import "server-only";

import { agBaseUrl, loadRuntimeConfig } from "./runtime-config";

/**
 * Bounded wire shape returned by AG CE's
 * `GET /api/v1/org-link/readiness`. Matches the AG CE
 * `OrgLinkReadinessResponse` struct exactly (field-for-field parity);
 * unknown wire fields are dropped at sanitise time.
 */
export interface AGOrgLinkReadinessResponse {
  /** True when AG CE has the org-link planning store wired in-process. */
  configured: boolean;
  /** True when AG CE has the full read + write surface mounted behind operator-auth. */
  ready: boolean;
  /** Path of the auth-gated plan list route, or "" when not mounted. */
  plan_endpoint: string;
  /** Path pattern of the auth-gated detail route (with `{id}` placeholder), or "" when not mounted. */
  detail_endpoint_pattern: string;
  /** Editorial notes (bounded operator-readable hints; no PII / IDs / secrets). */
  notes: string[];
}

const DISCOVERY_TIMEOUT_MS = 5000;

/**
 * Classified client result. Discriminated by `status` so callers can
 * branch cleanly without re-deriving availability state.
 *
 *   ok               — 200 + bounded readiness body
 *   not_configured   — UI runtime config has no AG backend wired
 *   ag_unavailable   — network/timeout/non-2xx failure reaching AG CE
 *   error            — 2xx body whose shape does not match
 *                       AGOrgLinkReadinessResponse
 */
export type AGOrgLinkReadinessResult =
  | { status: "ok"; readiness: AGOrgLinkReadinessResponse }
  | { status: "not_configured" }
  | { status: "ag_unavailable" }
  | { status: "error" };

/**
 * Fetches the AG CE org-link readiness probe. The probe is pre-login
 * by design — no operator session cookie is forwarded. Never throws —
 * every failure mode maps to a discriminated variant of
 * `AGOrgLinkReadinessResult`.
 *
 * Uses a 5-second timeout to bound page-load latency when AG CE is
 * deployed but unreachable.
 */
export async function fetchAGOrgLinkReadiness(): Promise<AGOrgLinkReadinessResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.ag.enabled) return { status: "not_configured" };

  const base = agBaseUrl(cfg).replace(/\/$/, "");
  const url = `${base}/api/v1/org-link/readiness`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return { status: "ag_unavailable" };
  }
  clearTimeout(timer);

  if (!res.ok) return { status: "ag_unavailable" };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { status: "error" };
  }

  const sanitised = sanitiseReadiness(raw);
  if (!sanitised) return { status: "error" };
  return { status: "ok", readiness: sanitised };
}

/**
 * Validates and projects a raw JSON body to AGOrgLinkReadinessResponse.
 * Returns null if the shape does not match. Unknown fields are dropped;
 * sensitive-looking keys (operator_id, idp_org_id, organizations,
 * total, linked_count, unlinked_count, password, secret, private_key,
 * client_secret, etc.) are NEVER read or copied through.
 */
function sanitiseReadiness(raw: unknown): AGOrgLinkReadinessResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;

  if (typeof body.configured !== "boolean") return null;
  if (typeof body.ready !== "boolean") return null;
  if (typeof body.plan_endpoint !== "string") return null;
  if (typeof body.detail_endpoint_pattern !== "string") return null;
  if (!Array.isArray(body.notes)) return null;

  const notes: string[] = [];
  for (const n of body.notes) {
    if (typeof n !== "string") return null;
    notes.push(n);
  }

  return {
    configured: body.configured,
    ready: body.ready,
    plan_endpoint: body.plan_endpoint,
    detail_endpoint_pattern: body.detail_endpoint_pattern,
    notes,
  };
}
