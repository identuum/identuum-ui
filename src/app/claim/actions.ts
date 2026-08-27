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

import { z } from "zod";
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";

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
  /**
   * Phase semantics:
   *   - "form"      → initial render or recoverable validation error.
   *   - "mfa_setup" → claim consumed AND a pending MFA-enrollment session
   *                   was opened via /auth/login (server-side). The
   *                   sessionId field carries the pending session the UI
   *                   uses to call mfaEnrollInitiate/Complete from the
   *                   browser. The IdP refuses to mint session-bearing
   *                   tokens for an admin without MFA, so this phase is
   *                   where the user MUST verify a TOTP code before
   *                   becoming operational.
   *   - "success"   → terminal state. Used when the claim succeeded but
   *                   the post-claim login probe could not be opened
   *                   (network blip, IdP transient error). The UI falls
   *                   back to "go to /login" so the user can retry —
   *                   the backend login gate still enforces MFA on the
   *                   next login attempt.
   *   - "exhausted" → claim token burned (max wrong-password attempts).
   *   - "invalid"   → token unknown/expired/already-consumed.
   */
  phase: "form" | "mfa_setup" | "success" | "exhausted" | "invalid";
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password" | "confirmPassword" | "name", string>>;
  attemptsRemaining?: number;
  /** Success: true after token is fully consumed */
  success?: boolean;
  /**
   * Pending MFA-enrollment session id. Populated only when phase ===
   * "mfa_setup". The UI passes this into the existing MFAEnrollForm
   * component to drive TOTP enrollment + verification. Never the value
   * itself appears in URLs, localStorage, or logs; it lives in React
   * state for the duration of the enrollment step only.
   */
  sessionId?: string;
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

  // Claim consumed successfully. The user account now exists and the
  // organisation is active, but per the platform's MFA invariant an
  // org_admin without MFA cannot receive session-bearing tokens. To
  // guide the user through TOTP enrollment without a second navigation,
  // we open a pending login session server-side using the same
  // credentials the user just set and surface its session_id to the
  // UI. The client then renders MFAEnrollForm against this pending
  // session — same machinery the regular login flow uses.
  //
  // SECURITY: the password is consumed and discarded here. It is never
  // returned to the browser, never logged, and never persisted. The
  // session_id is a non-secret pending-session identifier; it is
  // surfaced to the React tree for the duration of the enrollment step
  // and never written to URLs or storage.
  const pendingSessionID = await openPendingMFAEnrollmentSession(idpBaseUrl(cfg), email, password);
  if (pendingSessionID) {
    return { phase: "mfa_setup", success: true, sessionId: pendingSessionID };
  }

  // Defensive fallback: if the post-claim login probe could not be
  // opened (transient IdP error, network blip), surface the legacy
  // "go to /login" success state. The backend login gate will still
  // force MFA enrollment on the next manual login attempt, so this
  // path does not weaken the invariant — it just degrades the UX.
  return { phase: "success", success: true };
}

// openPendingMFAEnrollmentSession issues a server-side login request
// with the credentials the user just supplied and returns the pending
// session_id when the IdP responds with mfa_required=true. Returns the
// empty string on any non-pending outcome (network error, missing
// fields, unexpected response shape) so the caller can fall back to
// the legacy /login redirect. Never throws.
//
// This indirection exists so the claim flow can chain directly into
// MFA enrollment without holding the password in client state. The
// password is given to the IdP exactly once and discarded.
async function openPendingMFAEnrollmentSession(
  idpURL: string,
  email: string,
  password: string
): Promise<string> {
  try {
    const res = await fetch(`${idpURL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    // MEASURED (THE-DEAD-ACTIVATE-LINK, proven live): an enrollment-required
    // login answers HTTP 401 {"error":"mfa_enrollment_required",
    // mfa_required:true, session_id} — the pending session rides on a 401,
    // not a 200. Requiring res.ok here silently dropped the MFA chaining
    // and dumped the user at manual login.
    if (!res.ok && res.status !== 401) return "";
    // biome-ignore lint/suspicious/noExplicitAny: raw API response
    const body: any = await res.json();
    if (body?.mfa_required === true && typeof body.session_id === "string" && body.session_id) {
      return body.session_id;
    }
    return "";
  } catch {
    return "";
  }
}
