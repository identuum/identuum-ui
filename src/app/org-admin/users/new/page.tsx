/**
 * Org-admin Invite user page (OSS-ONBOARD-B, owner ruling D-016).
 *
 * Auth and role are enforced by the parent /org-admin layout. The page exists
 * only where the IdP mounts the user invite (capabilities.user_invite true);
 * elsewhere it is not found, as the Invite user entry is hidden.
 *
 * The org_admin names the user and their role (Member or Admin — the IdP
 * refuses anything else from an org_admin) and hands over the one-time link
 * shown once on success. Where the IdP sends mail it also mails the link.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { userInviteAvailable } from "@/lib/mail-capabilities";
import { InviteUserForm } from "./form-client";

export const metadata: Metadata = { title: "Invite user — Identuum Org Admin" };

export default async function InviteUserPage() {
  if (!(await userInviteAvailable())) notFound();
  return (
    <div className="space-y-6 max-w-2xl">
      <a
        href="/org-admin/users"
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to users
      </a>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Invite user</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          The user sets their own password from a one-time link you hand over. They are pending
          until then.
        </p>
      </div>
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-5">
        <InviteUserForm />
      </div>
    </div>
  );
}
