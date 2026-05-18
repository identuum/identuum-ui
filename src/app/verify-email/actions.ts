"use server";

/**
 * Server actions for the /verify-email page.
 *
 * verifyEmailToken — backend contract (GET /api/v1/auth/verify-email?token=...):
 *   - 200 { success: true }  — token valid and email marked verified
 *   - 400 { error: "..." }   — token missing, invalid, or expired
 *   - Token is one-time use and expires in 24 hours.
 *   - No session is created; user must sign in via /login after verification.
 *
 * resendVerificationAction — backend contract (POST /api/v1/auth/resend-verification):
 *   - Body: { email: string }
 *   - Always HTTP 200 { success: true, message: "..." } regardless of whether the
 *     email exists (oracle-hardened; prevents account enumeration).
 *   - Rate-limited server-side by registerLimiter.
 *   - This action always returns { phase: "sent" } regardless of backend response,
 *     preserving the anti-enumeration property on the UI side as well.
 *
 * Security:
 *   - Tokens are not logged.
 *   - Server actions call the IdP directly via idpBaseUrl() (internal URL when configured),
 *     consistent with idp-admin-client.ts. Browser-facing proxy paths (/api/idp/...) are
 *     not used here — those are for browser-side code only (see idp-client.ts).
 *   - No localStorage/sessionStorage usage.
 */

import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";

export type VerifyEmailResult = { status: "success" } | { status: "invalid" } | { status: "error" };

export type ResendState = { phase: "idle" } | { phase: "sent" };

/**
 * Verifies an email verification token via the backend.
 * Returns { status: "success" } when the token is valid.
 * Returns { status: "invalid" } for any invalid/expired/already-used token (oracle-hardened).
 * Returns { status: "error" } on unexpected network or server failure.
 * Never throws — all error paths return a typed result.
 */
export async function verifyEmailToken(rawToken: string): Promise<VerifyEmailResult> {
  if (!rawToken || typeof rawToken !== "string") {
    return { status: "invalid" };
  }
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { status: "error" };
  try {
    const url = `${idpBaseUrl(cfg)}/api/v1/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });
    if (res.ok) {
      return { status: "success" };
    }
    // 400 = invalid/expired/already-used token
    return { status: "invalid" };
  } catch {
    return { status: "error" };
  }
}

/**
 * Requests a new verification email for the given address.
 *
 * Always returns { phase: "sent" } regardless of backend response — the backend
 * is oracle-hardened (always 200) and this action preserves that property so the
 * UI never leaks whether an account exists.
 * Backend errors are silently discarded; the user sees a generic success message.
 */
export async function resendVerificationAction(
  _prev: ResendState,
  formData: FormData
): Promise<ResendState> {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  if (!email) return { phase: "idle" };

  const cfg = loadRuntimeConfig();
  if (cfg?.idp.enabled) {
    try {
      await fetch(`${idpBaseUrl(cfg)}/api/v1/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        cache: "no-store",
      });
    } catch {
      // Discard all errors — backend is oracle-hardened; UI must not expose failure.
    }
  }

  return { phase: "sent" };
}
