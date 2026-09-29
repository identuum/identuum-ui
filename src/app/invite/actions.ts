"use server";

/**
 * OSS-ONBOARD-B (D-016): redeem a user invite (identuum-idp-oss,
 * capabilities.user_invite; the contract is OSS-ONBOARD-A's, wiki log/0245).
 *
 *   GET  /api/v1/auth/invite/:token → 200 {success, email} | 400 invalid_token | 429
 *   POST /api/v1/auth/invite {token, password}
 *        → 200 {success}
 *        → 400 {"error":"weak_password"}  (the link stays usable)
 *        → 400 {"error":"invalid_token"}  (unknown, expired or spent — one answer)
 *        → 429                            (limited like sign-in)
 *
 * Redeeming sets the password and makes the user verified and active; no
 * session is minted — the user signs in next, and MFA follows the
 * organization's policy there. The token and the password are never logged
 * or returned.
 */
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { INVITE_RATE_LIMITED_COPY } from "./invite-copy";

export type InviteValidation =
  | { state: "valid"; email: string }
  | { state: "invalid" }
  | { state: "rate_limited" }
  | { state: "unavailable" };

export async function validateInviteToken(rawToken: string): Promise<InviteValidation> {
  if (!rawToken) return { state: "invalid" };
  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) return { state: "unavailable" };
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/auth/invite/${encodeURIComponent(rawToken)}`,
      { cache: "no-store" }
    );
    if (res.status === 429) return { state: "rate_limited" };
    if (res.status === 400 || res.status === 404) return { state: "invalid" };
    if (!res.ok) return { state: "unavailable" };
    const data = (await res.json()) as { success?: unknown; email?: unknown };
    if (data.success !== true || typeof data.email !== "string") return { state: "invalid" };
    return { state: "valid", email: data.email };
  } catch {
    return { state: "unavailable" };
  }
}

export interface RedeemInviteState {
  phase: "form" | "success" | "invalid";
  error?: string;
}

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

export async function redeemInviteAction(
  _prev: RedeemInviteState,
  formData: FormData
): Promise<RedeemInviteState> {
  const token = ((formData.get("token") as string | null) ?? "").trim();
  const password = (formData.get("password") as string | null) ?? "";
  const confirm = (formData.get("confirm") as string | null) ?? "";
  if (!token) return { phase: "invalid" };
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return {
      phase: "form",
      error: `Choose a password of ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.`,
    };
  }
  if (password !== confirm) return { phase: "form", error: "The passwords do not match." };
  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) {
    return { phase: "form", error: "Service unavailable. Please try again later." };
  }
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/auth/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
      cache: "no-store",
    });
    if (res.ok) return { phase: "success" };
    if (res.status === 429) return { phase: "form", error: INVITE_RATE_LIMITED_COPY };
    let code = "";
    try {
      const body = (await res.json()) as { error?: unknown };
      code = typeof body.error === "string" ? body.error : "";
    } catch {
      // fall through to the generic answer
    }
    if (code === "weak_password") {
      return {
        phase: "form",
        error: "That password does not meet your organization's password rule. Choose another.",
      };
    }
    if (code === "invalid_token") return { phase: "invalid" };
    return { phase: "form", error: "Could not set the password right now. Try again." };
  } catch {
    return {
      phase: "form",
      error: "Could not reach the identity provider. Try again in a moment.",
    };
  }
}
