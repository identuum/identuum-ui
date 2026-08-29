/**
 * Pure helpers for the /org-admin/users/[id] action card.
 *
 * The page renders four possible affordances under "Actions":
 *   - `disable` / `enable` — the lifecycle pair (mutually exclusive).
 *   - `regenerate-invite` — only for pending invitations.
 *   - `reset-mfa` — only for active org_user targets with MFA enrolled.
 *
 * Visibility is derived from the user's lifecycle state (`active`,
 * `deleted`, `invitation_pending`, the no-email sentinel) plus role
 * (`org_user`, `org_admin`, `site_admin`) and current MFA state.
 *
 * This module exists so the matrix is unit-testable without rendering
 * the page. The component imports `computeOrgUserStatus` and
 * `deriveOrgAdminUserActions` and uses their output to gate the JSX
 * affordances. Rendered output is byte-identical to the previous
 * inline implementation.
 *
 * SECURITY:
 *   - Inputs are projected from the safe `OrgUserItem` wire shape only.
 *   - The `OrgAdminUserAction` union is an exhaustive allowlist. Adding
 *     a tenant-internal surface (e.g. "edit-roles") would require a
 *     code change here that the tests would catch.
 *   - The action labels deliberately use friendly operator copy
 *     ("Suspend access", "Restore access") rather than technical
 *     verbs. Tests pin the exact strings.
 *
 * AUTHORITY BOUNDARY:
 *   - org_admin viewing the /org-admin/users/[id] page MUST NOT see
 *     site_admin-only controls. `site_admin` rows are filtered out of
 *     the actions list entirely; the lifecycle action is hidden,
 *     regenerate-invite is hidden, MFA reset is hidden.
 *   - Last-active-admin protection: when the target is the sole active
 *     `org_admin`, the lifecycle action is suppressed and the page
 *     renders an explanatory copy block instead (caller responsibility,
 *     surfaced via the `soleActiveAdmin` flag in the result).
 */

import type { OrgUserItem } from "@/lib/types";

export type OrgAdminUserStatus = "active" | "pending" | "pending_approval" | "disabled" | "deleted";

// "regenerate-invite" was REMOVED 2026-08-29 (THE-REMAINING-CLICKS): its
// endpoint (POST /api/v1/users/:id/setup/resend) is not mounted on either
// backend, so pending rows surface no action — status display only.
export type OrgAdminUserAction = "disable" | "enable" | "reset-mfa" | "approve-registration";

/**
 * Minimal subset of `OrgUserItem` needed to compute action visibility.
 * Kept locally so the helper is decoupled from `src/lib/types.ts` (which
 * carries unrelated in-flight changes).
 *
 * The `banned` flag mirrors the IDP UserInfo.Banned wire field. The IDP's
 * (*UserService).ApproveRegistration guard is exactly `banned && role ===
 * "org_user"` — the UI must surface the Approve affordance on the same
 * predicate. (Verified via gograph_source: ApproveRegistration sets banned
 * to false on success.)
 */
export interface OrgAdminUserActionInput {
  role: OrgUserItem["role"];
  active: boolean;
  deleted: boolean;
  mfa_enabled: boolean;
  email_verified: boolean;
  email: string;
  invitation_pending: boolean;
  invitation_email_bound: boolean;
  banned: boolean;
}

/**
 * Detects the "manual invite" no-email sentinel address shape. Manual
 * invites are stored against a synthetic email so the row exists
 * server-side, but the operator-facing UI must NOT render the sentinel
 * as if it were a real address. Pattern: `noemail+<uuid>@no-email.internal`.
 */
export function isNoEmailSentinel(email: string): boolean {
  return email.startsWith("noemail+") && email.endsWith("@no-email.internal");
}

