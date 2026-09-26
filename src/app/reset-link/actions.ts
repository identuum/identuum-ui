"use server";

/**
 * CE-UI-2b: redeem an admin-issued one-time password reset link
 * (identuum-idp-ce; the IdP sends no mail, so an org_admin creates the link
 * and hands it over).
 *
 *   GET  /api/v1/auth/reset-link/validate?token= → {"valid":bool}
 *   POST /api/v1/auth/reset-link {token,new_password}
 *        → 200 {"success":true}
 *        → 400 {"error":"weak_password"}  (the link stays usable)
 *        → 400 {"error":"invalid_token"}  (used, expired or replaced)
 *
 * The token and the password are never logged or returned. Redeeming signs
 * the user out everywhere and leaves the authenticator enrolled.
 */
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";

export async function validateResetLinkToken(rawToken: string): Promise<boolean> {
  if (!rawToken) return false;
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return false;
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/auth/reset-link/validate?token=${encodeURIComponent(rawToken)}`,
      { method: "GET", cache: "no-store" }
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { valid?: unknown };
    return body.valid === true;
  } catch {
    return false;
  }
}

export interface RedeemResetLinkState {
  phase: "form" | "success" | "invalid";
  error?: string;
}

const MIN_PASSWORD = 12;

export async function redeemResetLinkAction(
  _prev: RedeemResetLinkState,
  formData: FormData
): Promise<RedeemResetLinkState> {
  const token = ((formData.get("token") as string | null) ?? "").trim();
  const password = (formData.get("new_password") as string | null) ?? "";
  const confirm = (formData.get("confirm_password") as string | null) ?? "";
  if (!token) return { phase: "invalid" };
  if (password.length < MIN_PASSWORD) {
    return { phase: "form", error: `Choose a password of at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== confirm) {
    return { phase: "form", error: "The passwords do not match." };
  }
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { phase: "invalid" };
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/auth/reset-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password: password }),
      cache: "no-store",
    });
    if (res.ok) return { phase: "success" };
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
        error: "That password does not meet this installation's password rule. Choose another.",
      };
    }
    if (code === "invalid_token") return { phase: "invalid" };
    return { phase: "form", error: "Could not reset the password right now. Try again." };
  } catch {
    return {
      phase: "form",
      error: "Could not reach the identity provider. Try again in a moment.",
    };
  }
}
