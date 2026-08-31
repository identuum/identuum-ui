"use server";

/**
 * Server action for the create-organization form.
 *
 * This file runs server-side only. It:
 *   1. Re-validates the site_admin session (belt-and-suspenders beyond layout guard).
 *   2. Validates/sanitizes form data with zod.
 *   3. Calls createOrganization() in idp-admin-client.ts, which forwards cookies
 *      to the IdP using internal_base_url — never exposed to the browser.
 *   4. On success, returns a success state that may include an activation token
 *      AND the link that consumes it. OSS returns the token whenever
 *      admin_email was supplied — in BOTH the email-configured and the
 *      email-not-configured mode (there is no "air-gapped mode" in OSS; that
 *      is a CE feature, and the flag this comment used to cite does not
 *      exist). When the IdP cannot build a link it says why instead, naming
 *      the setting — the UI never guesses a URL.
 *   5. On failure, returns safe error state — no raw stack traces, SQL errors,
 *      or internal URLs.
 *
 * Backend authorization remains authoritative. UI validation is a UX aid only.
 *
 * Activation-token safety:
 *   - Token is transmitted in action return state (React in-memory, not URL/storage).
 *   - Token is never in query params, localStorage, sessionStorage, or logs.
 *   - Token is shown once in the success panel; navigating away discards it.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import { createOrganization } from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or fewer"),
  domain: z
    .string()
    .min(1, "Domain is required")
    .max(253, "Domain must be 253 characters or fewer")
    .transform((d) => d.toLowerCase().trim()),
  admin_email: z
    .string()
    .max(255)
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("")),
});

export interface CreateOrgSuccess {
  /** UUID of the newly created organization. Safe to use in navigation links. */
  orgId: string;
  orgName: string;
  orgDomain: string;
  /** Provided if admin_email was submitted. */
  adminEmail?: string;
  /**
   * The raw one-time activation credential. Not a URL. Expires 24 hours
   * after creation. OSS returns it whenever admin_email was supplied — in
   * both the email-configured and email-not-configured modes.
   */
  activationToken?: string;
  /**
   * The ready-to-open activation link the token belongs to, when the IdP
   * knows the UI's public base URL (THE-UNUSABLE-TOKEN). This is the
   * primary affordance: the /activate page consumes ?token and has no
   * input field, so a bare token alone cannot be redeemed by hand.
   */
  activationUrl?: string;
  /**
   * Set INSTEAD of activationUrl when the IdP cannot build a link; carries
   * the server's reason, naming the setting to configure. Never both.
   */
  activationUrlUnavailable?: string;
}

export interface CreateOrgActionState {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "domain" | "admin_email", string>>;
  /** Defined when the creation succeeded. The form shows a success panel. */
  success?: CreateOrgSuccess;
}

export async function createOrgAction(
  _prev: CreateOrgActionState,
  formData: FormData
): Promise<CreateOrgActionState> {
  // Re-validate session — belt-and-suspenders beyond the /site-admin layout guard.
  // This is necessary because server actions can be invoked independently of the layout.
  const session = await getServerSession();
  if (!session) {
    redirect("/login?reason=session_expired");
  }

  const role = session.user?.role ?? session.role;
  if (role !== "site_admin") {
    // Wrong role: redirect to the correct section rather than showing 403.
    redirect(roleToPath(role));
  }

  const raw = {
    name: ((formData.get("name") as string | null) ?? "").trim(),
    domain: ((formData.get("domain") as string | null) ?? "").trim(),
    admin_email: ((formData.get("admin_email") as string | null) ?? "").trim(),
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        name: flat.name?.[0],
        domain: flat.domain?.[0],
        admin_email: flat.admin_email?.[0],
      },
    };
  }

  const result = await createOrganization({
    name: parsed.data.name,
    domain: parsed.data.domain,
    admin_email: parsed.data.admin_email || undefined,
  });

  if (!result.ok) {
    if (result.conflict) {
      return { fieldErrors: { domain: "An organization with this domain already exists." } };
    }
    if (result.status === 403) {
      redirect("/login?reason=unauthorized");
    }
    return {
      error: "Could not create the organization. The backend returned an error. Try again.",
    };
  }

  // Success. Return state for the success panel.
  // The activation token is one-time and must be shown here; we do NOT
  // redirect, because redirecting would discard it. The link is carried
  // alongside it (THE-UNUSABLE-TOKEN) so the operator has something they can
  // actually open, or the server's reason why there is none.
  return {
    success: {
      orgId: result.id,
      orgName: result.name,
      orgDomain: result.domain,
      adminEmail: parsed.data.admin_email || undefined,
      activationToken: result.activationToken ?? undefined,
      activationUrl: result.activationUrl ?? undefined,
      activationUrlUnavailable: result.activationUrlUnavailable ?? undefined,
    },
  };
}
