"use server";

/**
 * Server action for /forgot-password — requests a password reset email.
 *
 * Backend contract:
 *   POST /api/v1/auth/password/reset-request
 *   request:  { email: string }
 *   response: always HTTP 200 with a generic message (oracle-hardened —
 *             reveals nothing about whether an account exists). The IDP
 *             also injects a 100-300 ms random delay to mask timing.
 *
 * The IDP service writes the email link with the human-facing base URL
 * (`HumanFacingBaseURL`) followed by `/reset-password?token=<raw>`, so the
 * link lands on the UI's /reset-password page. No UI-side link construction
 * is needed.
 *
 * Security:
 *   - The email field is normalised (lowercase + trim) server-side before
 *     calling the IDP so casing variants do not yield different audit rows.
 *   - The action returns the same generic "if an account exists" copy on
 *     success AND on every failure mode short of network-down. This
 *     preserves the no-enumeration property end-to-end: a leaked "no such
 *     user" or "user inactive" string from the IDP cannot reach the UI.
 *   - Email is not logged. The action returns no token, no link, and no
 *     account-state hint.
 */

import { z } from "zod";
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";

export interface ForgotPasswordState {
  /**
   * Phase semantics:
   *   - "form"    → initial render or field-level validation error.
   *   - "sent"    → terminal success state. Render generic copy.
   *   - "disabled"→ IDP is not enabled in this deployment.
   */
  phase: "form" | "sent" | "disabled";
  fieldErrors?: Partial<Record<"email", string>>;
  error?: string;
}

const schema = z.object({
  email: z
    .string()
    .min(1, "Enter your email address")
    .max(255, "Email must be 255 characters or fewer")
    .email("Enter a valid email address")
    .transform((s) => s.toLowerCase().trim()),
});

export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { phase: "disabled" };
  }

  const raw = {
    email: ((formData.get("email") as string | null) ?? "").trim(),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      phase: "form",
      fieldErrors: { email: flat.email?.[0] },
    };
  }

  try {
    // The IDP always responds 200 OK with generic copy regardless of
    // whether the email matches an account. We intentionally do NOT
    // inspect the response body — the no-enumeration guarantee lives on
    // the wire shape (a successful HTTP 200) and we present the same
    // terminal "sent" state to the user regardless of body contents.
    // CE-UI-2b: only a 2xx is "sent". A 404 (an IdP with no reset route,
    // such as identuum-idp-ce), a 429 or a 5xx sent nothing, and saying
    // otherwise would leave the user waiting for a mail that never comes.
    // The retry hint reveals nothing about the account.
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/auth/password/reset-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: parsed.data.email }),
    });
    if (!res.ok) {
      return {
        phase: "form",
        error:
          "Could not request a reset link right now. Try again later, or ask your administrator.",
      };
    }
    return { phase: "sent" };
  } catch {
    // Hard network failure — surface a generic retry hint that still does
    // not reveal account state. Operators rarely hit this because the
    // server action runs inside the same compose network as the IDP.
    return {
      phase: "form",
      error: "Could not reach the identity provider. Try again in a moment.",
    };
  }
}
