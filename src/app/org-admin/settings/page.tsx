/**
 * Org-admin settings page — organization settings.
 *
 * Auth and role are enforced by the parent layout (org-admin/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Personal account settings (passkeys, etc.) live at /account/settings.
 */
import { MFAPolicyForm } from "@/components/org-admin/mfa-policy-form";
import { OrgProfileForm } from "@/components/org-admin/org-profile-form";
import { getOwnOrganization } from "@/lib/idp-admin-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Organization Settings — Identuum Org Admin" };

export default async function OrgAdminSettingsPage() {
  const org = await getOwnOrganization();
  const orgName = org?.name ?? "—";
  const domain = org?.domain;
  const mfaPolicy = org?.mfa_policy ?? "optional";

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">
          Organization settings
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Configuration and policies for your organization.
        </p>
      </div>

      {/* Organization profile — editable */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Organization profile</p>
          <p className="text-xs text-stone-400 mt-0.5">Update your organization's display name.</p>
        </div>
        <div className="px-6 py-5">
          <OrgProfileForm currentName={orgName} domain={domain} />
        </div>
      </div>

      {/* Security policy — MFA requirement */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Security policy</p>
          <p className="text-xs text-stone-400 mt-0.5">
            Control whether multi-factor authentication is required for members of your
            organization.
          </p>
        </div>
        <div className="px-6 py-5">
          <MFAPolicyForm currentPolicy={mfaPolicy} />
        </div>
      </div>

      {/* Placeholder settings cards */}
      <PlaceholderCard
        title="Domains"
        description="Manage verified domains and control which email domains can join your organization."
      />
      <PlaceholderCard
        title="Invite policy"
        description="Control how new members are invited and what roles they can be assigned."
      />
    </div>
  );
}

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden opacity-60">
      <div className="px-6 py-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-sky-950">{title}</p>
          <p className="text-xs text-stone-400 mt-0.5">{description}</p>
        </div>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-stone-400 bg-stone-100 px-2 py-0.5 rounded mt-0.5">
          Coming soon
        </span>
      </div>
    </div>
  );
}
