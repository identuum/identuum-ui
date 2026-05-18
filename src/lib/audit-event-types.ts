/**
 * Known audit event type values derived from identuum-idp/internal/domain/audit.go constants.
 * Grouped for the event type filter dropdown.
 *
 * Event types not in this list are still valid — the backend accepts any event_type string.
 * When the URL contains an unknown event_type, the select will show "All events" while
 * the backend filter is still applied correctly.
 *
 * Maintainability: update this list when new event types are added to the backend domain.
 */

export interface AuditEventTypeGroup {
  label: string;
  types: readonly string[];
}

/** Convert a snake_case / UPPER_CASE event type to a readable label. */
export function humanizeEventType(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const AUDIT_EVENT_TYPE_GROUPS: readonly AuditEventTypeGroup[] = [
  {
    label: "Authentication & sessions",
    types: [
      "auth_success",
      "auth_failure",
      "logout",
      "session_created",
      "session_revoked",
      "session_expired",
      "mfa_enabled",
      "mfa_disabled",
      "step_up_triggered",
      "step_up_passed",
      "EMERGENCY_LOGIN_DETECTED",
      "concurrent_session_limit",
      "local_login_blocked_by_role",
    ],
  },
  {
    label: "Tokens",
    types: [
      "token_issued",
      "token_refreshed",
      "token_revoked",
      "token_introspected",
      "token_exchanged",
      "token_exchange",
    ],
  },
  {
    label: "Users",
    types: [
      "user_created",
      "bulk_user_created",
      "user_updated",
      "user_deleted",
      "user_restored",
      "user_activated",
      "user_deactivated",
      "password_changed",
      "role_changed",
      "email_verified",
      "email_verification_resent",
      "invitation_consumed",
      "invitation_regenerated",
      "registration_approved",
      "user_password_reset_requested",
      "user_password_reset_completed",
    ],
  },
  {
    label: "Organizations",
    types: [
      "organization_created",
      "organization_updated",
      "organization_deleted",
      "organization_restored",
      "organization_activated",
      "organization_deactivated",
      "organization_admin_last_removed",
      "max_sessions_changed",
      "policy_changed",
    ],
  },
  {
    label: "Security & access",
    types: [
      "data_accessed",
      "access_denied",
      "permission_denied",
      "security_violation",
      "rate_limit_exceeded",
      "anomaly_detected",
      "resource_not_found",
    ],
  },
  {
    label: "OAuth clients",
    types: [
      "client_created",
      "client_updated",
      "client_deleted",
      "dynamic_client_registered",
    ],
  },
  {
    label: "Identity providers",
    types: [
      "identity_provider_created",
      "identity_provider_updated",
      "identity_provider_deleted",
      "consent_granted",
      "consent_denied",
    ],
  },
  {
    label: "Passkeys & WebAuthn",
    types: [
      "webauthn_credential_registered",
      "webauthn_credential_deleted",
      "webauthn_credential_renamed",
    ],
  },
  {
    label: "System & keys",
    types: [
      "signing_key_generated",
      "signing_key_rotated",
      "signing_key_deprecated",
      "signing_key_deleted",
      "signing_key_reloaded",
      "signing_key_auto_rotated",
      "encryption_key_rotated",
      "system_backup_completed",
      "system_backup_failed",
    ],
  },
] as const;

/** Flat set of all known event type values — used to check dropdown selection. */
export const KNOWN_AUDIT_EVENT_TYPES: ReadonlySet<string> = new Set(
  AUDIT_EVENT_TYPE_GROUPS.flatMap((g) => g.types)
);
