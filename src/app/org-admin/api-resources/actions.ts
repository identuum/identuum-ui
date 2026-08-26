"use server";

/**
 * Server actions for /org-admin/api-resources.
 *
 * Surface contract:
 *   - Session re-validated on every action (belt-and-suspenders beyond
 *     the /org-admin layout guard).
 *   - Role checked: only org_admin may invoke these actions.
 *   - Tenant scope is server-injected by the IDP handler from the
 *     actor's session; no action body carries organization_id.
 *   - The IDP's POST /api/v1/api-resources returns a one-time plaintext
 *     `secret`. The success envelope carries it back to the form so the
 *     operator can copy it; the value is never persisted server-side
 *     after the action returns, never logged, never re-fetched.
 *   - revalidatePath fires on the success branch so the list re-renders.
 *
 * Excluded from this slice (do not add here):
 *   - Regenerate secret (POST :id/secret/regenerate exists on the backend).
 *   - Recent activity card (audit events are subject_type=organization;
 *     a backend resource-subject migration would be required first).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createApiResource,
  deleteApiResource,
  rotateApiResourceSecret,
  updateApiResource,
} from "@/lib/idp-admin-client";
import { roleToPath } from "@/lib/role-routing";
import { getServerSession } from "@/lib/server-session";
import { parseScopeLines } from "./scope-parser";

// ── Shared parsers ──────────────────────────────────────────────────────────

const NAME_MAX = 255;
const AUDIENCE_MAX = 255;
const TTL_MIN = 60;
const TTL_MAX = 86400;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// ── Create API resource ─────────────────────────────────────────────────────

export type CreateAPIResourceState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: {
        name?: string;
        audience?: string;
        token_ttl_secs?: string;
        scopes?: string;
      };
    }
  | {
      phase: "success";
      created: {
        id: string;
        name: string;
        audience: string;
        /** SINGLE-SHOT secret. Surface ONCE in the success panel, never persist. */
        secret: string;
      };
    };

