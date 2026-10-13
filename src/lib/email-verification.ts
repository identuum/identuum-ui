/**
 * UI-0912-A4 (OSS v0.9.12 C2): how an email address was verified, in plain
 * words. Strings: COPY.md A-10..A-17 (member Overview) and A-60..A-66
 * (org_admin user detail).
 *
 * identuum-idp-oss separates two facts on a user object:
 * - `email_verified`: ACTIVATION, the account may sign in. Lifecycle readers
 *   keep using it.
 * - `email_proven` + `email_verified_via`: the person proved the mailbox
 *   (email_link, upstream_idp, legacy), or how the address was set without
 *   proof (admin_link, admin_set, setup, or null).
 *
 * identuum-idp-ce answers without the two fields: both helpers return null
 * and the screens keep today's display.
 */

export interface EmailVerificationFields {
  email_verified: boolean;
  email_verified_via?: string | null;
  email_proven?: boolean;
}

/** True when the server reported the C2 fields at all. */
function hasC2Fields(u: EmailVerificationFields): boolean {
  return typeof u.email_proven === "boolean";
}

export interface MemberEmailStatus {
  label: string;
  proven: boolean;
}

/** The member Overview's "Email address" row (A-11..A-12). */
export function memberEmailStatus(u: EmailVerificationFields): MemberEmailStatus | null {
  if (!hasC2Fields(u)) return null;
  if (!u.email_proven) return { label: "Not verified yet", proven: false };
  switch (u.email_verified_via) {
    case "email_link":
      return { label: "Verified by email", proven: true };
    case "upstream_idp":
      return { label: "Verified by your sign-in provider", proven: true };
    default:
      // legacy: a pre-upgrade user reads plain "Verified" (owner, A-11c).
      return { label: "Verified", proven: true };
  }
}

/** The org_admin user detail's "Email" status line (A-61..A-66). */
export function adminEmailStatus(u: EmailVerificationFields): string | null {
  if (!hasC2Fields(u)) return null;
  switch (u.email_verified_via) {
    case "email_link":
      return "Verified by email";
    case "upstream_idp":
      return "Verified by the sign-in provider";
    case "legacy":
      return "Verified (before v0.9.12)";
    case "admin_set":
      return "Not verified. Set by an administrator.";
    case "admin_link":
      return "Not verified. Activated with a link from an administrator.";
    case "setup":
      return "Not verified. Set during setup.";
    default:
      return u.email_proven ? "Verified" : "Not verified.";
  }
}

/** Every answer of POST /api/v1/me/email/verification the console tells apart. */
export type SendVerificationOutcome =
  | "sent"
  | "already_verified"
  | "not_configured"
  | "failed"
  | "rate_limited"
  | "not_for_account"
  | "unauthorized";

/** Under the "Not verified yet" badge, without repeating it (U3). */
export const CANNOT_SEND_TEXT = "This server cannot send email, so ask your administrator.";

export const NOT_CONFIGURED_TEXT = `Not verified yet. ${CANNOT_SEND_TEXT}`;

/** One plain line per answer (A-13..A-17). */
export function sendVerificationMessage(
  outcome: Exclude<SendVerificationOutcome, "unauthorized">,
  address: string
): string {
  switch (outcome) {
    case "sent":
      return `Email sent to ${address}. Open the link in it to finish.`;
    case "already_verified":
      return "This address is already verified.";
    case "not_configured":
      return NOT_CONFIGURED_TEXT;
    case "rate_limited":
      return "Too many requests. Try again in a few minutes.";
    case "not_for_account":
      return "Email verification is not available for this account.";
    default:
      return "The email could not be sent. Nothing changed. Try again later.";
  }
}
