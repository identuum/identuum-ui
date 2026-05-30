/**
 * Operational-status derivation for the site-admin organization detail page.
 *
 * This module is intentionally pure — no JSX, no Tailwind classnames, no
 * React imports. The page component composes the derived states with its
 * own presentation layer. Tests target this module to pin the 12-state
 * lifecycle × admin-state matrix and the 5-value next-action enum that
 * UI-FEATURES.md Section 2 documents as load-bearing for operators.
 *
 * Why a separate module: the derivation rules are non-obvious (the
 * `assignmentAllowed = !has_admin || can_assign_admin` boundary in
 * particular is easy to invert during a refactor) and the enum cardinality
 * is small enough that exhaustive vitest coverage is cheap.
 *
 * Input contract: the function takes a minimal `OperationalStatusInput`
 * struct rather than the full `OrgDetail` type so this module is decoupled
 * from `src/lib/types.ts` (which carries unrelated in-flight changes).
 * Callers can adapt their richer type at the call site.
 */

export type LifecycleState = "active" | "inactive" | "deleted";

export type AdminState = "operational" | "expired-pending" | "no-admin" | "suspended";

export type NextAction =
  | "restore"
  | "reactivate"
  | "assign-admin"
  | "reactivate-and-assign"
  | "none";

/** Minimal input shape. Mirrors the four `OrgDetail` fields the card needs. */
export interface OperationalStatusInput {
  active: boolean;
  deleted: boolean;
  has_admin: boolean;
  can_assign_admin: boolean;
}

export interface OperationalStatus {
  lifecycle: LifecycleState;
  adminState: AdminState;
  /**
   * True when the page may legitimately surface an "Assign administrator"
   * affordance. Used directly by the detail page's Actions card and
   * Administrator status card; not the same as `nextAction === "assign-admin"`
   * because an inactive org with no admin should still flag assignment as
   * allowed (the page surfaces both Reactivate and Assign in that case via
   * `nextAction === "reactivate-and-assign"`).
   */
  assignmentAllowed: boolean;
  nextAction: NextAction;
}

/**
 * Derives the full operational-status tuple from the four input flags.
 *
 * Invariants (also pinned by tests):
 *   - `deleted=true` ALWAYS dominates: lifecycle is `deleted`, adminState
 *     is `suspended`, nextAction is `restore` — regardless of any other
 *     flag. Deleted orgs cannot Assign/Reactivate/Deactivate.
 *   - `has_admin=true && can_assign_admin=true` is the "verified-admin
 *     exists but invitation expired" recovery state. UI surfaces
 *     `expired-pending` and allows assignment (recovery delegation).
 *   - `has_admin=true && can_assign_admin=false` is the steady state.
 *     `operational` + no assignment affordance.
 *   - `has_admin=false` always allows assignment (no admin exists, so
 *     delegation cannot conflict with an existing one). adminState is
 *     `no-admin` regardless of `can_assign_admin`.
 *   - Inactive orgs (`!active && !deleted`) need Reactivate; when they
 *     also need an admin the nextAction is the combined
 *     `reactivate-and-assign` so the operator sees both CTAs.
 */
export function deriveOperationalStatus(org: OperationalStatusInput): OperationalStatus {
  const lifecycle: LifecycleState = org.deleted ? "deleted" : org.active ? "active" : "inactive";

  const adminState: AdminState = org.deleted
    ? "suspended"
    : org.has_admin && !org.can_assign_admin
      ? "operational"
      : org.has_admin && org.can_assign_admin
        ? "expired-pending"
        : "no-admin";

  // Assignment is allowed when no verified admin blocks delegation —
  // i.e. either no admin at all, or only unverified admins (the
  // can_assign_admin recovery state).
  const assignmentAllowed = !org.has_admin || org.can_assign_admin;

  const nextAction: NextAction = org.deleted
    ? "restore"
    : !org.active && assignmentAllowed
      ? "reactivate-and-assign"
      : !org.active
        ? "reactivate"
        : assignmentAllowed
          ? "assign-admin"
          : "none";

  return { lifecycle, adminState, assignmentAllowed, nextAction };
}

// ── Operator-facing copy ──────────────────────────────────────────────────────
//
// Exported so the page renders the same strings tests assert against.
// Copy edits that change the operator's understanding of the state must
// go through this single source so a future agent does not silently
// reword "Pending invitation expired" to "Has pending" or similar.

