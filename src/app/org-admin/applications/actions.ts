"use server";

/**
 * Server actions for /org-admin/applications/new — the org-admin
 * Create Application surface.
 *
 * Security contract (mirrors the slice-12 domains-actions.ts pattern
 * because the copy-once mechanic is identical to the DNS-TXT
 * challenge):
 *   - Session re-validated on every action (belt-and-suspenders
 *     beyond the /org-admin layout guard).
 *   - Role checked: only org_admin may invoke this action.
 *   - Tenant scope is server-injected by the IDP handler from the
 *     actor's session; the form body NEVER carries organization_id.
 *     The wire helper enforces this with a typed body literal that
 *     does not declare the field.
 *   - The IDP's POST /api/v1/clients returns `client_secret` exactly
 *     once. The success state envelope below carries it back to the
 *     form so the operator can copy it. The value is never persisted
 *     server-side after the action returns, never logged, never
 *     re-fetched. On a subsequent render (or navigation) the state
 *     resets to idle and the secret is gone.
 *   - revalidatePath("/org-admin/applications") runs ONLY on the
 *     success branch so the list re-renders from the IDP without
 *     leaking the secret (the list endpoint never returns it).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createOrganizationClient,
  deleteOrganizationClient,
  rotateOrganizationClientSecret,
  updateOrganizationClient,
} from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";

export type CreateApplicationState =
  | { phase: "idle" }
  | { phase: "error"; error: string; fieldErrors?: { name?: string; redirect_uris?: string } }
  | {
      phase: "success";
      created: {
        id: string;
        client_id: string;
        name: string;
        is_public: boolean;
        /** SINGLE-SHOT secret. Empty string for public clients. */
        client_secret: string;
        redirect_uris: string[];
        token_endpoint_auth_method: string;
      };
    };

/**
 * Returns true when the value looks like a syntactically plausible
 * http(s) redirect URI. Defence-in-depth — the IDP performs the
 * authoritative check. Rejects:
 *   - empty / whitespace-only strings
 *   - javascript: / data: / file: / vbscript: schemes (XSS attack
 *     surface; the IDP also rejects these)
 *   - URIs without a parseable scheme + host
 *
 * Does NOT enforce TLS — http://localhost:* is legitimate for local
 * dev. Production deployments rely on IDP / operator review to
 * enforce https for non-loopback redirect URIs.
 */
function isSafeRedirectURI(raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  // Forbidden schemes regardless of casing.
  if (/^(javascript|data|file|vbscript):/i.test(v)) return false;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!url.host) return false;
  return true;
}

/**
 * Splits a textarea value (one URI per line) into a trimmed,
 * non-empty list. Lines are trimmed individually; empty lines are
 * dropped. Caller may pass undefined / null for optional fields.
 */
function splitLines(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function createApplicationAction(
  _prev: CreateApplicationState,
  formData: FormData
): Promise<CreateApplicationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  // Parse + validate form fields. Each branch returns a discriminated
  // error state so the form can render field-level feedback without
  // forwarding backend prose.
  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) {
    return {
      phase: "error",
      error: "Enter an application name.",
      fieldErrors: { name: "Required." },
    };
  }
  if (name.length > 255) {
    return {
      phase: "error",
      error: "Application name is too long (255 character maximum).",
      fieldErrors: { name: "Too long." },
    };
  }

  const redirectURIs = splitLines(formData.get("redirect_uris") as string | null);
  if (redirectURIs.length === 0) {
    return {
      phase: "error",
      error: "Enter at least one redirect URI.",
      fieldErrors: { redirect_uris: "Required." },
    };
  }
  for (const uri of redirectURIs) {
    if (!isSafeRedirectURI(uri)) {
      return {
        phase: "error",
        error:
          "Each redirect URI must be a valid http(s) URL. Schemes like javascript:, data:, file:, and vbscript: are not allowed.",
        fieldErrors: { redirect_uris: "Invalid URI." },
      };
    }
  }

  const postLogoutURIs = splitLines(formData.get("post_logout_redirect_uris") as string | null);
  // Post-logout URIs are optional but, when present, must be safe.
  for (const uri of postLogoutURIs) {
    if (!isSafeRedirectURI(uri)) {
      return {
        phase: "error",
        error:
          "Each post-logout redirect URI must be a valid http(s) URL. Schemes like javascript:, data:, file:, and vbscript: are not allowed.",
      };
    }
  }

  const allowedAudiences = splitLines(formData.get("allowed_audiences") as string | null);
  const scope = ((formData.get("scope") as string | null) ?? "").trim();
  const isPublic = formData.get("is_public") === "on";

  const result = await createOrganizationClient({
    name,
    redirect_uris: redirectURIs,
    post_logout_redirect_uris: postLogoutURIs.length > 0 ? postLogoutURIs : undefined,
    allowed_audiences: allowedAudiences.length > 0 ? allowedAudiences : undefined,
    scope: scope.length > 0 ? scope : undefined,
    is_public: isPublic,
  });

  if (result.ok) {
    // Revalidate the list so the new client appears on /org-admin/applications.
    revalidatePath("/org-admin/applications");
    return {
      phase: "success",
      created: {
        id: result.data.id,
        client_id: result.data.client_id,
        name: result.data.name,
        is_public: result.data.is_public,
        // SINGLE-SHOT: surface the secret EXACTLY into the action's
        // returned state and nowhere else. The state envelope lives
        // in the form's useActionState memory cell; once the form
        // unmounts or the page navigates away the value is gone.
        client_secret: result.data.client_secret,
        redirect_uris: result.data.redirect_uris,
        token_endpoint_auth_method: result.data.token_endpoint_auth_method,
      },
    };
  }

  if (result.conflict) {
    return {
      phase: "error",
      error: "A client with this configuration already exists in your organization.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The application could not be created. Check the values and try again.",
    };
  }
  return {
    phase: "error",
    error: "Could not create application. Please try again.",
  };
}

