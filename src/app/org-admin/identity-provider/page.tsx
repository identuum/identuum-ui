/**
 * Org-admin: the old address of the sign-in provider page (v0.9.7-v0.9.11).
 *
 * UI-0912-B moved the providers to the Settings page, with Add and Edit on
 * their own pages and Remove in place. This address stays so old links and
 * test books still work: it opens Settings at the providers card.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign-in providers — Identuum Org Admin" };

export default async function OrgIdentityProviderPage(): Promise<never> {
  redirect("/org-admin/settings#sign-in-providers");
}
