/**
 * Org-admin settings page — organization settings.
 *
 * Auth and role are enforced by the parent layout (org-admin/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Personal account settings (passkeys, etc.) live at /account/settings.
 */
import { ProtocolSettingsPanel } from "@/app/site-admin/organizations/[id]/protocol-settings-panel";
import { DomainsCard } from "@/components/org-admin/domains-card";
import { InvitePolicyForm } from "@/components/org-admin/invite-policy-form";
import { MFAPolicyForm } from "@/components/org-admin/mfa-policy-form";
import { OrgProfileForm } from "@/components/org-admin/org-profile-form";
import { getAuthorizationServerPageBoundary } from "@/lib/capability-affordances";
import {
  getOrgProtocolSettings,
  getOwnOrganization,
  listOrgRoles,
  listOrganizationDomains,
  listOrganizationIdentityProviders,
  listOrganizationWebhooks,
  listScopeTemplates,
} from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type { Metadata } from "next";
import {
  ORG_ADMIN_DOMAINS_CARD_COPY,
  ORG_ADMIN_SETTINGS_PAGE_COPY,
  ORG_ADMIN_SETTINGS_PLACEHOLDERS,
  ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE,
} from "./settings-helpers";
import {
  IdentityProvidersReadOnlySection,
  OrgRolesReadOnlySection,
  ScopeTemplatesReadOnlySection,
  WebhooksReadOnlySection,
} from "./settings-readonly-sections";

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
  const runtimeState = await getServerRuntimeState();
  const idpCapabilities = runtimeState?.components.idp.capabilities;
  const scopeTemplatesCapabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: idpCapabilities,
    surface: "scope_templates",
  });
  const protocolSettingsCapabilityBoundary = getAuthorizationServerPageBoundary({
    capabilities: idpCapabilities,
    surface: "protocol_settings",
  });

  // Slice-1 Domains card + the 4 read-only observability sections
  // landed by identuum-20260530-org-admin-settings-readonly-tabs.
  // Fetch in parallel so an individual section's network failure
  // does not block the rest of the page; each section renders its
  // own error / forbidden / feature-unavailable branch.
  const orgID = org?.id ?? "";
  const [
    domainsResult,
    identityProvidersResult,
    webhooksResult,
    rolesResult,
    scopeTemplatesResult,
    protocolSettings,
  ] = orgID
    ? await Promise.all([
        listOrganizationDomains(orgID),
        listOrganizationIdentityProviders(orgID),
        listOrganizationWebhooks(orgID),
        listOrgRoles(orgID),
        scopeTemplatesCapabilityBoundary ? null : listScopeTemplates(),
        protocolSettingsCapabilityBoundary ? null : getOrgProtocolSettings(orgID).catch(() => null),
      ])
    : ([null, null, null, null, null, null] as const);
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

      {/* Protocol settings card — same-org org_admin can manage DCR Foundation
          and view the SCIM Enterprise/CE boundary for their own organization. Fetched in
          parallel with the rest of the page. Returns a discriminated result;
          the panel renders per-reason copy for 401/403/404/network failures.
          orgID is always the session-derived own-org ID — no cross-org
          picker exists on this page. */}
      {orgID && (
        <ProtocolSettingsPanel
          orgId={orgID}
          initialSettings={protocolSettings}
          capabilityBoundary={protocolSettingsCapabilityBoundary}
        />
      )}

      {/* Domains card — list/add/verify/set-primary/remove. The DNS-TXT
          challenge value surfaces ONLY immediately after a successful
          add; subsequent renders show only the operator-safe row state. */}
      <DomainsCard domains={domains} loadError={domainsLoadError} />

      {/* Read-only observability sections landed by
          identuum-20260530-org-admin-settings-readonly-tabs. Each
          section renders ONLY the operator-safe field set returned
          by its wire helper; mutation (create / edit / delete) is
          intentionally not available from this page. */}
      {identityProvidersResult && (
        <IdentityProvidersReadOnlySection result={identityProvidersResult} />
      )}
      {webhooksResult && <WebhooksReadOnlySection result={webhooksResult} />}
      {rolesResult && <OrgRolesReadOnlySection result={rolesResult} />}
      {(scopeTemplatesResult || scopeTemplatesCapabilityBoundary) && (
        <ScopeTemplatesReadOnlySection
          result={scopeTemplatesResult}
          capabilityBoundary={scopeTemplatesCapabilityBoundary}
        />
      )}

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
