/**
 * Org-admin settings page — organization settings.
 *
 * Auth and role are enforced by the parent layout (org-admin/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Personal account settings (passkeys, etc.) live at /account/settings.
 */
import { DomainsCard } from "@/components/org-admin/domains-card";
import { InvitePolicyForm } from "@/components/org-admin/invite-policy-form";
import { MFAPolicyForm } from "@/components/org-admin/mfa-policy-form";
import { OrgProfileForm } from "@/components/org-admin/org-profile-form";
import { getOwnOrganization, listOrganizationDomains } from "@/lib/idp-admin-client";
import type { Metadata } from "next";
import {
  ORG_ADMIN_DOMAINS_CARD_COPY,
  ORG_ADMIN_SETTINGS_PAGE_COPY,
  ORG_ADMIN_SETTINGS_PLACEHOLDERS,
  ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE,
} from "./settings-helpers";

export const metadata: Metadata = { title: "Organization Settings — Identuum Org Admin" };

export default async function OrgAdminSettingsPage() {
  const org = await getOwnOrganization();
  const orgName = org?.name ?? "—";
  const domain = org?.domain;
  const mfaPolicy = org?.mfa_policy ?? "optional";
  const invitePolicy = {
    allow_public_registration: org?.allow_public_registration ?? false,
    require_registration_approval: org?.require_registration_approval ?? false,
  };

  // Slice-1 Domains card: server-side fetch the org domains list. If the
  // org is unresolved or the IDP call fails, render an empty list and a
  // load-error banner — never block the rest of the page.
  const domainsResult = org?.id ? await listOrganizationDomains(org.id) : null;
  const domains = domainsResult?.ok ? domainsResult.data.domains : [];
  const domainsLoadError =
    domainsResult && !domainsResult.ok ? ORG_ADMIN_DOMAINS_CARD_COPY.loadError : null;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">
          {ORG_ADMIN_SETTINGS_PAGE_COPY.pageHeading}
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">{ORG_ADMIN_SETTINGS_PAGE_COPY.pageSubtitle}</p>
      </div>

      {/* Organization profile — editable */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">
            {ORG_ADMIN_SETTINGS_PAGE_COPY.profileCardTitle}
          </p>
          <p className="text-xs text-stone-400 mt-0.5">
            {ORG_ADMIN_SETTINGS_PAGE_COPY.profileCardSubtitle}
          </p>
        </div>
        <div className="px-6 py-5">
          <OrgProfileForm currentName={orgName} domain={domain} />
        </div>
      </div>

      {/* Security policy — MFA requirement */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">
            {ORG_ADMIN_SETTINGS_PAGE_COPY.securityCardTitle}
          </p>
          <p className="text-xs text-stone-400 mt-0.5">
            {ORG_ADMIN_SETTINGS_PAGE_COPY.securityCardSubtitle}
          </p>
        </div>
        <div className="px-6 py-5">
          <MFAPolicyForm currentPolicy={mfaPolicy} />
        </div>
      </div>

      {/* Invite policy — write form. Maps the three operator-visible modes
          to the persisted (allow_public_registration, require_registration_approval)
          boolean pair via invitePolicyFlagsFromMode/-FromFlags helpers. */}
      <InvitePolicyForm policy={invitePolicy} />

      {/* Domains card — list/add/verify/set-primary/remove. The DNS-TXT
          challenge value surfaces ONLY immediately after a successful
          add; subsequent renders show only the operator-safe row state. */}
      <DomainsCard domains={domains} loadError={domainsLoadError} />

      {/* Placeholder settings cards (no current placeholders — Domains is now real) */}
      {ORG_ADMIN_SETTINGS_PLACEHOLDERS.map(({ title, description }) => (
        <PlaceholderCard key={title} title={title} description={description} />
      ))}
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
          {ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE}
        </span>
      </div>
    </div>
  );
}
