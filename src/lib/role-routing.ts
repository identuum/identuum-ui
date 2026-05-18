/**
 * Centralized role-to-route mapping for identuum-ui.
 *
 * All components that need to redirect after login import roleToPath() from
 * here. Do not duplicate this mapping in individual components.
 */

import type { UserRole } from "./types";

/**
 * Returns the post-login destination path for a given role.
 *
 *   site_admin → /site-admin
 *   org_admin  → /org-admin
 *   org_user   → /dashboard (and any unrecognised/missing role)
 */
export function roleToPath(role: UserRole | string | undefined): string {
  switch (role) {
    case "site_admin":
      return "/site-admin";
    case "org_admin":
      return "/org-admin";
    default:
      return "/dashboard";
  }
}
