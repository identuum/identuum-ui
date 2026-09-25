/**
 * Server-side client for authenticated account self-service IdP APIs.
 *
 * This module intentionally avoids the broader idp-admin-client surface so
 * account settings can use the OSS /api/v1/me/* endpoints without disturbing
 * the heavily dirty admin-client worktree.
 */
import "server-only";

import { idpAuthHeaders, idpFetch } from "./idp-transport";
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";

/**
 * Server-side IdP auth headers: forwards the httpOnly cookie jar AND lifts the
 * access_token cookie into Authorization: Bearer — released OSS resource
 * endpoints establish the principal ONLY from the Authorization header
 * (mw.BearerPrincipal never reads the cookie). Token stays server-side
 * (`server-only` module); never logged, never returned to the browser.
 */

function routeUnavailable(status: number): boolean {
  return status === 404 || status === 501 || status === 503;
}

export interface SessionItem {
  /**
   * Opaque per-session revocation handle (the external_sid / OIDC `sid`
   * claim). Used ONLY to target a revoke; never rendered as visible text.
   */
  id: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  is_active: boolean;
  is_current: boolean;
}

export type ListSessionsResult =
  | { ok: true; sessions: SessionItem[] }
  | { ok: false; status: number; unavailable: boolean };

/**
 * Lists the caller's OWN active sessions.
 *
 * Uses the self-service Family-A endpoint GET /api/v1/sessions, which is
 * mounted on BOTH IDP OSS and IDP CE. The OSS-only `/me/sessions` family
 * (404 on CE) was the cause of the "Session management is not available from
 * this IDP runtime" account-settings regression on CE customer-smoke. The
 * `current` row is badged via is_current; CE serializes
 * the flag as `current`, OSS as `is_current`, so we accept either.
 */
export async function listOwnSessions(): Promise<ListSessionsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, unavailable: true };

  try {
    const res = await idpFetch(`${idpBaseUrl(cfg)}/api/v1/sessions`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false, status: res.status, unavailable: routeUnavailable(res.status) };
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const raw = Array.isArray(data.sessions) ? (data.sessions as Record<string, unknown>[]) : [];
    const sessions: SessionItem[] = raw.map((s) => ({
      id: String(s.id ?? ""),
      created_at: String(s.created_at ?? ""),
      expires_at: String(s.expires_at ?? ""),
      last_used_at: s.last_used_at
        ? String(s.last_used_at)
        : s.last_seen_at
          ? String(s.last_seen_at)
          : null,
      ip_address: s.ip_address ? String(s.ip_address) : null,
      user_agent: s.user_agent ? String(s.user_agent) : null,
      is_active: true,
      is_current: Boolean(s.is_current ?? s.current),
    }));

    return { ok: true, sessions };
  } catch {
    return { ok: false, status: 0, unavailable: false };
  }
}

export type AccountMutationResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      unavailable: boolean;
      unauthorized: boolean;
      forbidden: boolean;
      notEnrolled: boolean;
      invalidProof: boolean;
    };

type AccountMutationFailure = Extract<AccountMutationResult, { ok: false }>;

// THE-SIX-SMALL-ONES, UI 1 (2026-09-16): a 401 is one of two truths, and the
// IdP says which in its body. A refused PROOF is named — identuum-idp-oss
// answers `invalid_code`, identuum-idp-ce `invalid_proof` (both routes, both
// cause-neutral about WHY the proof failed, never about whether it was a
// proof at all). Anything else on a 401 — OSS `unauthorized` with a reason,
// CE `not_authenticated`, or no JSON body — is a session that is gone.
// Before this, every 401 set both flags and the forms told a signed-out
// user their code was wrong.
const PROOF_REFUSED_CODES = new Set(["invalid_code", "invalid_proof"]);

