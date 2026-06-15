/**
 * Pure helpers for /org-admin/settings.
 *
 * Owns the operator-facing strings rendered on the settings page AND
 * the MFA-policy form so the matrix is unit-testable without a DOM
 * runtime. The components import these constants; rendered output is
 * byte-identical to the prior inline implementations.
 *
 * SECURITY:
 *   - The MFA policy values mirror the IDP wire shape exactly
 *     (`optional` | `required`). Any new value would require a
 *     coordinated backend change AND a test update here.
 *   - No credential material, no session id, no bearer token is ever
 *     reflected in these constants. Tests pin the negative invariant.
 *
 * AUTHORITY BOUNDARY:
 *   - `/org-admin/settings` is the OWN-ORG settings surface. Every
 *     operator-facing string here must scope to "your organization" /
 *     "this organization" — never imply cross-org or site-admin
 *     authority. Tests pin the negative invariant.
 */

import type { MFAPolicy } from "./actions";

export interface OrgAdminMfaPolicyOption {
  value: MFAPolicy;
  label: string;
  description: string;
}

/**
 * Ordered list of MFA policy options rendered by the MFAPolicyForm.
 * The order is operator-visible (less-strict first, then more-strict)
 * so a future agent reading the form sees the "off → on" progression.
 */
export const ORG_ADMIN_MFA_POLICY_OPTIONS: ReadonlyArray<OrgAdminMfaPolicyOption> = [
  {
    value: "optional",
    label: "Optional",
    description:
      "Users may enroll MFA at any time, but are not required to do so before signing in.",
  },
  {
    value: "required",
    label: "Required",
    description:
      "Users must enroll and complete MFA before login can finish. Existing sessions without MFA are revoked at next sign-in.",
  },
];

/** Returns the operator-facing label for the given MFA policy. */
export function getOrgAdminMfaPolicyLabel(policy: MFAPolicy): string {
  const opt = ORG_ADMIN_MFA_POLICY_OPTIONS.find((o) => o.value === policy);
  return opt?.label ?? policy;
}

// ── MFA-form operator copy ───────────────────────────────────────────────────

export const ORG_ADMIN_MFA_FORM_COPY = {
  /** Success banner text after a policy update. */
  successBanner: "MFA policy updated successfully.",
  /** Idle submit button label. */
  saveLabel: "Save policy",
  /** Mid-submit submit button label. */
  savingLabel: "Saving…",
  /** sr-only legend describing the radio group. */
  legend: "MFA policy",
} as const;

// ── Page-level operator copy ─────────────────────────────────────────────────

export const ORG_ADMIN_SETTINGS_PAGE_COPY = {
  pageHeading: "Organization settings",
  pageSubtitle: "Configuration and policies for your organization.",
  profileCardTitle: "Organization profile",
  profileCardSubtitle: "Update your organization's display name.",
  securityCardTitle: "Security policy",
  securityCardSubtitle:
    "Control whether multi-factor authentication is required for members of your organization.",
} as const;

// ── Placeholder cards ────────────────────────────────────────────────────────

export interface OrgAdminSettingsPlaceholder {
  title: string;
  description: string;
}

/**
 * "Coming soon" placeholder cards rendered below the implemented forms.
 * Tests pin that each remains non-actionable (no link/button) and that the
 * description copy stays scoped to within-org context.
 *
 * Slice 1 of the org-admin Domains UI replaced the previous Domains
 * placeholder with the real DomainsCard component. This list is
 * intentionally empty now — left in place so a future card can be added
 * here without re-introducing the placeholder rendering path.
 */
export const ORG_ADMIN_SETTINGS_PLACEHOLDERS: ReadonlyArray<OrgAdminSettingsPlaceholder> = [];

/** "Coming soon" tag rendered on each placeholder card (no current users — kept for type compatibility). */
export const ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE = "Coming soon" as const;

// ── Domains card copy ────────────────────────────────────────────────────────

