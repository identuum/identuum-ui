/**
 * Browser-side typed client for IdP API calls.
 *
 * All calls go through the same-origin /api/idp/... proxy — never to the
 * IdP public URL directly. The proxy strips browser-supplied X-Forwarded-*
 * headers, rewrites Set-Cookie (Domain stripped, SameSite=None→Lax), and
 * routes to the IdP using internal_base_url when configured.
 *
 * Functions in this module must only be called when idp.enabled === true in
 * the runtime config. In AG-only deployments, the login page is not rendered
 * and none of these functions are reached.
 *
 * Tokens remain cookie-only. No localStorage/sessionStorage usage here.
 */

import { IDP_PATHS } from "./idp-paths";
import type { OrgConfig, UserRole, ValidateResponse } from "./types";
import { ApiError } from "./ui-api";

// Re-export paths as IDP for backward compatibility with existing callers.
export const IDP = IDP_PATHS;

/**
 * Looks up an organization by domain.
 * Returns null when no organization matches (HTTP 404).
 * Throws ApiError for unexpected errors.
 */
export async function orgLookup(domain: string): Promise<OrgConfig | null> {
  const res = await fetch(`${IDP.orgLookup}?domain=${encodeURIComponent(domain)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, "Organization lookup failed");
  return res.json() as Promise<OrgConfig>;
}

export type LoginOutcome =
  | {
      kind: "mfa_enrollment_required";
      /**
       * Pending session token for the enrollment flow.
       * null when the backend did not open a pending enrollment session
       * (OSS backend: HTTP 401 + {"error":"mfa_enrollment_required"} — no session_id).
       * Callers must show an enrollment-required message without starting the
       * enrollment form when this is null.
       */
      sessionId: string | null;
    }
  | { kind: "mfa_required"; sessionId: string }
  | { kind: "success"; role: UserRole };

interface LoginPayload {
  email: string;
  password: string;
  remember_me: boolean;
  org_slug?: string;
}

/**
 * Submits password credentials.
 * Returns a discriminated union:
 *   { kind: "mfa_required", sessionId } — caller should start MFA step
 *   { kind: "success", role }           — login complete, caller routes by role
 * Throws ApiError on HTTP error (401 = invalid credentials).
 *
 * IMPORTANT: The IdP returns HTTP 200 with success:false when MFA is required.
 * success:false does NOT mean login failed — it means the flow is not yet complete.
 * We check mfa_required BEFORE checking !res.ok or body.success to avoid
 * mis-treating a valid MFA-required response as a failure.
 */
export async function login(payload: LoginPayload): Promise<LoginOutcome> {
  const res = await fetch(IDP.login, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  // Parse body before checking res.ok.
  // The IdP returns HTTP 200 with { mfa_required: true, session_id: "...", success: false }
  // for a valid password that requires MFA. success:false here means the full login
  // is not yet complete — it is NOT a failure indicator.
  // biome-ignore lint/suspicious/noExplicitAny: raw API response, discriminated below
  const body: any = await res.json();

  // MFA enrollment required (more specific): valid admin credentials but no TOTP
  // configured — must go through first-login enrollment before access is granted.
  // Check this BEFORE the generic mfa_required branch.
  if (body.mfa_required === true && body.mfa_enrollment_required === true) {
    if (typeof body.session_id === "string" && body.session_id.length > 0) {
      return { kind: "mfa_enrollment_required", sessionId: body.session_id };
    }
    throw new ApiError(0, "MFA enrollment required but server did not return a session token");
  }

  // MFA required: valid credentials, next step is TOTP verification.
  // session_id must be a non-empty string to be usable.
  if (body.mfa_required === true) {
    if (typeof body.session_id === "string" && body.session_id.length > 0) {
      return { kind: "mfa_required", sessionId: body.session_id };
    }
    // mfa_required but no usable session_id — unexpected backend state.
    throw new ApiError(0, "MFA required but server did not return a session token");
  }

  // D-1 (agent-a-20260705-idp-ce-org-admin-authpolicy-local-login-bypass):
  // organization auth_policy=idp_only refuses local-password login for
  // NON-admin users. The backend now exempts site_admin AND org_admin
  // (org.Role.CanAdminister()) — those credential flows succeed and reach the
  // `success` return below — so a 401 + {"error":"auth_policy_blocks_local_login"}
  // here ALWAYS denotes a regular org_user whose organization disallows local
  // login, NOT a wrong password. Surface it with a distinct sentinel so the
  // caller renders an honest "local sign-in not available" message instead of
  // "Invalid credentials.". The role/policy decision is made ENTIRELY by the
  // backend; the UI adds NO client-side role logic. (Mirrors the
  // SESSION_EXPIRED sentinel-message pattern used by mfaVerify below.)
  // Checked BEFORE the generic !res.ok path; placed before the
  // mfa_enrollment_required check so the two distinct 401 error codes each get
  // their own outcome.
  if (
    res.status === 401 &&
    typeof body.error === "string" &&
    body.error === "auth_policy_blocks_local_login"
  ) {
    throw new ApiError(res.status, "AUTH_POLICY_BLOCKS_LOCAL_LOGIN");
  }

  // OSS backend: HTTP 401 + {"error":"mfa_enrollment_required"} — no session_id.
  // Fires when MFA is required but the user has not yet enrolled a TOTP secret.
  // Must be checked BEFORE the generic !res.ok path so the caller receives a
  // distinct outcome instead of "Invalid credentials."
  if (
    res.status === 401 &&
    typeof body.error === "string" &&
    body.error === "mfa_enrollment_required"
  ) {
    return { kind: "mfa_enrollment_required", sessionId: null };
  }

  // Non-2xx status means authentication failure (e.g. 401 = wrong password).
  if (!res.ok) {
    throw new ApiError(res.status, "Invalid credentials");
  }

  return { kind: "success", role: body.role ?? "org_user" };
}

/**
 * Submits the TOTP code to complete MFA login.
 * Returns { role } on success.
 * Throws ApiError; message is "SESSION_EXPIRED" when the IdP signals the
 * pending session is gone — callers should redirect to /login?reason=session_expired.
 */
export async function mfaLogin(sessionId: string, code: string): Promise<{ role: UserRole }> {
  const res = await fetch(IDP.mfaLogin, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ session_id: sessionId, code }),
  });
  if (!res.ok) {
    let errMsg = "";
    try {
      const b = await res.json();
      errMsg = String(b?.error ?? "");
    } catch {
      // Ignore non-JSON body.
    }
    if (errMsg.includes("session invalid") || errMsg.includes("session not found")) {
      throw new ApiError(res.status, "SESSION_EXPIRED");
    }
    throw new ApiError(res.status, "Invalid verification code");
  }
  const body = await res.json();
  return { role: body.role ?? "org_user" };
}

/**
 * Validates the current session.
 * Returns null when unauthenticated (HTTP 401) — caller should redirect to login.
 * Throws ApiError for unexpected server errors.
 */
export async function validateSession(): Promise<ValidateResponse | null> {
  const res = await fetch(IDP.validate, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiError(res.status, "Session validation failed");
  return res.json() as Promise<ValidateResponse>;
}

/**
 * Logs out by POSTing to the IdP logout endpoint via proxy.
 * Used programmatically (e.g., after session expiry). The dashboard layout
 * uses a <form> POST for the user-visible Sign out button.
 */
export async function logout(): Promise<void> {
  await fetch(IDP.logout, {
    method: "POST",
    credentials: "include",
  });
}

/**
 * Initiates TOTP enrollment for an admin user who has no OTP configured.
 * Returns the TOTP secret, the otpauth:// provisioning URL, and recovery codes.
 * All three MUST be kept only in component state — never in localStorage/sessionStorage.
 *
 * Field compatibility:
 *   - identuum-idp-oss returns `otpauth_url` (new standard field).
 *   - identuum-idp monolith returns `qr_code_url` (legacy field name).
 *   Both are handled; `otpauth_url` takes precedence.
 */
export async function mfaEnrollInitiate(
  sessionId: string
): Promise<{ secret: string; otpauthUrl: string; recoveryCodes: string[] }> {
  const res = await fetch(IDP.mfaEnrollInitiate, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, "Failed to initiate MFA enrollment");
  }
  const body = await res.json();
  return {
    secret: body.secret,
    otpauthUrl: body.otpauth_url ?? body.qr_code_url,
    recoveryCodes: Array.isArray(body.recovery_codes) ? (body.recovery_codes as string[]) : [],
  };
}

/**
 * Completes TOTP enrollment by verifying the code the user entered after
 * scanning the provisioning URL or entering the secret manually.
 * Returns the user role on success so the caller can route to the dashboard.
 * Throws ApiError with message "SESSION_EXPIRED" when the pending session
 * has expired — callers should redirect to /login?reason=session_expired.
 */
export async function mfaEnrollComplete(
  sessionId: string,
  code: string
): Promise<{ role: UserRole }> {
  const res = await fetch(IDP.mfaEnrollComplete, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ session_id: sessionId, code }),
  });
  if (!res.ok) {
    let errMsg = "";
    try {
      const b = await res.json();
      errMsg = String(b?.error ?? "");
    } catch {
      // Ignore non-JSON body.
    }
    if (errMsg.includes("session invalid") || errMsg.includes("session not found")) {
      throw new ApiError(res.status, "SESSION_EXPIRED");
    }
    throw new ApiError(res.status, "Invalid verification code");
  }
  const body = await res.json();
  return { role: body.role ?? "org_user" };
}

// ── Authenticated MFA setup (account-settings surface) ────────────────────────
//
// Calls the authenticated /mfa/setup/{initiate,complete} endpoints — a
// separate surface from the login-flow's pending-session enrollment.
// The caller MUST be on an authenticated browser origin (cookie present);
// the IdP rejects an already-enrolled user with HTTP 409 (the wire-shape
// for the `ErrMFAAlreadyEnrolled` sentinel, see identuum-idp's
// internal/handlers/handler_mfa.go).
//
// Security: the secret + provisioning URI returned by `initiate` are held
// only in the calling component's state. They MUST NOT be persisted to
// localStorage, sessionStorage, or the URL. The `complete` call returns
// recovery codes; treat them with the same handling discipline.

export class AccountMFAAlreadyEnrolledError extends Error {
  constructor() {
    super("MFA is already enrolled. Disable MFA before enrolling a new authenticator.");
    this.name = "AccountMFAAlreadyEnrolledError";
  }
}

/**
 * Initiates authenticated TOTP enrollment for the calling user. Throws
 * AccountMFAAlreadyEnrolledError when the IdP returns HTTP 409.
 *
 * THE-ENROLL-PASSWORD: the route requires the caller's CURRENT PASSWORD
 * since identuum-idp-ce d9ca9fe (CE log/0100) — a hijacked session alone
 * could otherwise arm an attacker's authenticator on an account with no
 * active factor. The wire body is exactly {"password": …}. The server
 * collapses an absent, empty or wrong password (and its step-up lockout)
 * into ONE 401 invalid_proof; a step-up outage or an unwritable audit
 * chain is a 503. Both surface here as ApiError with the status — the
 * caller must not read more into them than the server gives.
 */
export async function accountMfaSetupInitiate(
  password: string
): Promise<{ secret: string; otpauthUrl: string }> {
  const res = await fetch(IDP.mfaSetupInitiate, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password }),
  });
  if (res.status === 409) {
    throw new AccountMFAAlreadyEnrolledError();
  }
  if (!res.ok) {
    throw new ApiError(res.status, "Failed to initiate MFA enrollment");
  }
  const body = await res.json();
  return { secret: body.secret, otpauthUrl: body.otpauth_url ?? body.qr_code_url };
}

/**
 * Completes authenticated TOTP enrollment by verifying the user-supplied
 * code. Returns the recovery codes generated server-side. Throws
 * AccountMFAAlreadyEnrolledError when the IdP returns HTTP 409 — the
 * defence-in-depth path for the race where another enrollment finished
 * between initiate and complete on this same session.
 */
export async function accountMfaSetupComplete(code: string): Promise<{ recoveryCodes: string[] }> {
  const res = await fetch(IDP.mfaSetupComplete, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code }),
  });
  if (res.status === 409) {
    throw new AccountMFAAlreadyEnrolledError();
  }
  if (!res.ok) {
    throw new ApiError(res.status, "Invalid verification code");
  }
  const body = await res.json();
  const codes = Array.isArray(body.recovery_codes) ? (body.recovery_codes as string[]) : [];
  return { recoveryCodes: codes };
}