export async function createApiResourceAction(
  _prev: CreateAPIResourceState,
  formData: FormData
): Promise<CreateAPIResourceState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) {
    return {
      phase: "error",
      error: "Enter a resource name.",
      fieldErrors: { name: "Required." },
    };
  }
  if (name.length > NAME_MAX) {
    return {
      phase: "error",
      error: `Resource name is too long (${NAME_MAX} character maximum).`,
      fieldErrors: { name: "Too long." },
    };
  }

  const audience = ((formData.get("audience") as string | null) ?? "").trim();
  if (!audience) {
    return {
      phase: "error",
      error: "Enter an audience identifier.",
      fieldErrors: { audience: "Required." },
    };
  }
  if (audience.length > AUDIENCE_MAX) {
    return {
      phase: "error",
      error: `Audience is too long (${AUDIENCE_MAX} character maximum).`,
      fieldErrors: { audience: "Too long." },
    };
  }

  const ttlRaw = ((formData.get("token_ttl_secs") as string | null) ?? "").trim();
  let token_ttl_secs: number | undefined;
  if (ttlRaw.length > 0) {
    const n = Number(ttlRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < TTL_MIN || n > TTL_MAX) {
      return {
        phase: "error",
        error: `Token TTL must be a whole number between ${TTL_MIN} and ${TTL_MAX} seconds.`,
        fieldErrors: { token_ttl_secs: "Invalid." },
      };
    }
    token_ttl_secs = n;
  }

  const scopesParsed = parseScopeLines(formData.get("scopes") as string | null);
  if (!scopesParsed.ok) {
    return {
      phase: "error",
      error: scopesParsed.reason,
      fieldErrors: { scopes: "Invalid." },
    };
  }

  const result = await createApiResource({
    name,
    audience,
    token_ttl_secs,
    scopes: scopesParsed.scopes.length > 0 ? scopesParsed.scopes : undefined,
  });

  if (result.ok) {
    revalidatePath("/org-admin/api-resources");
    return {
      phase: "success",
      created: {
        id: result.data.id,
        name: result.data.name,
        audience: result.data.audience,
        secret: result.data.secret,
      },
    };
  }
  if (result.conflict) {
    return {
      phase: "error",
      error: "An API resource with this audience already exists in your organization.",
      fieldErrors: { audience: "Already in use." },
    };
  }
  if (result.featureUnavailable) {
    return {
      phase: "error",
      error: "API resources are not enabled for this deployment.",
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to create API resources." };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The API resource could not be created. Check the values and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

// ── Update API resource ─────────────────────────────────────────────────────

export type UpdateAPIResourceState =
  | { phase: "idle" }
  | {
      phase: "error";
      error: string;
      fieldErrors?: {
        name?: string;
        token_ttl_secs?: string;
        scopes?: string;
      };
    }
  | { phase: "success"; updated: { id: string; name: string } };

export async function updateApiResourceAction(
  resourceId: string,
  _prev: UpdateAPIResourceState,
  formData: FormData
): Promise<UpdateAPIResourceState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(resourceId)) {
    return {
      phase: "error",
      error: "The API resource could not be updated. Reload the page and try again.",
    };
  }

  const name = ((formData.get("name") as string | null) ?? "").trim();
  if (!name) {
    return {
      phase: "error",
      error: "Enter a resource name.",
      fieldErrors: { name: "Required." },
    };
  }
  if (name.length > NAME_MAX) {
    return {
      phase: "error",
      error: `Resource name is too long (${NAME_MAX} character maximum).`,
      fieldErrors: { name: "Too long." },
    };
  }

  const ttlRaw = ((formData.get("token_ttl_secs") as string | null) ?? "").trim();
  let token_ttl_secs: number | undefined;
  if (ttlRaw.length > 0) {
    const n = Number(ttlRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < TTL_MIN || n > TTL_MAX) {
      return {
        phase: "error",
        error: `Token TTL must be a whole number between ${TTL_MIN} and ${TTL_MAX} seconds.`,
        fieldErrors: { token_ttl_secs: "Invalid." },
      };
    }
    token_ttl_secs = n;
  }

  const active = formData.get("active") === "on";

  const scopesParsed = parseScopeLines(formData.get("scopes") as string | null);
  if (!scopesParsed.ok) {
    return {
      phase: "error",
      error: scopesParsed.reason,
      fieldErrors: { scopes: "Invalid." },
    };
  }

  const result = await updateApiResource(resourceId, {
    name,
    active,
    token_ttl_secs,
    scopes: scopesParsed.scopes,
  });

  if (result.ok) {
    revalidatePath("/org-admin/api-resources");
    revalidatePath(`/org-admin/api-resources/${resourceId}`);
    return {
      phase: "success",
      updated: { id: result.resource.id, name: result.resource.name },
    };
  }
  if (result.featureUnavailable) {
    return {
      phase: "error",
      error: "API resources are not enabled for this deployment.",
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to edit this API resource." };
  }
  if (result.notFound) {
    return { phase: "error", error: "The API resource was not found." };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The API resource could not be updated. Check the values and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

// ── Delete API resource ─────────────────────────────────────────────────────

export type DeleteAPIResourceState =
  | { phase: "idle" }
  | { phase: "error"; error: string; fieldErrors?: { confirm?: string } };

export async function deleteApiResourceAction(
  resourceId: string,
  expectedName: string,
  expectedAudience: string,
  _prev: DeleteAPIResourceState,
  formData: FormData
): Promise<DeleteAPIResourceState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(resourceId)) {
    return {
      phase: "error",
      error: "The API resource could not be deleted. Reload the page and try again.",
    };
  }

  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (!confirm) {
    return {
      phase: "error",
      error: "Type the resource name or audience to confirm deletion.",
      fieldErrors: { confirm: "Required." },
    };
  }
  if (confirm !== expectedName && confirm !== expectedAudience) {
    return {
      phase: "error",
      error: "The confirmation does not match. Type the exact resource name or audience to delete.",
      fieldErrors: { confirm: "Doesn't match." },
    };
  }

  const result = await deleteApiResource(resourceId);

  if (result.ok) {
    revalidatePath("/org-admin/api-resources");
    revalidatePath(`/org-admin/api-resources/${resourceId}`);
    redirect(`/org-admin/api-resources?deleted=${encodeURIComponent(expectedName)}`);
  }
  if (result.notFound) {
    // 404 is success-equivalent — the row is gone.
    revalidatePath("/org-admin/api-resources");
    revalidatePath(`/org-admin/api-resources/${resourceId}`);
    redirect(`/org-admin/api-resources?deleted=${encodeURIComponent(expectedName)}`);
  }
  if (result.featureUnavailable) {
    return {
      phase: "error",
      error: "API resources are not enabled for this deployment.",
    };
  }
  if (result.forbidden) {
    return { phase: "error", error: "You do not have permission to delete this API resource." };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The API resource could not be deleted. Reload the page and try again.",
    };
  }
  return { phase: "error", error: result.message };
}