/**
 * Operator-facing strings for the Domains card on /org-admin/settings.
 *
 * SCOPE / SECURITY:
 *   - The copy scopes to "your organization" — no cross-org or
 *     site-admin authority language.
 *   - `challengeShownOnce` MUST tell the operator that the TXT value is
 *     surfaced exactly once. The Domains card never re-displays it; the
 *     value is not persisted, logged, or fetched again.
 *   - No copy here names a verification_token_hash, raw token, or
 *     internal challenge identifier. Tests pin the negative invariant.
 *   - Substitution placeholders are denoted by `{domain}` — the
 *     component performs a single `String.replace("{domain}", value)`.
 */
export const ORG_ADMIN_DOMAINS_CARD_COPY = {
  cardTitle: "Domains",
  cardSubtitle:
    "Verify the domains your organization owns. Verified domains gate self-registration to people whose email matches one of them.",
  /** Empty-list copy. */
  emptyState: "No domains yet. Add one below to enable self-registration for that email domain.",
  /** Section above the add-domain input. */
  addLabel: "Add a domain",
  addHelp:
    "Enter the domain you want to verify (e.g. example.com). After you add it we will display a one-time DNS TXT record you must publish.",
  addPlaceholder: "example.com",
  addButton: "Add domain",
  addingLabel: "Adding…",
  /** Per-row affordances. */
  verifyButton: "Verify",
  setPrimaryButton: "Set primary",
  removeButton: "Remove",
  /** Per-row badges. */
  primaryBadge: "Primary",
  verifiedBadge: "Verified",
  pendingBadge: "Pending",
  attemptsLabel: "Verification attempts",
  /** Challenge banner. */
  challengeIntro: "Publish the following DNS TXT record to verify {domain}.",
  challengeShownOnce:
    "Copy the record value now — it will not be shown again. If you lose it, remove the domain and add it again to get a new value.",
  challengeRecordNameLabel: "Record name",
  challengeRecordTypeLabel: "Record type",
  challengeRecordValueLabel: "Record value",
  challengeExpiresAtLabel: "Expires at",
  /** Success banners. */
  verifySuccess: "{domain} has been verified.",
  removeSuccess: "{domain} has been removed.",
  primarySuccess: "{domain} is now the primary domain.",
  /**
   * Verify-failure copy. The verify server action maps known IDP error
   * kinds onto these four operator-safe strings. None of them name the
   * DNS challenge record_value, token, token hash, cookies, or other
   * internal server detail — verify-failure must NEVER echo the
   * challenge material back to the operator.
   *
   * The four kinds:
   *   - recordNotFound: the TXT record is missing at the expected name.
   *   - mismatch:       a TXT record exists but its value is wrong.
   *   - lookupFailed:   the DNS lookup itself failed (network / resolver).
   *   - generic:        any other non-2xx — safe fallback that hides the
   *                     backend message so internal detail is not leaked.
   */
  verifyErrorRecordNotFound:
    "DNS TXT record was not found yet. Publish the record, wait for DNS propagation, then try again.",
  verifyErrorMismatch:
    "DNS TXT record was found, but it does not match the expected value. Check the copied record value and try again.",
  verifyErrorLookupFailed:
    "Identuum could not complete the DNS lookup. Try again shortly or ask your platform administrator to check DNS resolution.",
  verifyErrorGeneric: "Could not verify domain. Please try again.",
  /**
   * Remove-failure copy. The remove server action maps known IDP
   * error kinds onto these three operator-safe strings. The wire
   * never carries the challenge record_value, token, or hash on the
   * delete path — the bundle simply gives the action a consistent
   * source of operator copy and lets tests pin the mapping.
   *
   * The three kinds:
   *   - primaryConflict: backend refused to remove the primary row
   *     (the UI also hides the affordance, but the wire is the final
   *     gate).
   *   - notFound:        domain row was missing / already removed.
   *   - generic:         any other non-2xx — safe fallback that
   *                      hides the backend message.
   */
  removeErrorPrimaryConflict:
    "Cannot remove the primary domain. Set another verified domain as primary first.",
  removeErrorNotFound: "Domain not found.",
  removeErrorGeneric: "Could not remove domain. Please try again.",
  /** Load-error banner shown when the backend list call fails. */
  loadError: "Could not load your domains. Reload the page or try again later.",
} as const;

// ── Organization profile form copy + field metadata ──────────────────────────

