/** D-021: the public sign-up page's copy (shared by the page, the form and tests). */

import type { RegistrationInfo } from "@/lib/idp-registration-client";

export const REGISTER_CLOSED = "Sign-up is not available";

/**
 * The one message every accepted submission reads, per the organization's
 * settings. The IdP answers 202 for a new address, an existing one and a
 * refused domain alike, so the message never says which it was.
 */
export function registrationAcceptedMessage(
  info: Pick<RegistrationInfo, "verify_email" | "approval_required">
): string {
  if (info.verify_email && info.approval_required) {
    return "If this address can be registered, we have sent it a link to verify it. An administrator then reviews the request before you can sign in.";
  }
  if (info.verify_email) {
    return "If this address can be registered, we have sent it a link to verify it. Open the link, then sign in.";
  }
  if (info.approval_required) {
    return "If this address can be registered, an administrator reviews the request. You can sign in once it is approved.";
  }
  return "If this address can be registered, the account is ready. Sign in with your email and password.";
}
