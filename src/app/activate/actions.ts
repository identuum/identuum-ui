"use server";

/**
 * Server actions for the /activate page — the organization-activation
 * ceremony (THE-DEAD-ACTIVATE-LINK, 2026-08-27).
 *
 * The IdP's activation email links to `<linkBaseURL>/activate?token=...`
 * (smtp_notifier.go), a page that did not exist until this slice: the
 * pending org_admin minted by create-organization-with-admin_email (or
 * re-issued via resend-activation) had nowhere to land.
 *
 * This is NOT the /claim ceremony, though the goal rhymes: /claim
 * consumes organization_claims tokens via GET /api/v1/auth/claim/validate
 * + POST /api/v1/auth/claim, while THIS page consumes the user
 * activation-token family (users.activation_token_hash) via:
 *
 *   validate: GET  /api/v1/auth/organizations/activate/:token
 *             → 200 {success, email, org_id}
 *             → 400 invalid_token | 409 organization_already_active
 *   consume:  POST /api/v1/auth/organizations/activate {token, password}
 *             → 200 {success, message, organization}   (sets the admin's
 *               real password AND flips the org active in one tx —
 *               ACTIVATION-CONSUME-ONCE-1 on the backend)
 *             → 400 weak_password | invalid_token | 409 already_active
 *
 * No session is minted by consume. Mirroring /claim: after activation we
 * open a pending MFA-enrollment login session server-side (org_admins
 * are always MFA-required) and hand its session_id to the enrollment
 * form; the password is given to the IdP exactly once and discarded.
 */

import { z } from "zod";
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";

export interface ActivationValidation {
  valid: boolean;
  /** Set when valid: the pending org_admin the token belongs to. */
  email?: string;
  /** 409 — the org is already active; the token's job is already done. */
  alreadyActive?: boolean;
}

export async function validateActivationToken(rawToken: string): Promise<ActivationValidation> {
  if (!rawToken) return { valid: false };
  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) return { valid: false };
  try {
    const res = await fetch(
      `${idpBaseUrl(cfg)}/api/v1/auth/organizations/activate/${encodeURIComponent(rawToken)}`,
      { cache: "no-store" }
    );
    if (res.status === 409) return { valid: false, alreadyActive: true };
    if (!res.ok) return { valid: false };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
    const data: any = await res.json();
    if (data?.success !== true || typeof data.email !== "string") return { valid: false };
    return { valid: true, email: data.email };
  } catch {
    return { valid: false };
  }
}

export type ActivateState =
  | { phase: "form"; error?: string }
  | { phase: "mfa_setup"; success: true; sessionId: string }
  | { phase: "success"; success: true }
  | { phase: "invalid"; alreadyActive?: boolean };

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

export async function completeActivationAction(
  _prev: ActivateState,
  formData: FormData
): Promise<ActivateState> {
  const raw = {
    token: ((formData.get("token") as string | null) ?? "").trim(),
    password: (formData.get("password") as string | null) ?? "",
    confirm: (formData.get("confirm") as string | null) ?? "",
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { phase: "form", error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const cfg = loadRuntimeConfig();
  if (!cfg?.idp.enabled) {
    return { phase: "form", error: "Service unavailable. Please try again later." };
  }
  const idpURL = idpBaseUrl(cfg);

  let email = "";
  try {
    // Re-validate to learn the admin email for the post-activation login
    // probe (the consume response does not echo it).
    const check = await validateActivationToken(parsed.data.token);
    if (!check.valid) {
      return { phase: "invalid", alreadyActive: check.alreadyActive };
    }
    email = check.email ?? "";

    const res = await fetch(`${idpURL}/api/v1/auth/organizations/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: parsed.data.token, password: parsed.data.password }),
      cache: "no-store",
    });
    if (res.status === 409) return { phase: "invalid", alreadyActive: true };
    if (res.status === 400) {
      // biome-ignore lint/suspicious/noExplicitAny: raw API response
      const body: any = await res.json().catch(() => ({}));
      if (body?.error === "weak_password") {
        return {
          phase: "form",
          error:
            "Password does not meet the organization's strength policy. Choose a stronger one.",
        };
      }
      return { phase: "invalid" };
    }
    if (!res.ok) {
      return { phase: "form", error: "Activation failed. Please try again or request a new link." };
    }
  } catch {
    return { phase: "form", error: "Network error. Please check your connection and try again." };
  }

  // Activation done: org active, password set. org_admins are always
  // MFA-required, so chain into enrollment via a pending login session
  // (same machinery and reasoning as /claim).
  const pendingSessionID = await openPendingMFAEnrollmentSession(
    idpURL,
    email,
    parsed.data.password
  );
  if (pendingSessionID) {
    return { phase: "mfa_setup", success: true, sessionId: pendingSessionID };
  }
  // Defensive fallback: activation succeeded but the probe could not
  // open a pending session — the admin signs in manually and the login
  // flow forces the same enrollment.
  return { phase: "success", success: true };
}

// Mirrors /claim's probe with one MEASURED correction: a fresh org_admin
// with no MFA enrolled gets HTTP 401 {"error":"mfa_enrollment_required",
// mfa_required:true, session_id} — the pending session rides on a 401,
// not a 200 (proven against a live HEAD backend, THE-DEAD-ACTIVATE-LINK
// item 3). The password is sent to the IdP exactly once and discarded;
// session_id is a non-secret pending-session identifier.
async function openPendingMFAEnrollmentSession(
  idpURL: string,
  email: string,
  password: string
): Promise<string> {
  if (!email) return "";
  try {
    const res = await fetch(`${idpURL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
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