/**
 * Derives the operator-facing status from a user's flag set.
 *
 * Precedence:
 *   1. `deleted=true` → `deleted` (terminal — no action affordances).
 *   2. `invitation_pending=true` → `pending`.
 *   3. No-email sentinel + not verified → `pending` (manual-invite case).
 *   4. `banned=true` && role==="org_user" → `pending_approval`
 *      (the IDP creates self-registered users banned=true; only ApproveRegistration
 *      clears it. Surfacing this as its own status keeps Approve as a distinct
 *      affordance instead of being conflated with admin-Disabled accounts.)
 *   5. `active=false` → `disabled`.
 *   6. Otherwise → `active`.
 */
export function computeOrgUserStatus(u: OrgAdminUserActionInput): OrgAdminUserStatus {
  if (u.deleted) return "deleted";
  if (u.invitation_pending) return "pending";
  if (isNoEmailSentinel(u.email) && !u.email_verified) return "pending";
  if (u.banned && u.role === "org_user") return "pending_approval";
  if (!u.active) return "disabled";
  return "active";
}

export interface OrgAdminUserActionsResult {
  status: OrgAdminUserStatus;
  /** Ordered list of action identifiers the page may surface. */
  actions: OrgAdminUserAction[];
  /**
   * True when the target is the sole active org_admin and the lifecycle
   * action would orphan the organization. Caller must render the
   * explanatory copy block in place of the disable button.
   */
  soleActiveAdmin: boolean;
}

/**
 * Action visibility derivation. Input shape mirrors the page's
 * `showLifecycleActions` / `showRegenerate` / `showMFAReset` inline
 * gates verbatim, plus the sole-active-admin guard.
 *
 * `activeAdminCount` is the page-computed count of active non-deleted
 * org_admin rows in this organization. The helper passes through the
 * `soleActiveAdmin` flag; the caller renders the explanatory copy
 * block when the flag fires AND the lifecycle action would otherwise
 * show `disable`.
 *
 * Invariants (also pinned by tests):
 *   - Deleted users surface NO actions.
 *   - site_admin targets surface NO actions on this page (cross-tenant
 *     authority boundary — org_admin cannot manage system identities).
 *   - Pending users surface ONLY `regenerate-invite` (no lifecycle,
 *     no MFA reset — those require a real account first).
 *   - Active org_user with MFA on → `disable` + `reset-mfa`.
 *   - Active org_user with MFA off → `disable` only.
 *   - Active org_admin (not sole) → `disable` only (no MFA reset; admin
 *     MFA is recovered via the site-admin reset path).
 *   - Disabled non-pending non-deleted, non-site-admin → `enable` only.
 *   - The mutual exclusivity of `disable` vs `enable` is enforced by
 *     the `active` flag — the two MUST never appear together.
 */
export function deriveOrgAdminUserActions(
  u: OrgAdminUserActionInput,
  activeAdminCount: number
): OrgAdminUserActionsResult {
  const status = computeOrgUserStatus(u);

  // Deleted users: terminal state, no actions.
  if (status === "deleted") {
    return { status, actions: [], soleActiveAdmin: false };
  }

  // site_admin targets: not manageable from /org-admin. This is the
  // authority-boundary invariant — org_admin must not be presented with
  // any control that mutates a site_admin identity.
  if (u.role === "site_admin") {
    return { status, actions: [], soleActiveAdmin: false };
  }

  // Sole-active-admin guard: only meaningful when the target is an
  // active org_admin and at most one such row exists in the org.
  const soleActiveAdmin = u.role === "org_admin" && u.active && activeAdminCount <= 1;

  const actions: OrgAdminUserAction[] = [];

  // Pending invitations: no actions (the regenerate affordance was removed —
  // its backend endpoint is unmounted); the Pending badge is the surface.
  if (status === "pending") {
    return { status, actions, soleActiveAdmin: false };
  }

  // Pending registration approval: approve-registration only. The IDP rejects
  // the lifecycle Disable/Enable on banned users with ErrInvalidRequest, so we
  // suppress those affordances and surface the single Approve action.
  if (status === "pending_approval") {
    actions.push("approve-registration");
    return { status, actions, soleActiveAdmin: false };
  }

  // Lifecycle pair — mutually exclusive based on `active`. When the
  // target is the sole active org_admin, the caller renders an
  // explanatory copy block instead of the disable button. The action
  // list still contains `disable` in that case so the test pins the
  // intended mutation; the page's JSX handles the suppression.
  if (u.active) {
    actions.push("disable");
  } else {
    // disabled (status === "disabled")
    actions.push("enable");
  }

  // MFA reset: only for active org_user with MFA enrolled. Admin MFA
  // recovery is handled via the site-admin reset path, NOT here.
  if (status === "active" && u.role === "org_user" && u.mfa_enabled) {
    actions.push("reset-mfa");
  }

  return { status, actions, soleActiveAdmin };
}

