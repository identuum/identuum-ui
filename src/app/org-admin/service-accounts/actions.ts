"use server";

/**
 * Server actions for /org-admin/service-accounts.
 *
 * Backend surface (gograph-verified):
 *   POST   /api/v1/organizations/:id/service-accounts        (create)
 *   DELETE /api/v1/organizations/:id/service-accounts/:sa_id (soft delete)
 *
 * The IDP create endpoint does NOT return a credential / secret /
 * hash / private-key field — the response is the same 7-field
 * types.ServiceAccount as the list endpoint. There is no copy-once
 * panel in this slice because there is no one-time credential to
 * show. A future slice that wires the IDP's currently-unrouted
 * service_account_credentials lifecycle (and/or the unrouted
 * (*ClientService).LinkServiceAccount) would add credential-issuance
 * UX; this slice is strictly the management-of-identity-only surface.
 *
 * Tenant scope:
 *   - The actor's organization id is derived server-side via
 *     getOwnOrganization(); the action NEVER trusts a client-supplied
 *     organization id on form data.
 *   - The IDP service-layer guard ALSO refuses cross-org SA mutation
 *     (org_admin must equal actor.OrganizationID; site_admin is hard
 *     403 on this surface). Defence-in-depth UI gate matches.
 */

import {
  createServiceAccount,
  deleteServiceAccount,
  disableServiceAccount,
  enableServiceAccount,
  getOwnOrganization,
  linkServiceAccountToOAuthClient,
  unlinkServiceAccountFromOAuthClient,
  updateServiceAccount,
} from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const NAME_MAX = 255;
const DESCRIPTION_MAX = 1024;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ALLOWED_ROLES: ReadonlySet<string> = new Set(["org_admin", "org_user"]);

// ── Create service account ──────────────────────────────────────────────────

export type CreateServiceAccountState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: {
        name?: string;
        description?: string;
        role?: string;
        expires_at?: string;
      };
    }
  | {
      phase: "success";
      created: {
        id: string;
        name: string;
        role: string;
      };
    };