/**
 * Operator-facing strings for the Organization profile form
 * (`/org-admin/settings` → "Organization profile" card → `OrgProfileForm`).
 *
 * SECURITY / SCOPE:
 *   - All strings stay scoped to within-org context. A regression that
 *     broadened wording to imply cross-org or site-admin authority is
 *     caught by the brute-force negative invariants in
 *     `src/__tests__/org-admin-settings-profile.test.ts`.
 *   - These are display-only labels. Validation messages produced by
 *     `updateOrgProfileAction` are server-derived and rendered verbatim
 *     via `state.error` / `state.fieldErrors.name`; they are NOT mirrored
 *     here (the form trusts the server envelope).
 */
export const ORG_ADMIN_PROFILE_FORM_COPY = {
  /** Success banner shown after a successful name update. */
  successBanner: "Organization name updated.",
  /** Idle submit button label. */
  saveLabel: "Save profile",
  /** Mid-submit submit button label. */
  savingLabel: "Saving…",
  /** Visible label above the organization name input. */
  nameLabel: "Organization name",
  /** Required-field indicator rendered next to the label. */
  requiredMarker: "*",
  /** Visible label above the read-only Primary domain field. */
  domainLabel: "Primary domain",
  /** Helper copy explaining why the domain field is read-only. */
  domainHelp: "Domain changes affect OIDC discovery and SSO — contact your platform administrator.",
} as const;

/**
 * Metadata for the single editable input on the Organization profile form.
 * The `name` MUST match the FormData key read by `updateOrgProfileAction`;
 * the `maxLength` MUST match the server-side cap (100). A divergence here
 * would let users type past the cap and surface a confusing server error
 * instead of being client-limited up front.
 */
export interface OrgAdminProfileNameField {
  id: string;
  name: string;
  type: "text";
  required: true;
  maxLength: 100;
}

export const ORG_ADMIN_PROFILE_NAME_FIELD: OrgAdminProfileNameField = {
  id: "org-name",
  name: "name",
  type: "text",
  required: true,
  maxLength: 100,
};

// ── Invite policy card (read-only projection) ────────────────────────────────

/**
 * Three operator-visible Invite policy modes derived from the two persisted
 * booleans on the organization row (`allow_public_registration` +
 * `require_registration_approval`):
 *
 *   - "invite-only"            → allow_public_registration === false
 *   - "public-with-approval"   → allow_public_registration === true  AND
 *                                require_registration_approval === true
 *   - "public-immediate"       → allow_public_registration === true  AND
 *                                require_registration_approval === false
 *
 * When `allow_public_registration === false`, the `require_registration_approval`
 * value is irrelevant in product behavior — there is no public path to gate.
 * The mode derivation collapses that case to "invite-only" without inspecting
 * the second field.
 *
 * The mode is read-only on `/org-admin/settings`. Write support is intentionally
 * deferred: a four-state matrix needs product sign-off across all combinations
 * before a self-service mutation form would be safe. Direct invitations remain
 * available via `/org-admin/users` regardless of the mode (the mode controls
 * the SELF-registration path, not the admin-driven invitation path).
 */
export type OrgAdminInvitePolicyMode = "invite-only" | "public-with-approval" | "public-immediate";

export interface OrgAdminInvitePolicyInput {
  allow_public_registration: boolean;
  require_registration_approval: boolean;
}

export function deriveOrgAdminInvitePolicyMode(
  input: OrgAdminInvitePolicyInput
): OrgAdminInvitePolicyMode {
  if (!input.allow_public_registration) return "invite-only";
  if (input.require_registration_approval) return "public-with-approval";
  return "public-immediate";
}

export interface OrgAdminInvitePolicyModeCopy {
  label: string;
  description: string;
}

export const ORG_ADMIN_INVITE_POLICY_MODE_COPY: Readonly<
  Record<OrgAdminInvitePolicyMode, OrgAdminInvitePolicyModeCopy>
> = {
  "invite-only": {
    label: "Invite-only",
    description:
      "New members join your organization only when an organization administrator sends them an invitation.",
  },
  "public-with-approval": {
    label: "Public self-registration with approval",
    description:
      "Anyone whose email matches your organization's verified domain may request access. Each request stays pending until an organization administrator approves it.",
  },
  "public-immediate": {
    label: "Public self-registration",
    description:
      "Anyone whose email matches your organization's verified domain may self-register. New accounts become active immediately without administrator approval.",
  },
};

