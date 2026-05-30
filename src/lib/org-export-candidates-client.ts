/**
 * org-export-candidates-client.ts
 *
 * Server-side fetch wrappers for the cross-system organization export-
 * candidates endpoints on IDP and AG. Both endpoints require an authenticated
 * operator/site_admin session on the respective backend; the UI forwards the
 * appropriate session credential without exposing it to browser code.
 *
 * IDP authenticates via the IDP session cookie (forwarded as Cookie header,
 * same pattern as listOrganizations in idp-admin-client.ts).
 * AG authenticates via the ag_operator_session bearer token (forwarded via
 * agRequest, same pattern as ag-org-link-write-client.ts).
 *
 * Security:
 *   - server-only: client components may not import this module
 *   - internal backend URLs, session cookies, and bearer tokens never reach
 *     the browser
 *   - raw backend error bodies are never surfaced — callers receive a safe
 *     opaque reason string
 *   - organization-only: never reads or returns users, admins, credentials,
 *     MFA state, role bindings, sessions, tokens, or license payloads
 */
import "server-only";

import { cookies } from "next/headers";
import { agRequest, getAgOperatorToken } from "./ag-client";
import { parseOrganizationExportCandidatesResponse } from "./org-export-candidates";
import type { OrgExportFetchResult } from "./org-export-candidates";
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";
import { getServerRuntimeState } from "./server-runtime-state";

const IDP_TIMEOUT_MS = 5000;
const AG_TIMEOUT_MS = 5000;

/**
 * Builds a Cookie header from the inbound request cookies, mirroring the
 * existing pattern in idp-admin-client.ts.
 */
async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/**
 * Fetches IDP organization export candidates from
 * GET /api/v1/organizations/export-candidates on the IDP backend.
 *
 * Returns one of:
 *   - { ok: true, organizations: [...] }
 *   - { ok: false, reason: "not_configured" }   — UI runtime config has no IDP
 *   - { ok: false, reason: "not_ready" }        — IDP discovery says not usable
 *   - { ok: false, reason: "unauthorized" }     — 401 or 403 from backend
 *   - { ok: false, reason: "unreachable" }      — network, timeout, non-200, bad body
 */
export async function fetchIDPOrganizationExportCandidates(): Promise<OrgExportFetchResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) return { ok: false, reason: "not_configured" };

  const state = await getServerRuntimeState();
  if (!state?.components.idp.usable) {
    return { ok: false, reason: "not_ready" };
  }

  const url = `${idpBaseUrl(cfg).replace(/\/$/, "")}/api/v1/organizations/export-candidates`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Cookie: await cookieHeader(), Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!res.ok) {
    return { ok: false, reason: "unreachable" };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  const parsed = parseOrganizationExportCandidatesResponse(raw, "identuum-idp");
  return { ok: true, organizations: parsed.organizations };
}

/**
 * Fetches AG organization export candidates from
 * GET /api/v1/organizations/export-candidates on the AG management surface.
 *
 * Returns one of:
 *   - { ok: true, organizations: [...] }
 *   - { ok: false, reason: "not_configured" }   — AG not enabled in runtime config
 *   - { ok: false, reason: "not_ready" }        — AG discovery says not usable
 *   - { ok: false, reason: "unauthorized" }     — no operator session, or 401/403
 *   - { ok: false, reason: "unreachable" }      — network, timeout, non-200, bad body
 */
export async function fetchAGOrganizationExportCandidates(): Promise<OrgExportFetchResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg?.ag.enabled) return { ok: false, reason: "not_configured" };

  const state = await getServerRuntimeState();
  if (!state?.components.ag.usable) {
    return { ok: false, reason: "not_ready" };
  }

  // AG endpoint is behind the operator AuthChain. If no operator session is
  // present we treat it as unauthorized without making the request.
  const token = await getAgOperatorToken();
  if (!token) {
    return { ok: false, reason: "unauthorized" };
  }

  let res: Response | null;
  try {
    res = await agRequest("/api/v1/organizations/export-candidates", {
      method: "GET",
      signal: AbortSignal.timeout(AG_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (!res) {
    // agRequest returns null when AG is not configured or no token; both were
    // already covered above. Treat as not_configured defensively.
    return { ok: false, reason: "not_configured" };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!res.ok) {
    return { ok: false, reason: "unreachable" };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  const parsed = parseOrganizationExportCandidatesResponse(raw, "identuum-ag");
  return { ok: true, organizations: parsed.organizations };
}
