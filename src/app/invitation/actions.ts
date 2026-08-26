"use server";

/**
 * Server actions for the /invitation page (user invitation setup wizard).
 *
 * Backend endpoints:
 *   - validate: GET  /api/v1/auth/users/setup/:token
 *               → { success, email, name, email_bound }
 *               → 422 for invalid/expired/used tokens
 *   - consume:  POST /api/v1/auth/users/setup
 *               → { token, email, password }
 *               → 200 { success: true } on success
 *               → 422 on invalid token, weak password, or email already registered
 *
 * Security:
 *   - Token is not logged.
 *   - Passwords are not logged.
 *   - Server actions call the IdP directly via idpBaseUrl() (internal URL when configured).
 *   - No localStorage/sessionStorage usage.
 */

import { z } from "zod";
import { idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValidateInvitationResult {
  valid: boolean;
  /** Pre-set email when invitation was bound to an address. Empty for no-email invitations. */
  email?: string;
  name?: string;
  /** true when invitation was created with a specific email address */
  emailBound: boolean;
}

export interface ConsumeInvitationState {
  phase: "form" | "success" | "invalid";
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password" | "confirmPassword", string>>;
}

// ── Validate (called server-side on page load) ────────────────────────────────

export async function validateInvitationToken(rawToken: string): Promise<ValidateInvitationResult> {
  if (!rawToken || typeof rawToken !== "string") {
    return { valid: false, emailBound: false };
  }
  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) return { valid: false, emailBound: false };

  try {
    const url = `${idpBaseUrl(cfg)}/api/v1/auth/users/setup/${encodeURIComponent(rawToken)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return { valid: false, emailBound: false };
    // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
    const body: any = await res.json();
    if (!body.success) return { valid: false, emailBound: false };
    return {
      valid: true,
      email: typeof body.email === "string" && body.email.length > 0 ? body.email : undefined,
      name: typeof body.name === "string" && body.name.length > 0 ? body.name : undefined,
      emailBound: Boolean(body.email_bound),
    };
  } catch {
    return { valid: false, emailBound: false };
  }
}

// ── Consume (form submission) ─────────────────────────────────────────────────

const consumeSchema = z
  .object({
    token: z.string().min(1),
    email: z.string().optional(),
    password: z.string().min(1, "Password is required"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function consumeInvitationAction(
  _prev: ConsumeInvitationState,
  formData: FormData
): Promise<ConsumeInvitationState> {
  const raw = {
    token: (formData.get("token") as string | null) ?? "",
    email: (formData.get("email") as string | null)?.trim() ?? "",
    password: (formData.get("password") as string | null) ?? "",
    confirmPassword: (formData.get("confirmPassword") as string | null) ?? "",
  };

  const parsed = consumeSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: ConsumeInvitationState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof NonNullable<ConsumeInvitationState["fieldErrors"]>;
      if (field) fieldErrors[field] = issue.message;
    }
    return { phase: "form", fieldErrors };
  }

  const cfg = loadRuntimeConfig();
  if (!cfg || !cfg.idp.enabled) {
    return { phase: "form", error: "Identity service unavailable. Please try again later." };
  }

  try {
    const res = await fetch(`${idpBaseUrl(cfg)}/api/v1/auth/users/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: parsed.data.token,
        email: parsed.data.email || undefined,
        password: parsed.data.password,
      }),
      cache: "no-store",
    });

    // biome-ignore lint/suspicious/noExplicitAny: raw API response before typing
    const body: any = await res.json().catch(() => ({}));

    if (res.ok && body.success) {
      return { phase: "success" };
    }

    // 422 = invalid token, weak password, email conflict, etc.
    const message =
      typeof body.message === "string" && body.message.length > 0
        ? body.message
        : "Setup failed. Your invitation link may have expired or already been used.";

    if (!res.ok && res.status === 422) {
      return { phase: "invalid", error: message };
    }

    return { phase: "form", error: message };
  } catch {
    return {
      phase: "form",
      error: "Could not reach the identity service. Please try again.",
    };
  }
}