// ── Action metadata: visible labels for tests + cross-reference ──────────────

export interface OrgAdminUserActionMeta {
  /** Section heading rendered above the action's CTA. */
  sectionLabel: string;
}

export const ORG_ADMIN_USER_ACTION_META: Record<OrgAdminUserAction, OrgAdminUserActionMeta> = {
  disable: { sectionLabel: "Suspend access" },
  enable: { sectionLabel: "Restore access" },
  "reset-mfa": { sectionLabel: "MFA enrollment" },
  "approve-registration": { sectionLabel: "Approve registration" },
};

export function getOrgAdminUserActionLabel(action: OrgAdminUserAction): string {
  return ORG_ADMIN_USER_ACTION_META[action].sectionLabel;
}

// ── Sole-active-admin guard copy ──────────────────────────────────────────────
//
// The exact operator-facing copy rendered by /org-admin/users/[id] when the
// viewed target is the sole active org_admin AND the lifecycle action would
// surface `disable`. The page swaps the destructive disable button for an
// amber explanatory panel using these strings.
//
// These constants are exported so:
//   - the page renders them via {SOLE_ACTIVE_ADMIN_COPY.title} / {.body}
//   - tests can pin the exact strings (a future agent that softens the copy
//     to imply the action is *available* will fail the pin)
//   - the negative-invariant tests can scan the copy strings independently
//     of the surrounding JSX, catching credential-material or
//     site_admin / cross-org leaks
//
// Editing this copy:
//   - Strengthening the guard wording is welcome — update the test in the
//     same change.
//   - Weakening it (implying the operator CAN disable the last active
//     org_admin, or suggesting a cross-org / site_admin workaround) is
//     forbidden by UI-FEATURES.md Section 6b and will fail the tests.
// ── Recent-activity card copy and audit-link href builder ────────────────────
//
// The Recent-activity card on /org-admin/users/[id] surfaces up to eight
// audit events scoped to this user as subject. The card heading, subtitle,
// and "View all →" link label are operator-facing copy; the audit href is
// the navigation target used by the link. Both live as constants/helpers
// here so:
//   - the page renders them via the constants (no inline literals)
//   - tests can pin the exact strings and href shape
//   - a regression that pointed the link at `/site-admin/audit` (instead
//     of `/org-admin/audit`) would surface as both a wire-shape failure
//     AND a UI-FEATURES.md Section 6b authority-boundary violation
//
// SECURITY:
//   - The audit href is built from the subject user id only. Event-type
//     filter is optional and accepts the IDP's documented event-type
//     string (e.g. `user.disabled`). No credential, no session id, no
//     bearer token is reflected in the URL.
//   - The href is always relative — never absolute and never
//     protocol-relative — so a misconfigured runtime cannot route the
//     click off-origin.

export const RECENT_ACTIVITY_COPY = {
  /** Card title rendered in the recent-activity card header. */
  title: "Recent activity",
  /** Card subtitle explaining the scope of the events listed. */
  subtitle: "Latest audit events where this user is the subject.",
  /** Link label rendered top-right of the card. */
  viewAllLabel: "View all →",
} as const;

