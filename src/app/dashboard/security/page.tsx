/**
 * /dashboard/security — compatibility redirect.
 *
 * Personal security settings (passkeys) have moved to the shared
 * /account/settings page, accessible from the account menu in the
 * shell header. This redirect maintains backwards compatibility for
 * any bookmarked URLs.
 *
 * Auth is still enforced by the parent dashboard/layout.tsx, so only
 * authenticated org_users reach this redirect.
 */
import { redirect } from "next/navigation";

export default function DashboardSecurityRedirect() {
  redirect("/account/settings?tab=passkeys");
}
