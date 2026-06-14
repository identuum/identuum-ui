/**
 * Server-side client for authenticated account self-service IdP APIs.
 *
 * This module intentionally avoids the broader idp-admin-client surface so
 * account settings can use the OSS /api/v1/me/* endpoints without disturbing
 * the heavily dirty admin-client worktree.
 */
import "server-only";

import { cookies } from "next/headers";
import { idpBaseUrl, loadRuntimeConfig } from "./runtime-config";

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function routeUnavailable(status: number): boolean {
  return status === 404 || status === 501 || status === 503;
}

export interface SessionItem {
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

export async function listOwnSessions(): Promise<ListSessionsResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { ok: false, status: 503, unavailable: true };

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/me/sessions`, {
      method: "GET",
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false, status: res.status, unavailable: routeUnavailable(res.status) };
    }

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before sanitization
    const data: any = await res.json();
    const raw = Array.isArray(data.sessions) ? (data.sessions as Record<string, unknown>[]) : [];
    const sessions: SessionItem[] = raw.map((s) => ({
      created_at: String(s.created_at ?? ""),
      expires_at: String(s.expires_at ?? ""),
      last_used_at: s.last_seen_at ? String(s.last_seen_at) : null,
      ip_address: s.ip_address ? String(s.ip_address) : null,
      user_agent: s.user_agent ? String(s.user_agent) : null,
      is_active: true,
      is_current: Boolean(s.current_session),
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

function failedMutation(status: number): AccountMutationFailure {
  return {
    ok: false,
    status,
    unavailable: routeUnavailable(status),
    unauthorized: status === 401,
    forbidden: status === 403,
    notEnrolled: status === 400,
    invalidProof: status === 401,
  };
}

async function postNoBody(path: string): Promise<AccountMutationResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return failedMutation(503);

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}${path}`, {
      method: "POST",
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });
    if (!res.ok) return failedMutation(res.status);
    return { ok: true };
  } catch {
    return failedMutation(0);
  }
}

export function revokeCurrentSession(): Promise<AccountMutationResult> {
  return postNoBody("/api/v1/me/sessions/revoke-current");
}

export function revokeOtherSessions(): Promise<AccountMutationResult> {
  return postNoBody("/api/v1/me/sessions/revoke-others");
}

export function revokeAllSessions(): Promise<AccountMutationResult> {
  return postNoBody("/api/v1/me/sessions/revoke-all");
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
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/me/mfa/status`, {
      method: "GET",
      headers: { Cookie: await cookieHeader() },
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

export async function regenerateOwnMfaRecoveryCodes(): Promise<RecoveryCodesResult> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return failedMutation(503);

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/me/mfa/recovery-codes/regenerate`, {
      method: "POST",
      headers: { Cookie: await cookieHeader() },
      cache: "no-store",
    });

    if (!res.ok) return failedMutation(res.status);

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
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/me/mfa/disable`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await cookieHeader(),
      },
      body: JSON.stringify({ code: input.code ?? "", password: input.password ?? "" }),
      cache: "no-store",
    });

    if (!res.ok) return failedMutation(res.status);
    return { ok: true };
  } catch {
    return failedMutation(0);
  }
}