// ── Update Application (PUT /api/v1/clients/:id) ───────────────────────────
//
// Security contract:
//   - Session re-validated on every call (belt-and-suspenders beyond
//     the /org-admin layout guard).
//   - Role checked: only org_admin may invoke this action.
//   - The clientId arg is injected via `action.bind(null, id)` from the
//     page-level closure; the client never sends an id from form data,
//     so a tampered POST cannot point this action at a different
//     client. As defence-in-depth the action validates UUID-shape
//     before calling the wire helper.
//   - The action NEVER reads `organization_id`, `client_secret`,
//     `is_public`, `token_endpoint_auth_method`, `jwks_uri`, `jwks`,
//     `token_endpoint_auth_signing_alg`, `service_account_id`,
//     `skip_consent`, or `token_ttl_secs` from the form data — those
//     are intentionally not editable from the org_admin self-service
//     edit surface (each is a separate slice with its own
//     authorisation / audit / UX review).
//   - The IDP's PUT response does NOT include `client_secret` (the
//     ClientResponse literal omits it; `omitempty` drops the empty
//     string from JSON); the wire helper additionally sanitises any
//     regression. This action does not surface a `client_secret` field
//     in its success state.
//   - Cache invalidation fires ONLY on success: both the list
//     (`/org-admin/applications`) and the detail
//     (`/org-admin/applications/[id]`) caches are revalidated on the
//     success branch and nowhere else.

export type UpdateApplicationState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: { name?: string; redirect_uris?: string };
    }
  | { phase: "success"; updated: { id: string; client_id: string; name: string } };

const UPDATE_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function updateApplicationAction(
  clientId: string,
  _prev: UpdateApplicationState,
  formData: FormData
): Promise<UpdateApplicationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  // Defence-in-depth: refuse a non-UUID id. The page-level binding
  // sources the id from the route params, but a hand-crafted POST that
  // bypassed the form binding would not reach here without this gate.
  if (!UPDATE_UUID_RE.test(clientId)) {
    return {
      phase: "error",
      error: "The application could not be updated. Reload the page and try again.",
    };
  }

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) {
    return {
      phase: "error",
      error: "Enter an application name.",
      fieldErrors: { name: "Required." },
    };
  }
  if (name.length > 255) {
    return {
      phase: "error",
      error: "Application name is too long (255 character maximum).",
      fieldErrors: { name: "Too long." },
    };
  }

  const redirectURIs = splitLines(formData.get("redirect_uris") as string | null);
  if (redirectURIs.length === 0) {
    return {
      phase: "error",
      error: "Enter at least one redirect URI.",
      fieldErrors: { redirect_uris: "Required." },
    };
  }
  for (const uri of redirectURIs) {
    if (!isSafeRedirectURI(uri)) {
      return {
        phase: "error",
        error:
          "Each redirect URI must be a valid http(s) URL. Schemes like javascript:, data:, file:, and vbscript: are not allowed.",
        fieldErrors: { redirect_uris: "Invalid URI." },
      };
    }
  }

  const postLogoutURIs = splitLines(formData.get("post_logout_redirect_uris") as string | null);
  for (const uri of postLogoutURIs) {
    if (!isSafeRedirectURI(uri)) {
      return {
        phase: "error",
        error:
          "Each post-logout redirect URI must be a valid http(s) URL. Schemes like javascript:, data:, file:, and vbscript: are not allowed.",
      };
    }
  }

  const allowedAudiences = splitLines(formData.get("allowed_audiences") as string | null);
  const scope = ((formData.get("scope") as string | null) ?? "").trim();

  // Always send the full editable subset. The IDP's update path replaces
  // each non-nil array slice and re-applies each non-nil scalar; the
  // form pre-fills from the current client so the operator's submit
  // intentionally re-asserts every value.
  const result = await updateOrganizationClient(clientId, {
    name,
    redirect_uris: redirectURIs,
    post_logout_redirect_uris: postLogoutURIs,
    allowed_audiences: allowedAudiences,
    scope,
  });

  if (result.ok) {
    // Invalidate both the list page (per-row name + URIs) and the
    // detail page (every safe field) so the next render reflects the
    // new values.
    revalidatePath("/org-admin/applications");
    revalidatePath(`/org-admin/applications/${clientId}`);
    return {
      phase: "success",
      updated: {
        id: result.data.id,
        client_id: result.data.client_id,
        name: result.data.name,
      },
    };
  }

  if (result.forbidden) {
    return {
      phase: "error",
      error: "You do not have permission to update this application.",
    };
  }
  if (result.notFound) {
    return {
      phase: "error",
      error: "The application no longer exists. It may have been removed.",
    };
  }
  if (result.conflict) {
    return {
      phase: "error",
      error: "A client with this configuration already exists in your organization.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The application could not be updated. Check the values and try again.",
    };
  }
  return {
    phase: "error",
    error: "Could not update application. Please try again.",
  };
}

