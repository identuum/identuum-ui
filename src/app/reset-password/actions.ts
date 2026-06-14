"use server";

/**
 * Server action for /reset-password — completes the password reset flow.
 *
 * Backend contract:
 *   POST /api/v1/auth/password/reset
 *   request:  { token: string, new_password: string }
 *   response:
 *     200 OK  → {"success": true, "message": "Password has been successfully reset."}
 *     400     → invalid/expired token (ErrInvalidResetToken) OR weak password
 *               (ErrWeakPassword); the IDP may also stamp the SSO-migration
 *               flag on a rejected token belonging to a tenant in
 *               idp-migration state — the UI surfaces this as a generic
 *               "invalid token" so the operator can simply request a new
 *               link without seeing low-level state.
 *
 * Security:
 *   - The token arrives as a URL query param. The action receives it as a
 *     hidden form input and immediately forwards it to the IDP without
 *     logging, persisting, or echoing it back into the response state.
 *   - The new-password value is consumed server-side only. It is never
 *     returned in any field of the ResetPasswordState.
 *   - Backend errors are mapped to bounded sentinel copy. Raw IDP messages
 *     never reach the client.
 */

import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { z } from "zod";

export interface ResetPasswordState {
  /**
   * Phase semantics:
   *   - "form"     → initial render or recoverable validation/policy error.
   *   - "success"  → terminal success state. Render a /login link.
   *   - "invalid"  → token is invalid/expired/consumed. Direct the user
   *                  back to /forgot-password.
   *   - "disabled" → IDP is not enabled in this deployment.
   */
  phase: "form" | "success" | "invalid" | "disabled";
  error?: string;
  fieldErrors?: Partial<Record<"newPassword" | "confirmPassword", string>>;
}

const schema = z
  .object({
    token: z.string().min(1, "Missing reset token"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(255, "Password is too long"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function consumeResetTokenAction(
  _prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { phase: "disabled" };
  }

  const raw = {
    // Token is hidden-input only; never trim/normalise — pass through verbatim
    // so a token containing a legitimate trailing character set is not silently
    // mangled by the action. Validation lives in the schema and on the IDP.
    token: (formData.get("token") as string | null) ?? "",
    newPassword: (formData.get("newPassword") as string | null) ?? "",
    confirmPassword: (formData.get("confirmPassword") as string | null) ?? "",
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    // If the token field failed validation it means the page was loaded
    // without one — render the invalid-token surface so the operator can
    // request a new link instead of confusing them with a field-level
    // error on a hidden input they cannot see.
    if (flat.token?.length) {
      return { phase: "invalid" };
    }
    return {
      phase: "form",
      fieldErrors: {
        newPassword: flat.newPassword?.[0],
        confirmPassword: flat.confirmPassword?.[0],
      },
    };
  }

  let res: Response;
  try {
    res = await fetch(`${idpBaseUrl(cfg)}/api/v1/auth/password/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: parsed.data.token,
        new_password: parsed.data.newPassword,
      }),
    });
  } catch {
    return {
      phase: "form",
      error: "Could not reach the identity provider. Try again in a moment.",
    };
  }

  if (res.ok) {
    return { phase: "success" };
  }

  // 400 carries the IDP's bounded error sentinel. We inspect the public
  // `code` / `message` shape but never echo the raw message back to the
  // browser. Anything we cannot positively map is surfaced as the
  // invalid-token panel, which is the safest default.
  let code = "";
  let message = "";
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    code = String(body.code ?? "");
    message = String(body.message ?? "");
  } catch {
    // Non-JSON body — fall through to the default invalid-token branch.
  }

  if (code.includes("RESET_TOKEN") || /reset token|expired|invalid/i.test(message)) {
    return { phase: "invalid" };
  }
  if (code === "WEAK_PASSWORD" || /weak password|too weak|too short/i.test(message)) {
    return {
      phase: "form",
      fieldErrors: {
        newPassword:
          "Password does not meet the strength policy. Use a longer password with mixed character types.",
      },
    };
  }

  // Unknown failure: do not echo IDP detail. Default to the invalid-token
  // panel so the operator is directed at /forgot-password rather than
  // looping on the reset form.
  return { phase: "invalid" };
}
