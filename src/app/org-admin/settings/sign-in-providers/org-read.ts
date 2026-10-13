import type { OwnOrganizationFailureKind } from "@/lib/idp-admin-client";

/**
 * One plain line per cause of a failed organization read (UI-0912-A, C3;
 * COPY A-30..A-32), for the save and remove actions and for the Settings,
 * Add and Edit pages (UI-0912-AB-FIX F5). A "session" failure never reaches
 * it: the callers redirect to sign-in. A page that only read passes no verb
 * and drops "Nothing was …".
 */
export function orgReadFailure(kind: OwnOrganizationFailureKind, verb?: string): string {
  const nothing = verb ? ` Nothing was ${verb}.` : "";
  if (kind === "unavailable") {
    return `The server did not answer.${nothing} Try again in a moment.`;
  }
  if (kind === "forbidden") {
    // U6: the page hides every card that needs the organization, not only
    // the sign-in settings.
    return "You do not have permission to see or change this organization's settings.";
  }
  return `Your organization could not be read.${nothing} Try again.`;
}