// ── Rotate API resource secret ──────────────────────────────────────────────
//
// The action is curried with the route's resourceId + the resource's
// display name + its audience via
// rotateApiResourceSecretAction.bind(null, resourceId, resourceName, resourceAudience)
// so the form never carries those values in form data — a tampered POST
// cannot retarget the action at a different resource or pre-set the
// type-to-confirm expectation.
//
// UNLIKE the delete action (which redirects on success), this action MUST
// stay on the same page after success: the success envelope carries the
// freshly-minted plaintext secret and the SecuritySection's SuccessPanel
// surfaces it inside the copy-once banner. A redirect would unmount the
// React state envelope and lose the secret on the way to the next paint.
//
// SECURITY contract:
//   - Session re-validated on every call (belt-and-suspenders beyond
//     the /org-admin layout guard).
//   - Role checked: only org_admin may invoke this action.
//   - Defence-in-depth UUID-shape check on resourceId before any wire
//     call.
//   - The action reads ONLY the `confirm` form field. It NEVER reads
//     organization_id, resource_secret, old_secret, new_secret,
//     secret_hash, or any other secret-shaped form field.
//   - The action never logs anything (no console.*; the operator's
//     `confirm` input is treated as opaque — operators may type a
//     credential by accident).
//   - On success the action revalidates BOTH list + detail caches so
//     the (non-secret) UpdatedAt timestamp surfaces; the secret lives
//     ONLY inside the returned success envelope and the form's
//     in-memory useActionState cell.

export type RotateAPIResourceSecretState =
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
        name: string;
        audience: string;
        /**
         * SINGLE-SHOT plaintext secret. Lives only inside this in-memory
         * state envelope. The SecuritySection SuccessPanel renders it
         * ONCE; the state resets to idle on navigation away.
         */
        secret: string;
      };
    };

export async function rotateApiResourceSecretAction(
  resourceId: string,
  expectedName: string,
  expectedAudience: string,
  _prev: RotateAPIResourceSecretState,
  formData: FormData
): Promise<RotateAPIResourceSecretState> {
  const session = await getServerSession();
  if (!session) redirect("/login?reason=session_expired");
  const role = session.user?.role ?? session.role;
  if (role !== "org_admin") redirect(roleToPath(role));

  if (!UUID_RE.test(resourceId)) {
    return {
      phase: "error",
      error: "The API resource secret could not be rotated. Reload the page and try again.",
    };
  }

  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (!confirm) {
    return {
      phase: "error",
      error: "Type the resource name or audience to confirm rotation.",
      fieldErrors: { confirm: "Required." },
    };
  }
  if (confirm !== expectedName && confirm !== expectedAudience) {
    return {
      phase: "error",
      error:
        "The confirmation does not match. Type the exact resource name or audience to rotate the secret.",
      fieldErrors: { confirm: "Doesn't match." },
    };
  }

  const result = await rotateApiResourceSecret(resourceId);

  if (result.ok) {
    // Cache invalidation BEFORE returning so any cross-tab navigation
    // does not show a stale detail page. The secret itself is NEVER
    // persisted server-side — it crosses the action boundary ONLY
    // through the returned success envelope below.
    revalidatePath("/org-admin/api-resources");
    revalidatePath(`/org-admin/api-resources/${resourceId}`);
    return {
      phase: "success",
      rotated: {
        id: result.data.id,
        name: expectedName,
        audience: expectedAudience,
        secret: result.data.secret,
      },
    };
  }
  if (result.featureUnavailable) {
    return {
      phase: "error",
      error: "API resources are not enabled for this deployment.",
    };
  }
  if (result.forbidden) {
    return {
      phase: "error",
      error: "You do not have permission to rotate this API resource's secret.",
    };
  }
  if (result.notFound) {
    return {
      phase: "error",
      error: "The API resource no longer exists. It may have been removed.",
    };
  }
  if (result.invalid) {
    return {
      phase: "error",
      error: "The API resource secret could not be rotated. Reload the page and try again.",
    };
  }
  return { phase: "error", error: result.message };
}
