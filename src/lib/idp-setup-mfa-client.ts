/**
 * idp-setup-mfa-client.ts — client helpers for the pre-login
 * setup-MFA endpoints landed by D-IDP-INSTALL-26 (agent-a-20260627-idp-ce-setup-wizard-site-admin-totp-enrollment-implementation).
 *
 * Both endpoints are setup-token-authenticated and live alongside the
 * existing /api/setup/* family. They are pre-login: the operator is
 * not yet a session-cookie holder, so authentication is the setup
 * token the wizard already validated via verifySetupToken.
 *
 * SAFETY contract:
 *   - The `otpauth_url` + `secret` returned by Initiate are sensitive
 *     bootstrap material: render once, hold only in component state,
 *     drop on transition to the success screen, NEVER log, NEVER
 *     persist to localStorage / sessionStorage / document.cookie /
 *     URL params.
 *   - The `session_id` returned by Initiate is NOT directly secret-
 *     bearing (it's a uuid keyed against an in-process ephemeral
 *     store), but it MUST be threaded through Verify and then through
 *     completeSetup; mishandling it loses the secret because Verify
 *     consumes the only proof of authority for Complete to enroll
 *     the user.
 *   - Discriminated-union results mirror idp-setup-client.ts: each
 *     function returns a tagged outcome rather than throwing.
 */

const SETUP_MFA_PATHS = {
  initiate: "/api/idp/api/setup/mfa/initiate",
  verify: "/api/idp/api/setup/mfa/verify",
} as const;

export interface SetupMFAInitiateBody {
  sessionId: string;
  otpauthUrl: string;
  secret: string;
  expiresAt: string;
}

export type SetupMFAInitiateResult =
  | { kind: "ok"; result: SetupMFAInitiateBody }
  | { kind: "bad_token" }
  | { kind: "already_complete" }
  | { kind: "subsystem_not_configured" }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export type SetupMFAVerifyResult =
  | { kind: "ok" }
  | { kind: "bad_token" }
  | { kind: "already_complete" }
  | { kind: "session_invalid" }
  | { kind: "email_mismatch" }
  | { kind: "code_invalid" }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export async function initiateSetupMFA(
  setupToken: string,
  adminEmail: string
): Promise<SetupMFAInitiateResult> {
  let res: Response;
  try {
    res = await fetch(SETUP_MFA_PATHS.initiate, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_token: setupToken, admin_email: adminEmail }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (res.status === 401) return { kind: "bad_token" };
  if (res.status === 410) return { kind: "already_complete" };
  if (res.status === 503) return { kind: "subsystem_not_configured" };
  if (!res.ok) return { kind: "error", status: res.status };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "error", status: res.status };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "error", status: res.status };
  }
  const body = raw as Record<string, unknown>;
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const otpauthUrl = typeof body.otpauth_url === "string" ? body.otpauth_url : "";
  const secret = typeof body.secret === "string" ? body.secret : "";
  const expiresAt = typeof body.expires_at === "string" ? body.expires_at : "";
  if (!sessionId || !otpauthUrl || !secret) {
    return { kind: "error", status: res.status };
  }
  return { kind: "ok", result: { sessionId, otpauthUrl, secret, expiresAt } };
}

export async function verifySetupMFA(
  setupToken: string,
  sessionId: string,
  adminEmail: string,
  code: string
): Promise<SetupMFAVerifyResult> {
  let res: Response;
  try {
    res = await fetch(SETUP_MFA_PATHS.verify, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setup_token: setupToken,
        session_id: sessionId,
        admin_email: adminEmail,
        code,
      }),
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (res.status === 204) return { kind: "ok" };
  if (res.status === 401) return { kind: "bad_token" };
  if (res.status === 410) return { kind: "already_complete" };
  if (res.status === 400) {
    let code = "";
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") code = body.error;
    } catch {
      // ignore
    }
    if (code === "mfa_session_invalid") return { kind: "session_invalid" };
    if (code === "mfa_email_mismatch") return { kind: "email_mismatch" };
    if (code === "mfa_code_invalid") return { kind: "code_invalid" };
    return { kind: "error", status: res.status };
  }
  return { kind: "error", status: res.status };
}