export const LIFECYCLE_COPY: Record<LifecycleState, { label: string; body: string }> = {
  active: {
    label: "Active",
    body: "User logins are permitted.",
  },
  inactive: {
    label: "Inactive",
    body: "User logins are blocked. Reactivate to allow users to sign in.",
  },
  deleted: {
    label: "Archived",
    body: "Organization is soft-deleted. All user logins are blocked. Restore to resume operations.",
  },
};

export const ADMIN_STATE_COPY: Record<AdminState, { label: string; body: string }> = {
  operational: {
    label: "Administrator account active",
    body: "An active administrator account or a valid pending setup invitation is present. No recovery action is needed.",
  },
  "expired-pending": {
    label: "Pending invitation expired",
    body: "An administrator account exists but the setup invitation was never claimed. Recovery delegation is available.",
  },
  "no-admin": {
    label: "No administrator",
    body: "No active administrator account is present. Tenant users cannot manage organization settings without one. Recovery delegation is available.",
  },
  suspended: {
    label: "Admin management suspended",
    body: "Restore the organization to resume administrator management.",
  },
};

// ── Authority-boundary copy ───────────────────────────────────────────────────
//
// The two operator-facing strings below are load-bearing prose. They form
// part of the UI's "Blind Sovereign Bunker" boundary contract: an operator
// reading the site-admin organization detail page must come away with the
// correct mental model that `site_admin` is infrastructure/recovery
// authority, NOT a tenant administrator.
//
// Both strings appear on /site-admin/organizations/[id] and are rendered
// by `page.tsx` via these exported constants. Tests in
// `src/__tests__/site-admin-boundary-copy.test.ts` pin the exact phrasing.
//
// Editing this copy:
//   - Adjustments that *strengthen* the boundary (e.g. "cannot view, list,
//     or manage" → reads stronger than the current "cannot view or list")
//     are welcome but must come with a matching test update.
//   - Edits that *weaken* the boundary — e.g. implying site_admin can
//     "manage all users", "browse tenant users", or otherwise reach into
//     tenant-owned resources — are forbidden by UI-FEATURES.md Section 2
//     and will fail the tests.
//   - Removing the "sovereign bunker" reference is forbidden — that exact
//     phrase is the index into the IDP's `internal/service/user_read_service.go:ListUsersByOrganization`
//     enforcement docstring, so cross-references stay coherent.

export const BOUNDARY_COPY = {
  /**
   * Rendered inside the Administrator status card when the org has an
   * active verified admin and recovery delegation is NOT available
   * (the steady-state "site_admin has nothing to do here" case). Explains
   * why the page intentionally lacks tenant-management links.
   */
  administratorStatusCard:
    "Site administrators cannot view or list tenant organization members. This is enforced by the sovereign bunker policy to preserve tenant privacy boundaries.",

  /**
   * Rendered as the description on the Organization administrators
   * recovery card (Section 5). Scopes the card to `org_admin` rows only
   * and reassures the operator that tenant `org_user` data is NOT
   * exposed even though a per-user listing surface exists.
   */
  recoveryCardDescription:
    "Reset MFA for an administrator who has lost their authenticator. Only org_admin accounts are shown — tenant org_users remain hidden under the sovereign bunker policy.",
} as const;

// ── Actions-card visibility derivation ────────────────────────────────────────
//
// Each value is a stable semantic identifier for one of the action affordances
// the site-admin detail page renders. Tests target this enum and `deriveOrganizationActions`
// so a future agent cannot silently expose a tenant-internal surface or
// collapse the deleted-org restore-only invariant by editing the JSX in
// page.tsx. The page imports the helper and uses `.includes(...)` to gate
// each link.
//
// Identifiers are kept tight by design — only the six lifecycle/admin
// surfaces the site-admin org detail page is supposed to expose. Adding
// a tenant-internal surface (tenant users, OAuth clients, API resources,
// org roles, identity providers, etc.) would violate the Blind Sovereign
// Bunker policy documented in UI-FEATURES.md Section 2 and is intentionally
// not representable here.
export type OrganizationAction =
  | "edit"
  | "deactivate"
  | "reactivate"
  | "assign-admin"
  | "archive"
  | "restore";