/**
 * Builds the audit page href for the recent-activity card's "View all"
 * link and (when an event_type is supplied) for any future per-row
 * "View in audit" link.
 *
 * Contract:
 *   - Always rooted at `/org-admin/audit` — NEVER `/site-admin/audit`.
 *     This is the org-admin authority surface; an org_admin must not
 *     be silently routed to the site-admin audit shell which they
 *     cannot access anyway.
 *   - `userID` is URI-encoded before being placed in the `subject_id`
 *     query param so a UUID containing reserved characters could not
 *     break the URL shape.
 *   - `eventType`, when supplied, is also URI-encoded and added as the
 *     `event_type` query param. The current page does not use this
 *     parameter; the optional shape is here so a future "View in
 *     audit" per-row link can use the same helper.
 *   - Returns a path-only string (no scheme, no host, no
 *     protocol-relative leading `//`). Belt-and-suspenders pinned by
 *     tests.
 */
export function buildOrgAdminUserAuditHref(userID: string, eventType?: string): string {
  const base = `/org-admin/audit?subject_id=${encodeURIComponent(userID)}`;
  if (eventType !== undefined && eventType !== "") {
    return `${base}&event_type=${encodeURIComponent(eventType)}`;
  }
  return base;
}

export const SOLE_ACTIVE_ADMIN_COPY = {
  /** Section heading rendered above the explanatory panel. */
  sectionHeading: "Suspend access",
  /** Bold title inside the amber panel. */
  title: "Cannot disable the last active organization admin",
  /**
   * Explanatory body inside the amber panel. Names the corrective
   * action (assign another administrator) and the underlying constraint
   * (one active admin at all times).
   */
  body: "Assign another administrator before suspending this account. This organization must always have at least one active admin.",
} as const;

// ── Approve registration copy ────────────────────────────────────────────────
//
// Rendered on the user detail page when status === "pending_approval". The
// affordance maps to POST /api/v1/users/:id/approve, which the IDP guards
// on `banned=true && role=org_user`.
export const APPROVE_REGISTRATION_COPY = {
  /** Section heading rendered above the Approve button. */
  sectionHeading: "Approve registration",
  /** Description shown beneath the heading. */
  description:
    "This user has registered and is waiting for an administrator to approve their access.",
  /** Button label. */
  buttonLabel: "Approve registration",
  /** Confirmation message after a successful approve. */
  successMessage: "Registration approved. The user can now sign in.",
} as const;

// ── Assigned-roles card copy ─────────────────────────────────────────────────
//
// Rendered on the user detail page below the Actions card. The card surfaces
// the user's currently assigned org roles (GET /api/v1/users/:id/roles) and
// lets the operator assign or remove an existing role. Role creation lives
// on /org-admin/settings and is intentionally out of scope here.
export const USER_ROLES_CARD_COPY = {
  /** Card title. */
  title: "Assigned roles",
  /** Card subtitle. */
  subtitle: "Roles granted to this user in your organization.",
  /** Rendered when the user has no roles assigned. */
  emptyState: "No roles assigned.",
  /** Heading above the assign-role <select>. */
  assignHeading: "Assign role",
  /** Label for the submit button on the assign form. */
  assignButtonLabel: "Assign",
  /** Placeholder shown in the role <select> before a choice is made. */
  selectPlaceholder: "Select a role",
  /** Label for the per-row Remove button. */
  removeButtonLabel: "Remove",
  /** Fallback description when a role has no description set. */
  placeholderDescription: "No description.",
  /** Message rendered when the available-roles list cannot be loaded. */
  availableRolesLoadError:
    "Could not load the organization roles. Try again from the Settings page.",
  /** Message rendered when the assigned-roles list cannot be loaded. */
  assignedRolesLoadError: "Could not load the assigned roles. Reload the page to try again.",
  /** Message rendered when all org roles have already been assigned. */
  noAvailableRoles: "All organization roles are already assigned.",
} as const;