export async function createServiceAccountAction(
  _prev: CreateServiceAccountState,
  formData: FormData
): Promise<CreateServiceAccountState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) {
    return {
      phase: "error",
      error: "Enter a service account name.",
      fieldErrors: { name: "Required." },
    };
  }
  if (name.length > NAME_MAX) {
    return {
      phase: "error",
      error: `Service account name is too long (${NAME_MAX} character maximum).`,
      fieldErrors: { name: "Too long." },
    };
  }

  const description = ((formData.get("description") as string | null) ?? "").trim();
  if (description.length > DESCRIPTION_MAX) {
    return {
      phase: "error",
      error: `Description is too long (${DESCRIPTION_MAX} character maximum).`,
      fieldErrors: { description: "Too long." },
    };
  }

  const requestedRole = ((formData.get("role") as string | null) ?? "").trim();
  if (requestedRole.length > 0 && !ALLOWED_ROLES.has(requestedRole)) {
    return {
      phase: "error",
      error: "Role must be either org_admin or org_user.",
      fieldErrors: { role: "Invalid." },
    };
  }

  const expiresAtRaw = ((formData.get("expires_at") as string | null) ?? "").trim();
  let expires_at: string | undefined;
  if (expiresAtRaw.length > 0) {
    // Accept either YYYY-MM-DD (from <input type="date">) or full ISO-8601.
    const isoCandidate = /^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw)
      ? `${expiresAtRaw}T23:59:59Z`
      : expiresAtRaw;
    const t = Date.parse(isoCandidate);
    if (Number.isNaN(t) || t < Date.now()) {
      return {
        phase: "error",
        error: "Expiry must be a valid future date.",
        fieldErrors: { expires_at: "Invalid date." },
      };
    }
    expires_at = new Date(t).toISOString();
  }

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error:
        "Could not resolve your organization. Reload the page or contact your platform administrator.",
    };
  }

  const result = await createServiceAccount(org.id, {
    name,
    description: description.length > 0 ? description : undefined,
    role: requestedRole.length > 0 ? requestedRole : undefined,
    expires_at,
  });

  if (result.ok) {
    revalidatePath("/org-admin/service-accounts");
    return {
      phase: "success",
      created: {
        id: result.serviceAccount.id,
        name: result.serviceAccount.name,
        role: result.serviceAccount.role,
      },
    };
  }
  if (result.conflict) {
    return {
      phase: "error",
      error: "A service account with this name already exists in your organization.",
      fieldErrors: { name: "Already in use." },
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to create service accounts." };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The service account could not be created. Check the values and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

// ── Delete service account ──────────────────────────────────────────────────

export type DeleteServiceAccountState =
  | { phase: "idle" }
  | { phase: "error"; error: string; fieldErrors?: { confirm?: string } };

export async function deleteServiceAccountAction(
  saID: string,
  expectedName: string,
  _prev: DeleteServiceAccountState,
  formData: FormData
): Promise<DeleteServiceAccountState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(saID)) {
    return {
      phase: "error",
      error: "The service account could not be deleted. Reload the page and try again.",
    };
  }

  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (!confirm) {
    return {
      phase: "error",
      error: "Type the service account name to confirm deletion.",
      fieldErrors: { confirm: "Required." },
    };
  }
  if (confirm !== expectedName) {
    return {
      phase: "error",
      error: "The confirmation does not match. Type the exact service account name to delete.",
      fieldErrors: { confirm: "Doesn't match." },
    };
  }

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error:
        "Could not resolve your organization. Reload the page or contact your platform administrator.",
    };
  }

  const result = await deleteServiceAccount(org.id, saID);

  if (result.ok) {
    revalidatePath("/org-admin/service-accounts");
    revalidatePath(`/org-admin/service-accounts/${saID}`);
    redirect(`/org-admin/service-accounts?deleted=${encodeURIComponent(expectedName)}`);
  }
  if (result.notFound) {
    // Treat 404 as success-equivalent — the row is gone, which matches operator intent.
    revalidatePath("/org-admin/service-accounts");
    revalidatePath(`/org-admin/service-accounts/${saID}`);
    redirect(`/org-admin/service-accounts?deleted=${encodeURIComponent(expectedName)}`);
  }
  if (result.forbidden) {
    return {
      phase: "error",
      error: "You do not have permission to delete this service account.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The service account could not be deleted. Reload the page and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

// ── Link a service account to an OAuth client ──────────────────────────────
//
// Slice identuum-20260530-service-account-oauth-client-link-ui.
// The backend route was added in identuum-20260530-service-account-oauth-
// client-link-backend; this server action is the UI wrapper.
//
// SECURITY contract:
//   - Re-validates session via getServerSession + redirects to /login on
//     missing session.
//   - Requires role === "org_admin"; redirects on mismatch.
//   - Derives the actor's organization id server-side via
//     getOwnOrganization(). The form is NEVER trusted to supply an
//     organization_id — Vitest pins the absence of that read.
//   - Reads only the `oauth_client_id` form field (the OAuth client's
//     INTERNAL UUID as listed by listOwnOrganizationClients). The
//     serviceAccountId is curried via .bind so the form never carries
//     it either.
//   - Calls linkServiceAccountToOAuthClient(org.id, saID, oauthClientID).
//   - On success: revalidates both the service-account detail+list AND
//     the applications detail+list (the link updates a column on the
//     OAuth client too). Returns a success state with FOUR safe
//     identifiers — NO credential / secret / hash / private-key / token
//     field crosses the boundary.

export type LinkSAToOAuthClientState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: { oauth_client_id?: string };
    }
  | {
      phase: "success";
      linked: {
        organization_id: string;
        service_account_id: string;
        oauth_client_uuid: string;
        oauth_client_identifier: string;
      };
    };

export async function linkServiceAccountToOAuthClientAction(
  serviceAccountID: string,
  _prev: LinkSAToOAuthClientState,
  formData: FormData
): Promise<LinkSAToOAuthClientState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(serviceAccountID)) {
    return {
      phase: "error",
      error: "The service account could not be linked. Reload the page and try again.",
    };
  }

  const oauthClientID = ((formData.get("oauth_client_id") as string | null) ?? "").trim();
  if (!oauthClientID) {
    return {
      phase: "error",
      error: "Select an OAuth client to link this service account to.",
      fieldErrors: { oauth_client_id: "Required." },
    };
  }
  if (!UUID_RE.test(oauthClientID)) {
    return {
      phase: "error",
      error: "The selected OAuth client id is not a valid UUID.",
      fieldErrors: { oauth_client_id: "Invalid id." },
    };
  }

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error:
        "Could not resolve your organization. Reload the page or contact your platform administrator.",
    };
  }

  const result = await linkServiceAccountToOAuthClient(org.id, serviceAccountID, oauthClientID);

  if (result.ok) {
    // Both halves of the link are mutated server-side (the OAuth
    // client's service_account_id column changes), so both surface's
    // caches need to revalidate so the operator sees fresh data on
    // either side.
    revalidatePath("/org-admin/service-accounts");
    revalidatePath(`/org-admin/service-accounts/${serviceAccountID}`);
    revalidatePath("/org-admin/applications");
    revalidatePath(`/org-admin/applications/${oauthClientID}`);
    return {
      phase: "success",
      linked: {
        organization_id: result.data.organization_id,
        service_account_id: result.data.service_account_id,
        oauth_client_uuid: result.data.oauth_client_uuid,
        oauth_client_identifier: result.data.oauth_client_identifier,
      },
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to link this service account." };
  }
  if (result.notFound) {
    return {
      phase: "error",
      error: "Service account or OAuth client no longer exists. Reload the page and try again.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The link request was rejected. Reload the page and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

// ── Unlink an OAuth client from a service account ─────────────────────────
//
// Slice identuum-20260530-service-account-oauth-client-unlink-ui.
// Server-action wrapper around unlinkServiceAccountFromOAuthClient
// (backend DELETE /api/v1/organizations/:id/service-accounts/:sa_id/oauth-clients/:oauth_client_id/link).
//
// SECURITY contract:
//   - Re-validates session via getServerSession + redirects to /login on
//     missing session.
//   - Requires role === "org_admin"; redirects on mismatch.
//   - Derives the actor's organization id server-side via
//     getOwnOrganization(). The form is NEVER trusted to supply an
//     organization_id — pinned by Vitest.
//   - Reads ONLY the `confirm` form field (a literal "UNLINK" gate the
//     UI submits via a confirmation checkbox/input). The
//     serviceAccountID and oauthClientID are curried via .bind so the
//     form never carries either UUID — pinned by Vitest.
//   - Calls unlinkServiceAccountFromOAuthClient(org.id, saID, oauthClientID).
//   - On 409 (notLinked) returns a safe operator-facing message; this
//     covers both "client is no longer linked to this SA" and
//     "client is now linked to a different SA" — the backend does not
//     disclose which case applies.
//   - On success: revalidates the same four paths the link action does
//     so caches on both halves of the relation re-render. Returns a
//     success state with the FOUR safe identifiers — NO credential /
//     secret / hash / private-key / token field crosses the boundary.

const UNLINK_CONFIRM_LITERAL = "UNLINK";

export type UnlinkSAFromOAuthClientState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: { confirm?: string };
      /** True when the backend returned 409 (not currently linked). The UI uses this to refresh its in-memory linked-state without re-trying. */
      notLinked?: boolean;
    }
  | {
      phase: "success";
      unlinked: {
        organization_id: string;
        service_account_id: string;
        previously_linked_oauth_client_uuid: string;
        previously_linked_oauth_client_identifier: string;
      };
    };

export async function unlinkServiceAccountFromOAuthClientAction(
  serviceAccountID: string,
  oauthClientID: string,
  _prev: UnlinkSAFromOAuthClientState,
  formData: FormData
): Promise<UnlinkSAFromOAuthClientState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(serviceAccountID)) {
    return {
      phase: "error",
      error: "The service account could not be unlinked. Reload the page and try again.",
    };
  }
  if (!UUID_RE.test(oauthClientID)) {
    return {
      phase: "error",
      error: "The OAuth client id is not a valid UUID. Reload the page and try again.",
    };
  }

  // Explicit confirmation gate — the UI must submit a literal "UNLINK"
  // string so an accidental click cannot send the destructive call.
  // The server action re-checks the gate; do not trust client-side
  // gating alone.
  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (confirm !== UNLINK_CONFIRM_LITERAL) {
    return {
      phase: "error",
      error: "Type UNLINK to confirm the unlink.",
      fieldErrors: { confirm: "Type UNLINK to confirm." },
    };
  }

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error:
        "Could not resolve your organization. Reload the page or contact your platform administrator.",
    };
  }

  const result = await unlinkServiceAccountFromOAuthClient(org.id, serviceAccountID, oauthClientID);

  if (result.ok) {
    // Both halves of the relation mutate (oauth_clients.service_account_id
    // is set back to NULL); revalidate both surfaces so the operator
    // sees fresh data on either side.
    revalidatePath("/org-admin/service-accounts");
    revalidatePath(`/org-admin/service-accounts/${serviceAccountID}`);
    revalidatePath("/org-admin/applications");
    revalidatePath(`/org-admin/applications/${oauthClientID}`);
    return {
      phase: "success",
      unlinked: {
        organization_id: result.data.organization_id,
        service_account_id: result.data.service_account_id,
        previously_linked_oauth_client_uuid: result.data.previously_linked_oauth_client_uuid,
        previously_linked_oauth_client_identifier:
          result.data.previously_linked_oauth_client_identifier,
      },
    };
  }
  if (result.notLinked) {
    return {
      phase: "error",
      notLinked: true,
      error:
        "OAuth client is not currently linked to this service account. Reload the page and try again.",
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to unlink this service account." };
  }
  if (result.notFound) {
    return {
      phase: "error",
      error: "Service account or OAuth client no longer exists. Reload the page and try again.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The unlink request was rejected. Reload the page and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

// ── Disable / Enable service account ──────────────────────────────────────
//
// Slice identuum-20260530-service-account-disable-enable-ui.
// Server-action wrappers around disableServiceAccount /
// enableServiceAccount (backend POST .../disable + .../enable).
//
// SECURITY contract (mirrors the existing link/unlink actions):
//   - Re-validates session via getServerSession + redirects on missing.
//   - Requires role === "org_admin"; redirects on mismatch.
//   - Validates the bound serviceAccountID UUID.
//   - Derives the actor's organization id server-side via
//     getOwnOrganization(). The form is NEVER trusted to supply an
//     organization_id — pinned by Vitest.
//   - Disable enforces a literal `confirm === "DISABLE"` gate. Enable
//     uses a lighter "ENABLE" confirmation literal (still an explicit
//     form action; never an idle GET); enable is reversible so the
//     confirmation strictness is correspondingly lighter.
//   - On success: revalidates /org-admin/service-accounts AND
//     /org-admin/service-accounts/<saID> so the detail-page and the
//     list-page re-fetch fresh active state.
//   - Returns a success state with the 8 safe identifiers — NO
//     credential / hash / private-key / token / cookie field crosses
//     the boundary.

const DISABLE_CONFIRM_LITERAL = "DISABLE";
const ENABLE_CONFIRM_LITERAL = "ENABLE";

export type DisableSAState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: { confirm?: string };
    }
  | {
      phase: "success";
      result: {
        organization_id: string;
        service_account_id: string;
        service_account_name: string;
        role: string;
        previous_active: boolean;
        active: boolean;
      };
    };

export type EnableSAState = DisableSAState;

export async function disableServiceAccountAction(
  serviceAccountID: string,
  _prev: DisableSAState,
  formData: FormData
): Promise<DisableSAState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(serviceAccountID)) {
    return {
      phase: "error",
      error: "The service account could not be disabled. Reload the page and try again.",
    };
  }

  // Explicit "DISABLE" type-to-confirm gate. The server action
  // re-checks the same literal so an accidental click cannot send the
  // mutation; do not trust client-side gating alone.
  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (confirm !== DISABLE_CONFIRM_LITERAL) {
    return {
      phase: "error",
      error: "Type DISABLE to confirm.",
      fieldErrors: { confirm: "Type DISABLE to confirm." },
    };
  }

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error:
        "Could not resolve your organization. Reload the page or contact your platform administrator.",
    };
  }

  const result = await disableServiceAccount(org.id, serviceAccountID);
  if (result.ok) {
    revalidatePath("/org-admin/service-accounts");
    revalidatePath(`/org-admin/service-accounts/${serviceAccountID}`);
    return {
      phase: "success",
      result: {
        organization_id: result.data.organization_id,
        service_account_id: result.data.service_account_id,
        service_account_name: result.data.service_account_name,
        role: result.data.role,
        previous_active: result.data.previous_active,
        active: result.data.active,
      },
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to disable this service account." };
  }
  if (result.notFound) {
    return {
      phase: "error",
      error: "Service account no longer exists. Reload the page and try again.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The disable request was rejected. Reload the page and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

export async function enableServiceAccountAction(
  serviceAccountID: string,
  _prev: EnableSAState,
  formData: FormData
): Promise<EnableSAState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(serviceAccountID)) {
    return {
      phase: "error",
      error: "The service account could not be enabled. Reload the page and try again.",
    };
  }

  // Lighter "ENABLE" confirmation literal. Enable is reversible so the
  // strictness is correspondingly lighter than the DISABLE gate, but
  // the action is still an explicit POST form submission — never an
  // idle GET that a stray click could trigger.
  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (confirm !== ENABLE_CONFIRM_LITERAL) {
    return {
      phase: "error",
      error: "Type ENABLE to confirm.",
      fieldErrors: { confirm: "Type ENABLE to confirm." },
    };
  }

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error:
        "Could not resolve your organization. Reload the page or contact your platform administrator.",
    };
  }

  const result = await enableServiceAccount(org.id, serviceAccountID);
  if (result.ok) {
    revalidatePath("/org-admin/service-accounts");
    revalidatePath(`/org-admin/service-accounts/${serviceAccountID}`);
    return {
      phase: "success",
      result: {
        organization_id: result.data.organization_id,
        service_account_id: result.data.service_account_id,
        service_account_name: result.data.service_account_name,
        role: result.data.role,
        previous_active: result.data.previous_active,
        active: result.data.active,
      },
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to enable this service account." };
  }
  if (result.notFound) {
    return {
      phase: "error",
      error: "Service account no longer exists. Reload the page and try again.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The enable request was rejected. Reload the page and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

// ── Edit service account (name / description / role) ──────────────────────
//
// Slice identuum-20260530-service-account-edit-ui. Server-action
// wrapper around updateServiceAccount (backend PATCH
// /api/v1/organizations/:id/service-accounts/:sa_id).
//
// SECURITY contract:
//   - Re-validates session via getServerSession + redirects on missing.
//   - Requires role === "org_admin"; redirects on mismatch.
//   - Validates the bound serviceAccountID UUID.
//   - Derives the actor's organization id server-side via
//     getOwnOrganization(). The form is NEVER trusted to supply an
//     organization_id.
//   - Reads ONLY the documented fields from formData: name,
//     description, role.
//   - Validates: name trimmed + non-empty + max NAME_MAX; description
//     max DESCRIPTION_MAX; role in {org_user, org_admin}.
//   - 409 Conflict (duplicate name) is mapped to a name-field error
//     "Service account name already exists." per the prior backend
//     slice identuum-20260530-service-account-name-conflict-backend.
//   - On success: revalidates /org-admin/service-accounts AND
//     /org-admin/service-accounts/<saID> so both surfaces re-fetch
//     fresh state.
//   - Success state carries the 8 safe identifiers — NO credential /
//     hash / private-key / token / cookie field crosses the boundary.

export type UpdateSAState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: {
        name?: string;
        description?: string;
        role?: string;
      };
    }
  | {
      phase: "success";
      updated: {
        id: string;
        organization_id: string;
        name: string;
        description: string;
        role: string;
        active: boolean;
        created_at: string;
        updated_at: string;
      };
    };

export async function updateServiceAccountAction(
  serviceAccountID: string,
  _prev: UpdateSAState,
  formData: FormData
): Promise<UpdateSAState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(serviceAccountID)) {
    return {
      phase: "error",
      error: "The service account could not be updated. Reload the page and try again.",
    };
  }

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) {
    return {
      phase: "error",
      error: "Enter a service account name.",
      fieldErrors: { name: "Required." },
    };
  }
  if (name.length > NAME_MAX) {
    return {
      phase: "error",
      error: `Service account name is too long (${NAME_MAX} character maximum).`,
      fieldErrors: { name: "Too long." },
    };
  }

  const description = ((formData.get("description") as string | null) ?? "").trim();
  if (description.length > DESCRIPTION_MAX) {
    return {
      phase: "error",
      error: `Description is too long (${DESCRIPTION_MAX} character maximum).`,
      fieldErrors: { description: "Too long." },
    };
  }

  const requestedRole = ((formData.get("role") as string | null) ?? "").trim();
  if (requestedRole === "" || !ALLOWED_ROLES.has(requestedRole)) {
    return {
      phase: "error",
      error: "Role must be either org_admin or org_user.",
      fieldErrors: { role: "Invalid." },
    };
  }

  const org = await getOwnOrganization();
  if (!org?.id) {
    return {
      phase: "error",
      error:
        "Could not resolve your organization. Reload the page or contact your platform administrator.",
    };
  }

  const result = await updateServiceAccount(org.id, serviceAccountID, {
    name,
    description,
    role: requestedRole,
  });
  if (result.ok) {
    revalidatePath("/org-admin/service-accounts");
    revalidatePath(`/org-admin/service-accounts/${serviceAccountID}`);
    return {
      phase: "success",
      updated: {
        id: result.data.id,
        organization_id: result.data.organization_id,
        name: result.data.name,
        description: result.data.description,
        role: result.data.role,
        active: result.data.active,
        created_at: result.data.created_at,
        updated_at: result.data.updated_at,
      },
    };
  }
  if (result.conflict) {
    return {
      phase: "error",
      error: "Service account name already exists.",
      fieldErrors: { name: "Service account name already exists." },
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to edit this service account." };
  }
  if (result.notFound) {
    return {
      phase: "error",
      error: "Service account no longer exists. Reload the page and try again.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The edit request was rejected. Reload the page and try again.",
    };
  }
  return { phase: "error", error: result.message };
}