/**
 * Derives the ordered list of actions visible on the site-admin
 * organization detail Actions card.
 *
 * Invariants (also pinned by tests):
 *   - `deleted=true` collapses the action set to exactly `["restore"]`.
 *     The deleted dimension dominates `active`, `has_admin`, and
 *     `can_assign_admin`. A deleted org NEVER shows Edit, Deactivate,
 *     Reactivate, Assign admin, or Archive.
 *   - `active=true` produces `edit + deactivate + archive` and optionally
 *     `assign-admin` (when assignment is allowed).
 *   - `active=false && deleted=false` produces `edit + reactivate +
 *     archive` and optionally `assign-admin`.
 *   - `assign-admin` is included iff `assignmentAllowed` is true AND
 *     deleted=false. Assignment is allowed when no verified admin
 *     blocks delegation: `!has_admin || can_assign_admin`.
 *   - Tenant-internal admin surfaces (tenant users, OAuth clients, API
 *     resources, org roles, IDPs) are NOT representable in this enum.
 *
 * Action ordering matches the page's left-to-right render order:
 *   active branch:   edit → deactivate → assign-admin? → archive
 *   inactive branch: edit → reactivate → assign-admin? → archive
 *   deleted branch:  restore
 */
export function deriveOrganizationActions(org: OperationalStatusInput): OrganizationAction[] {
  if (org.deleted) {
    // Deleted dominates. The page never surfaces any other action on a
    // soft-deleted org. Re-deriving this branch instead of falling
    // through to the active/inactive logic is intentional: it makes the
    // "deleted has restore only" invariant load-bearing at the helper
    // level rather than relying on the JSX hiding the other links.
    return ["restore"];
  }

  const out: OrganizationAction[] = ["edit"];
  if (org.active) {
    out.push("deactivate");
  } else {
    out.push("reactivate");
  }
  const assignmentAllowed = !org.has_admin || org.can_assign_admin;
  if (assignmentAllowed) {
    out.push("assign-admin");
  }
  out.push("archive");
  return out;
}

// ── Action metadata: visible label + route suffix ─────────────────────────────
//
// Single source for the operator-visible button label and the sub-route
// that each `OrganizationAction` link targets. The page.tsx Actions card
// reads from this table; tests assert the table directly so a future
// agent cannot silently:
//   - rename "Archive" to "Delete" (the visible label intentionally says
//     Archive because the operation is soft-delete/archival; the
//     destructive-sounding "Delete" label would mislead operators about
//     reversibility)
//   - point an action at a tenant-internal sub-route (`/users`,
//     `/oauth-clients`, etc. — those routes do not exist on the
//     site-admin org detail page by design)
//   - introduce a hard-delete affordance (no "Hard delete" label)
//
// Note: the `archive` action's `route` is `delete` because the
// soft-delete page lives at `/site-admin/organizations/[id]/delete`.
// This is the intentional naming asymmetry — visible label is operator-
// facing, route is backend-facing. Keep both.

export interface OrganizationActionMeta {
  /** Operator-visible button label rendered inside the Actions card. */
  label: string;
  /**
   * Sub-route segment under `/site-admin/organizations/[id]/`. The full
   * href is built by `getOrganizationActionHref(orgID, action)`. Stored
   * without a leading slash so the host-builder cannot be tricked into
   * emitting a protocol-relative path.
   */
  route: string;
}

export const ORGANIZATION_ACTION_META: Record<OrganizationAction, OrganizationActionMeta> = {
  edit: { label: "Edit", route: "edit" },
  deactivate: { label: "Deactivate", route: "deactivate" },
  reactivate: { label: "Reactivate", route: "reactivate" },
  "assign-admin": { label: "Assign admin", route: "assign-admin" },
  archive: { label: "Archive", route: "delete" },
  restore: { label: "Restore", route: "restore" },
};

/** Returns the operator-visible label for the action. */
export function getOrganizationActionLabel(action: OrganizationAction): string {
  return ORGANIZATION_ACTION_META[action].label;
}

/**
 * Builds the full UI href for the action against the supplied org id.
 * Always rooted at `/site-admin/organizations/<orgID>/<route>` so a
 * caller cannot accidentally drop into a protocol-relative or
 * cross-origin link.
 */
export function getOrganizationActionHref(orgID: string, action: OrganizationAction): string {
  return `/site-admin/organizations/${orgID}/${ORGANIZATION_ACTION_META[action].route}`;
}