// ── Delete Application (DELETE /api/v1/clients/:id) ────────────────────────
//
// HARD-DELETE on the IDP side. The action is GATED by a type-to-confirm
// check on the client's display name OR its OAuth client_id; the
// server-side check is the load-bearing gate (client-side disabled-
// button UX is only a help, never the gate). On success the action
// invalidates the list cache and redirects to /org-admin/applications
// with a non-secret query-string notice carrying the deleted name so
// the list page can surface a "Deleted X." banner; the detail page
// cache is also revalidated so any cross-tab navigation cannot show
// the row from a stale cache.
//
// Security contract:
//   - Session re-validated on every call (belt-and-suspenders beyond
//     the /org-admin layout guard).
//   - Role checked: only org_admin may invoke this action.
//   - clientId is injected via `action.bind(null, id, name, clientID)`
//     from the page-level closure; the form never carries the id /
//     name / client_id from form data, so a tampered POST cannot
//     point this action at a different client.
//   - Defence-in-depth UUID-shape check on clientId before any wire
//     call.
//   - The action NEVER reads `organization_id`, `client_secret`, or
//     any other secret-shaped form field — the only form field it
//     reads is `confirm` (the type-to-confirm text).
//   - The action NEVER logs the confirm input — operators may type
//     part of a secret by accident; we treat it as opaque.

export type DeleteApplicationState =
  | { phase: "idle" }
  | { phase: "error"; error: string; fieldErrors?: { confirm?: string } };

const DELETE_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function deleteApplicationAction(
  clientId: string,
  expectedName: string,
  expectedClientID: string,
  _prev: DeleteApplicationState,
  formData: FormData
): Promise<DeleteApplicationState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!DELETE_UUID_RE.test(clientId)) {
    return {
      phase: "error",
      error: "The application could not be deleted. Reload the page and try again.",
    };
  }

  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (!confirm) {
    return {
      phase: "error",
      error: "Type the application name or client ID to confirm deletion.",
      fieldErrors: { confirm: "Required." },
    };
  }
  if (confirm !== expectedName && confirm !== expectedClientID) {
    return {
      phase: "error",
      error:
        "The confirmation does not match. Type the exact application name or client ID to delete.",
      fieldErrors: { confirm: "Doesn't match." },
    };
  }

  const result = await deleteOrganizationClient(clientId);

  if (result.ok) {
    revalidatePath("/org-admin/applications");
    revalidatePath(`/org-admin/applications/${clientId}`);
    // Redirect to the list page with a non-secret deleted-name notice
    // so the operator sees a "Deleted <name>." banner on the next
    // paint. The query-string value is URI-encoded; no client_secret /
    // tokens / hashes ever cross this boundary — only the operator-
    // chosen display name.
    redirect(`/org-admin/applications?deleted=${encodeURIComponent(expectedName)}`);
  }

  if (result.forbidden) {
    return {
      phase: "error",
      error: "You do not have permission to delete this application.",
    };
  }
  if (result.notFound) {
    // Treat 404 as success-equivalent — the row is gone, which is the
    // operator's intent. Revalidate + redirect to the list anyway so
    // the stale detail page does not linger.
    revalidatePath("/org-admin/applications");
    revalidatePath(`/org-admin/applications/${clientId}`);
    redirect(`/org-admin/applications?deleted=${encodeURIComponent(expectedName)}`);
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The application could not be deleted. Reload the page and try again.",
    };
  }
  return {
    phase: "error",
    error: "Could not delete application. Please try again.",
  };
}

