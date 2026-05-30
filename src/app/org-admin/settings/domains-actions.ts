"use server";

/**
 * Server actions for the /org-admin/settings Domains card.
 *
 * Security contract (mirrors the rest of this directory):
 *   - Session re-validated on every action (belt-and-suspenders beyond
 *     the /org-admin layout guard).
 *   - Role checked: only org_admin may invoke these actions.
 *   - Organization ID derived server-side from getOwnOrganization()
 *     (backend session-scoped) — NEVER from form data. The form does
 *     not even submit an org id; this guarantee is structural.
 *   - Add-domain body never carries organization_id (the IDP rejects
 *     unknown fields via StrictBindJSON). The client helper enforces
 *     this with a typed body literal.
 *   - The DNS-TXT challenge is single-shot: it is returned only on the
 *     successful add-domain response. The state envelope below carries
 *     it back to the form so the operator can copy it; the value is
 *     never persisted, logged, or re-fetched. On a subsequent render the
 *     state resets to idle.
 *   - Mutation actions revalidate /org-admin/settings so the list
 *     re-renders from the IDP (no client-side state leak).
 */

import {
  addOrganizationDomain,
  deleteOrganizationDomain,
  getOwnOrganization,
  setPrimaryOrganizationDomain,
  verifyOrganizationDomain,
} from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ORG_ADMIN_DOMAINS_CARD_COPY } from "./settings-helpers";

// ── Add domain ──────────────────────────────────────────────────────────────

export type AddOrganizationDomainState =
  | { phase: "idle" }
  | { phase: "error"; error: string }
  | {
      phase: "success";
      domain: string;
      challenge: {
        record_name: string;
        record_type: string;
        record_value: string;
        expires_at: string;
      };
    };

/**
 * Validation rule used by the action — the IDP performs the
 * authoritative check; this is a defense-in-depth pre-filter so the
 * operator does not pay a network round trip for trivially malformed
 * input. Mirrors domain.Validate's first-pass rule (length > 0, has dot,
 * no whitespace).
 */
function isPlausibleDomain(d: string): boolean {
  if (!d) return false;
  if (d.length > 253) return false;
  if (/\s/.test(d)) return false;
  if (!d.includes(".")) return false;
  return true;
}

export async function addOrganizationDomainAction(
  _prev: AddOrganizationDomainState,
  formData: FormData
): Promise<AddOrganizationDomainState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error: "Could not resolve your organization. Please sign out and sign in again.",
    };
  }

  const rawDomain = ((formData.get("domain") as string | null) ?? "").trim().toLowerCase();
  if (!isPlausibleDomain(rawDomain)) {
    return {
      phase: "error",
      error: "Enter a valid domain (e.g. example.com).",
    };
  }

  const result = await addOrganizationDomain(org.id, rawDomain);
  if (result.ok) {
    revalidatePath("/org-admin/settings");
    // Return ONLY the fields the operator needs to publish the TXT
    // record. The raw token field on the wire is intentionally NOT
    // forwarded to the UI separately — record_value already carries the
    // operator-publishable form (prefix + token), which is what they
    // paste into DNS.
    return {
      phase: "success",
      domain: result.data.domain.domain,
      challenge: {
        record_name: result.data.challenge.record_name,
        record_type: result.data.challenge.record_type,
        record_value: result.data.challenge.record_value,
        expires_at: result.data.challenge.expires_at,
      },
    };
  }

  if (result.conflict) {
    return {
      phase: "error",
      error: "This domain is already registered for your organization or another organization.",
    };
  }
  if (result.invalid) {
    return { phase: "error", error: "The domain is not valid. Try again." };
  }
  return {
    phase: "error",
    error: "Could not add domain. Please try again.",
  };
}

// ── Verify domain ───────────────────────────────────────────────────────────

export type VerifyOrganizationDomainState =
  | { phase: "idle" }
  | { phase: "error"; error: string }
  | { phase: "success"; domain: string };

