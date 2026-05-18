"use server";

/**
 * Server action for consuming an org-admin claim token.
 *
 * Backend contract (GET /api/v1/auth/claim/validate, POST /api/v1/auth/claim):
 *   - All responses are HTTP 200 regardless of token validity (oracle-hardening).
 *   - validate: { valid: bool, organization_name?, target_email? }
 *   - consume success: { success: true }
 *   - consume failure: { success: false }
 *   - consume password violation: { success: false, message, attempts_remaining }
 *   - consume max attempts: { success: false, message, attempts_exhausted: true }
 *   - Token is one-time-use, bound to target_email, expires in 48h.
 *   - No session is created after consumption; user must log in separately.
 *
 * Security:
 *   - Token is not logged.
 *   - Password is not logged.
 *   - No localStorage/sessionStorage usage.
 *   - Server actions call the IdP directly via idpBaseUrl() (internal URL when configured),
 *     consistent with idp-admin-client.ts. Browser-facing proxy paths (/api/idp/...) are
 *     not used here — those are for browser-side code only (see idp-client.ts).
 */

import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValidateClaimResult {
  valid: boolean;
  organizationName?: string;
  /**
   * Present and non-empty for email-bound tokens. Absent for no-email tokens
   * (backend omits the field when target_email is empty). The UI uses this to
   * decide whether the email field is locked (email-bound) or user-editable (no-email).
   */
  targetEmail?: string;
}

export interface ConsumeClaimState {
  phase: "form" | "success" | "exhausted" | "invalid";
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password" | "confirmPassword" | "name", string>>;
  attemptsRemaining?: number;
  /** Success: true after token is fully consumed */
  success?: boolean;
}

// ── Validate token (called server-side on page load) ──────────────────────────

/**
 * Validates a raw claim token via the backend validate endpoint.
 * Returns { valid: false } for any invalid/expired/missing token (oracle-hardened).
 * Never throws — returns { valid: false } on network error.
 */
export async function validateClaimToken(rawToken: string): Promise<ValidateClaimResult> {
  if (!rawToken || typeof rawToken !== "string") {
    return { valid: false };
  }
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { valid: false };
  try {
    const url = `${idpBaseUrl(cfg)}/api/v1/auth/claim/validate?token=${encodeURIComponent(rawToken)}`;
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { valid: false };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
    const body: any = await res.json();
    return {
      valid: Boolean(body.valid),
      organizationName:
        typeof body.organization_name === "string" ? body.organization_name : undefined,
      targetEmail: typeof body.target_email === "string" ? body.target_email : undefined,
    };
  } catch {
    return { valid: false };
  }
}

// ── Consume token (server action) ─────────────────────────────────────────────

const consumeSchema = z.object({
  token: z.string().min(1, "Missing claim token"),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address")
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, "Password is required"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
  name: z.string().max(255).optional(),
});

/**
 * Consumes a claim token to set up the first org_admin account.
 *
 * After successful consumption:
 *   - The org is activated and the user account exists.
 *   - No session is created — the user must sign in via /login.
 *   - The token is permanently burned (one-time use).
 */
export async function consumeClaimAction(
  _prev: ConsumeClaimState,
  formData: FormData
): Promise<ConsumeClaimState> {
  const raw = {
    token: formData.get("token"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    name: formData.get("name"),
  };

  const parsed = consumeSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      phase: "form",
      fieldErrors: {
        email: flat.email?.[0],
        password: flat.password?.[0],
        confirmPassword: flat.confirmPassword?.[0],
        name: flat.name?.[0],
      },
    };
  }

  const { token, email, password, confirmPassword, name } = parsed.data;

  // Client-side confirm-password check (backend does not validate this)
  if (password !== confirmPassword) {
    return {
      phase: "form",
      fieldErrors: { confirmPassword: "Passwords do not match" },
    };
  }

  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { phase: "form", error: "Service unavailable. Please try again later." };
  }

  // POST to backend — token, email, password, optional name.
  // All backend errors return HTTP 200 with { success: false } (oracle-hardening).
  const body: Record<string, string> = {
    token,
    email,
    password,
    ...(name?.trim() ? { name: name.trim() } : {}),
  };

  let resBody: Record<string, unknown>;
  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/auth/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      // Non-200 would be unusual given oracle-hardening, but handle defensively.
      return { phase: "form", error: "Setup failed. Please try again or request a new link." };
    }
    // biome-ignore lint/suspicious/noExplicitAny: raw API response
    resBody = (await res.json()) as any;
  } catch {
    return { phase: "form", error: "Network error. Please check your connection and try again." };
  }

  // Max attempts exhausted — token is burned, user needs a new link.
  if (resBody.attempts_exhausted === true) {
    return {
      phase: "exhausted",
      error:
        typeof resBody.message === "string"
          ? resBody.message
          : "Maximum password attempts reached. Please contact your administrator for a new setup link.",
    };
  }

  // Password policy violation — token still valid, show remaining attempts.
  if (resBody.success === false && typeof resBody.attempts_remaining === "number") {
    return {
      phase: "form",
      attemptsRemaining: resBody.attempts_remaining as number,
      error:
        typeof resBody.message === "string"
          ? resBody.message
          : "Password does not meet complexity requirements.",
    };
  }

  // Generic failure — invalid/expired/email-mismatch/already consumed.
  if (resBody.success !== true) {
    return {
      phase: "invalid",
      error:
        "This setup link is invalid, expired, or has already been used. Please contact your administrator for a new link.",
    };
  }

  // Success — org activated, account created. User must sign in.
  return { phase: "success", success: true };
}