// ── Rotate Application Secret (POST /api/v1/clients/:id/secret/regenerate) ─
//
// The action is curried with the route's clientId + the client's
// display name + its OAuth client_id via
// `rotateApplicationSecretAction.bind(null, clientId, clientName, clientID)`
// so the form never carries those values in form data. A tampered
// POST cannot retarget the action at a different client or pre-set
// the type-to-confirm expectation.
//
// Unlike the delete action (which redirects on success because the
// detail page no longer exists), this action MUST stay on the same
// page after success: the success envelope carries the freshly-minted
// client_secret and the Security section's SuccessPanel surfaces it
// inside the copy-once banner. A redirect would unmount the React
// state envelope and lose the secret on the way to the next paint.
//
// Security contract:
//   - Session re-validated on every call (belt-and-suspenders beyond
//     the /org-admin layout guard).
//   - Role checked: only org_admin may invoke this action.
//   - Defence-in-depth UUID-shape check on clientId before any wire
//     call.
//   - The action reads ONLY the `confirm` form field. It NEVER reads
//     `organization_id`, `client_secret`, `old_secret`, `new_secret`,
//     `secret_hash`, or any other secret-shaped form field.
//   - The action never logs anything (no console.*; the operator's
//     `confirm` input is treated as opaque — operators may type a
//     credential by accident).
//   - On success the action revalidates BOTH list + detail caches so
//     the (non-secret) UpdatedAt timestamp surfaces; the secret
//     lives ONLY inside the returned success envelope and the form's
//     in-memory useActionState cell.

export type RotateApplicationSecretState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: { confirm?: string };
    }
  | {
      phase: "success";
      rotated: {
        id: string;
        client_id: string;
        name: string;
        /**
         * SINGLE-SHOT secret. Lives only inside this in-memory state
         * envelope. The Security SuccessPanel renders it ONCE; the
         * state resets to idle on navigation away.
         */
        client_secret: string;
      };
    };

const ROTATE_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function rotateApplicationSecretAction(
  clientId: string,
  expectedName: string,
  expectedClientID: string,
  _prev: RotateApplicationSecretState,
  formData: FormData
): Promise<RotateApplicationSecretState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");

  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!ROTATE_UUID_RE.test(clientId)) {
    return {
      phase: "error",
      error: "The client secret could not be rotated. Reload the page and try again.",
    };
  }

  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (!confirm) {
    return {
      phase: "error",
      error: "Type the application name or client ID to confirm rotation.",
      fieldErrors: { confirm: "Required." },
    };
  }
  if (confirm !== expectedName && confirm !== expectedClientID) {
    return {
      phase: "error",
      error:
        "The confirmation does not match. Type the exact application name or client ID to rotate the secret.",
      fieldErrors: { confirm: "Doesn't match." },
    };
  }

  const result = await rotateOrganizationClientSecret(clientId);

  if (result.ok) {
    // Cache invalidation BEFORE returning so any cross-tab navigation
    // does not show a stale detail page; both the list (per-row
    // updated_at) and the detail page (all fields) caches refresh on
    // the next paint. The secret itself is NEVER persisted server-side
    // — it crosses the action boundary ONLY through the returned
    // success envelope below.
    revalidatePath("/org-admin/applications");
    revalidatePath(`/org-admin/applications/${clientId}`);
    return {
      phase: "success",
      rotated: {
        id: result.data.id,
        client_id: result.data.client_id,
        name: result.data.name,
        client_secret: result.data.client_secret,
      },
    };
  }

  if (result.publicClient) {
    return {
      phase: "error",
      error:
        "Public clients do not have a client secret to rotate. This control is for confidential clients only.",
    };
  }
  if (result.forbidden) {
    return {
      phase: "error",
      error: "You do not have permission to rotate this client's secret.",
    };
  }
  if (result.notFound) {
    return {
      phase: "error",
      error: "The application no longer exists. It may have been removed.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The client secret could not be rotated. Reload the page and try again.",
    };
  }
  return {
    phase: "error",
    error: "Could not rotate the client secret. Please try again.",
  };
}