export async function verifyOrganizationDomainAction(
  _prev: VerifyOrganizationDomainState,
  formData: FormData
): Promise<VerifyOrganizationDomainState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error: "Could not resolve your organization. Please sign out and sign in again.",
    };
  }

  const domainID = ((formData.get("domain_id") as string | null) ?? "").trim();
  if (!domainID || !/^[0-9a-fA-F-]{32,36}$/.test(domainID)) {
    return { phase: "error", error: "Invalid domain reference." };
  }
  const domainName = ((formData.get("domain") as string | null) ?? "").trim();

  const result = await verifyOrganizationDomain(org.id, domainID);
  if (result.ok) {
    revalidatePath("/org-admin/settings");
    return { phase: "success", domain: result.data.domain.domain || domainName };
  }

  // The operator-correctable cases get specific copy from
  // ORG_ADMIN_DOMAINS_CARD_COPY. The IDP error envelope (which may
  // include a raw resolver message) is NEVER forwarded to the UI — only
  // these vetted, hash/token/record-value-free strings are.
  if (result.recordNotFound) {
    return { phase: "error", error: ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorRecordNotFound };
  }
  if (result.mismatch) {
    return { phase: "error", error: ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorMismatch };
  }
  if (result.lookupFailed) {
    return { phase: "error", error: ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorLookupFailed };
  }
  return { phase: "error", error: ORG_ADMIN_DOMAINS_CARD_COPY.verifyErrorGeneric };
}

// ── Delete domain ───────────────────────────────────────────────────────────

export type DeleteOrganizationDomainState =
  | { phase: "idle" }
  | { phase: "error"; error: string }
  | { phase: "success"; domain: string };

export async function deleteOrganizationDomainAction(
  _prev: DeleteOrganizationDomainState,
  formData: FormData
): Promise<DeleteOrganizationDomainState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error: "Could not resolve your organization. Please sign out and sign in again.",
    };
  }

  const domainID = ((formData.get("domain_id") as string | null) ?? "").trim();
  if (!domainID || !/^[0-9a-fA-F-]{32,36}$/.test(domainID)) {
    return { phase: "error", error: "Invalid domain reference." };
  }
  const domainName = ((formData.get("domain") as string | null) ?? "").trim();

  const result = await deleteOrganizationDomain(org.id, domainID);
  if (result.ok) {
    revalidatePath("/org-admin/settings");
    return { phase: "success", domain: domainName };
  }
  // Mirror the slice-2 verify-error pattern: the IDP envelope (which
  // may include a raw resolver / SQL message) is NEVER forwarded; the
  // action picks one of three vetted, hash/token/record-value-free
  // strings from ORG_ADMIN_DOMAINS_CARD_COPY.
  if (result.notFound) {
    return { phase: "error", error: ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorNotFound };
  }
  if (result.primary) {
    return { phase: "error", error: ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorPrimaryConflict };
  }
  return { phase: "error", error: ORG_ADMIN_DOMAINS_CARD_COPY.removeErrorGeneric };
}

// ── Set primary ─────────────────────────────────────────────────────────────

export type SetPrimaryOrganizationDomainState =
  | { phase: "idle" }
  | { phase: "error"; error: string }
  | { phase: "success"; domain: string };

export async function setPrimaryOrganizationDomainAction(
  _prev: SetPrimaryOrganizationDomainState,
  formData: FormData
): Promise<SetPrimaryOrganizationDomainState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error: "Could not resolve your organization. Please sign out and sign in again.",
    };
  }

  const domainID = ((formData.get("domain_id") as string | null) ?? "").trim();
  if (!domainID || !/^[0-9a-fA-F-]{32,36}$/.test(domainID)) {
    return { phase: "error", error: "Invalid domain reference." };
  }
  const domainName = ((formData.get("domain") as string | null) ?? "").trim();

  const result = await setPrimaryOrganizationDomain(org.id, domainID);
  if (result.ok) {
    revalidatePath("/org-admin/settings");
    return { phase: "success", domain: domainName };
  }
  if (result.notFound) {
    return { phase: "error", error: "Domain not found." };
  }
  if (result.notVerified) {
    return {
      phase: "error",
      error: "Only verified domains can be set as primary. Verify this domain first.",
    };
  }
  return {
    phase: "error",
    error: "Could not set this domain as primary. Please try again.",
  };
}
