"use server";

/**
 * D-021: the public self-registration submit. The IdP answers 202 for every
 * outcome (new, existing, closed, unknown, refused domain) and 400
 * weak_password only for an open organization's policy, so the page shows
 * one neutral message per the organization's settings and never says which
 * outcome it was.
 */

import { submitRegistration } from "@/lib/idp-registration-client";

export interface RegisterState {
  phase: "form" | "accepted";
  error?: string;
}

export async function registerAction(
  _prev: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const slug = String(formData.get("slug") ?? "");
  const r = await submitRegistration(slug, {
    email: String(formData.get("email") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (r.ok) return { phase: "accepted" };
  return { phase: "form", error: r.message };
}