/** The IdP's `error` code from a refusal body, or undefined when there is none. */
async function serverErrorCode(res: Response): Promise<string | undefined> {
  try {
    const data: unknown = await res.json();
    const code = (data as { error?: unknown } | null)?.error;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function failedMutation(status: number, serverError?: string): AccountMutationFailure {
  const invalidProof =
    status === 401 && serverError !== undefined && PROOF_REFUSED_CODES.has(serverError);
  return {
    ok: false,
    status,
    unavailable: routeUnavailable(status),
    // On a 401 the two are exclusive: a refused proof is not a lost session.
    unauthorized: status === 401 && !invalidProof,
    forbidden: status === 403,
    notEnrolled: status === 400,
    invalidProof,
  };
}

/**
 * Revokes ONE of the caller's own sessions by its opaque id (external_sid).
 *
 * Each edition serves one route, and only that route is asked (owner decision
 * 5, 2026-09-25 — no try-then-fallback, so no failed request on either):
 *   - IDP CE: POST /api/v1/sessions/{id}/revoke (path param).
 *   - IDP OSS: POST /api/v1/revoke with a { session_id } body.
 * Both revoke by the SAME id that GET /api/v1/sessions returns, and both
 * enforce caller ownership server-side. Bulk semantics (current / others /
 * all) are orchestrated by the caller iterating the session list.
 */
export async function revokeSessionById(
  id: string,
  edition: "oss" | "ce"
): Promise<AccountMutationResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return failedMutation(503);
  if (!id) return failedMutation(404);

  const base = idpBaseUrl(cfg);
  const authHeaders = await idpAuthHeaders();
  try {
    const res =
      edition === "ce"
        ? await idpFetch(`${base}/api/v1/sessions/${encodeURIComponent(id)}/revoke`, {
            method: "POST",
            headers: authHeaders,
            cache: "no-store",
          })
        : await idpFetch(`${base}/api/v1/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ session_id: id }),
            cache: "no-store",
          });
    if (res.ok) return { ok: true };
    return failedMutation(res.status);
  } catch {
    return failedMutation(0);
  }
}

export interface MfaStatus {
  mfa_enabled: boolean;
  totp_enrolled: boolean;
  recovery_codes_remaining_count: number;
}

export type MfaStatusResult =
  | { ok: true; status: MfaStatus }
  | { ok: false; statusCode: number; unavailable: boolean; unauthorized: boolean };

export async function getOwnMfaStatus(): Promise<MfaStatusResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { ok: false, statusCode: 503, unavailable: true, unauthorized: false };
  }

  try {
    const res = await idpFetch(`${idpBaseUrl(cfg)}/api/v1/me/mfa/status`, {
      method: "GET",
      headers: await idpAuthHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        unavailable: routeUnavailable(res.status),
        unauthorized: res.status === 401,
      };
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    return {
      ok: true,
      status: {
        mfa_enabled: Boolean(data.mfa_enabled),
        totp_enrolled: Boolean(data.totp_enrolled),
        recovery_codes_remaining_count: Number(data.recovery_codes_remaining_count ?? 0),
      },
    };
  } catch {
    return { ok: false, statusCode: 0, unavailable: false, unauthorized: false };
  }
}

export type RecoveryCodesResult =
  | { ok: true; recoveryCodes: string[]; count: number }
  | AccountMutationFailure;

// THE-SELF-REPLENISHING-CODES (2026-09-10): identuum-idp-ce's regenerate
// takes a current authenticator (TOTP) code as its only proof — a
// recovery code is refused, so that a stolen session cannot mint fresh
// disable proofs. The code travels as the JSON body {code}; the IdP's
// refusal is one cause-neutral 401 invalid_proof.
export async function regenerateOwnMfaRecoveryCodes(input: {
  code: string;
}): Promise<RecoveryCodesResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return failedMutation(503);

  try {
    const res = await idpFetch(`${idpBaseUrl(cfg)}/api/v1/me/mfa/recovery-codes/regenerate`, {
      method: "POST",
      headers: await idpAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ code: input.code }),
      cache: "no-store",
    });

    if (!res.ok) return failedMutation(res.status, await serverErrorCode(res));

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const recoveryCodes = Array.isArray(data.recovery_codes)
      ? data.recovery_codes.map((c: unknown) => String(c))
      : [];
    const count = Number(data.count ?? recoveryCodes.length);
    return { ok: true, recoveryCodes, count };
  } catch {
    return failedMutation(0);
  }
}

export async function disableOwnMfa(input: {
  code?: string;
  password?: string;
}): Promise<AccountMutationResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return failedMutation(503);

  try {
    const res = await idpFetch(`${idpBaseUrl(cfg)}/api/v1/me/mfa/disable`, {
      method: "POST",
      headers: await idpAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ code: input.code ?? "", password: input.password ?? "" }),
      cache: "no-store",
    });

    if (!res.ok) return failedMutation(res.status, await serverErrorCode(res));
    return { ok: true };
  } catch {
    return failedMutation(0);
  }
}