/** Returns the operator-facing copy bundle for the given mode. */
export function getOrgAdminInvitePolicyModeCopy(
  mode: OrgAdminInvitePolicyMode
): OrgAdminInvitePolicyModeCopy {
  return ORG_ADMIN_INVITE_POLICY_MODE_COPY[mode];
}

export const ORG_ADMIN_INVITE_POLICY_CARD_COPY = {
  cardTitle: "Invite policy",
  cardSubtitle:
    "How new members can join your organization. Direct invitations sent from the Users page are always available.",
  /** Label rendered above the derived mode label inside the card. */
  currentModeLabel: "Current mode",
  /** sr-only legend describing the read-only card. */
  legend: "Invite policy summary",
  /** Footer line that points the operator at the direct-invitation surface. */
  directInviteHint: "Send a direct invitation from the Users page.",
  /** Operator-facing href for the direct-invitation surface. */
  directInviteHref: "/org-admin/users",
  /** Operator-facing visible link label. */
  directInviteLinkLabel: "Open Users page →",
} as const;

// ── Invite policy write-path helpers ────────────────────────────────────────

/**
 * Returns the persisted `(allow_public_registration, require_registration_approval)`
 * boolean pair for a documented mode. This is the inverse of
 * `deriveOrgAdminInvitePolicyMode` — combined they round-trip without loss
 * across the three valid modes.
 *
 * For `invite-only` the approval flag is product-irrelevant (there is no
 * public path to gate); the canonical persisted value is `false` so the
 * stored row is unambiguous and the round-trip is stable.
 */
export function invitePolicyFlagsFromMode(mode: OrgAdminInvitePolicyMode): {
  allow_public_registration: boolean;
  require_registration_approval: boolean;
} {
  switch (mode) {
    case "invite-only":
      return { allow_public_registration: false, require_registration_approval: false };
    case "public-with-approval":
      return { allow_public_registration: true, require_registration_approval: true };
    case "public-immediate":
      return { allow_public_registration: true, require_registration_approval: false };
  }
}

/** Convenience alias matching the task spec's preferred helper shape. */
export const invitePolicyModeFromFlags = deriveOrgAdminInvitePolicyMode;

/** Returns the operator-facing label for a mode. */
export function invitePolicyModeLabel(mode: OrgAdminInvitePolicyMode): string {
  return ORG_ADMIN_INVITE_POLICY_MODE_COPY[mode].label;
}

/**
 * Validates a flag pair. The only persisted-row combination that has no
 * matching documented mode is `allow=false × approval=true` — the approval
 * flag is meaningless when self-registration is off, so this combination
 * is treated fail-closed. UI must never produce a payload in this shape.
 */
export function isValidInvitePolicyFlags(
  allow_public_registration: boolean,
  require_registration_approval: boolean
): boolean {
  if (!allow_public_registration && require_registration_approval) {
    return false;
  }
  return true;
}

// ── Invite policy form copy (write-path) ────────────────────────────────────

export const ORG_ADMIN_INVITE_POLICY_FORM_COPY = {
  /** Success banner shown after a successful save. */
  successBanner: "Invite policy updated successfully.",
  /** Idle submit button label. */
  saveLabel: "Save invite policy",
  /** Mid-submit submit button label. */
  savingLabel: "Saving…",
  /**
   * sr-only legend describing the radio group. Intentionally distinct from
   * the card title "Invite policy" so screen readers AND Playwright's
   * text-based locators can disambiguate (the card title and the legend
   * would otherwise both surface as the same string and trigger
   * strict-mode matches against `getByText("Invite policy", exact: true)`).
   */
  legend: "Invite policy mode",
  /**
   * Read-only warning rendered ONLY when the persisted flags fall into the
   * documented invalid combination (`allow=false × approval=true`). The card
   * surfaces this as a "Choose a valid mode below to repair this row" prompt
   * — the row is not editable in any other way.
   */
  invalidStateBanner:
    "The stored invite policy combination is not a valid product mode. Choose a mode below and save to repair this row.",
} as const;
