/**
 * Org-admin settings page — organization settings.
 *
 * Auth and role are enforced by the parent layout (org-admin/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Personal account settings (passkeys, etc.) live at /account/settings.
 */

import type { Metadata } from "next";
import { ProtocolSettingsPanel } from "@/app/site-admin/organizations/[id]/protocol-settings-panel";
import { DomainsCard } from "@/components/org-admin/domains-card";
import { MFAPolicyForm } from "@/components/org-admin/mfa-policy-form";
import { OrgProfileForm } from "@/components/org-admin/org-profile-form";
import { ServiceAccountExpiryForm } from "@/components/org-admin/service-account-expiry-form";
import { getAuthorizationServerPageBoundary } from "@/lib/capability-affordances";
import {
  getOrgProtocolSettings,
  getOwnOrganization,
  listOrganizationDomains,
  listOrganizationIdentityProviders,
  listOrgRoles,
  listScopeTemplates,
} from "@/lib/idp-admin-client";
import { getOrgRegistration, getRegistrationInfoSignedIn } from "@/lib/idp-registration-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { SelfRegistrationSection } from "./self-registration-section";
import {
  ORG_ADMIN_DOMAINS_CARD_COPY,
  ORG_ADMIN_SA_EXPIRY_COPY,
  ORG_ADMIN_SETTINGS_PAGE_COPY,
  ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE,
  ORG_ADMIN_SETTINGS_PLACEHOLDERS,
} from "./settings-helpers";
import {
  IdentityProvidersReadOnlySection,
  OrgRolesReadOnlySection,
  ScopeTemplatesReadOnlySection,
} from "./settings-readonly-sections";

export const metadata: Metadata = { title: "Organization Settings — Identuum Org Admin" };

export default async function OrgAdminSettingsPage() {
  const org = await getOwnOrganization();
  const orgName = org?.name ?? "—";
  const domain = org?.domain;
  const mfaPolicy = org?.mfa_policy ?? "optional";
  const runtimeState = await getServerRuntimeState();
  const idpCapabilities = runtimeState?.components.idp.capabilities;
  // CE-UI-5a: an IdP without self-registration (identuum-idp-ce) is not asked.
  const selfRegistrationServed = idpCapabilities?.self_registration !== false;
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
    rolesResult,
    scopeTemplatesResult,
    protocolSettings,
    registration,
    registrationInfo,
  ] = orgID
    ? await Promise.all([
        listOrganizationDomains(orgID),
        listOrganizationIdentityProviders(orgID),
        listOrgRoles(orgID),
        scopeTemplatesCapabilityBoundary ? null : listScopeTemplates(),
        protocolSettingsCapabilityBoundary ? null : getOrgProtocolSettings(orgID).catch(() => null),
        selfRegistrationServed ? getOrgRegistration(orgID) : null,
        selfRegistrationServed && org?.slug ? getRegistrationInfoSignedIn(org.slug) : null,
      ])
    : ([null, null, null, null, null, null, null] as const);
  // An org_admin cannot read the site_admin instance switch. An organization
  // whose own setting is open but whose public sign-up reads closed is held
  // shut by the switch; a save the IdP refuses with 409 says the same.
  const registrationSettings = registration?.ok ? registration.value : null;
  const instanceOff =
    registrationSettings?.allow_public_registration === true &&
    registrationInfo?.ok === true &&
    registrationInfo.value.open === false;
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

      {/* Organization profile and security policy — the organization's own
          administrator sets its name and policies (owner ruling,
          identuum-idp-oss v0.9.5: a site administrator changes only an
          organization's lifecycle). The registration policy is the
          Self-registration section below. */}
      <SettingsCard
        title={ORG_ADMIN_SETTINGS_PAGE_COPY.profileCardTitle}
        subtitle={ORG_ADMIN_SETTINGS_PAGE_COPY.profileCardSubtitle}
      >
        <OrgProfileForm currentName={orgName} domain={domain} />
      </SettingsCard>
      <SettingsCard
        title={ORG_ADMIN_SETTINGS_PAGE_COPY.securityCardTitle}
        subtitle={ORG_ADMIN_SETTINGS_PAGE_COPY.securityCardSubtitle}
      >
        <MFAPolicyForm currentPolicy={mfaPolicy} />
      </SettingsCard>
      {/* Service-account expiry — the organization's own setting, set by its
          org_admin (OSS-SA-EXPIRY-2, owner rulings e and g). */}
      <SettingsCard
        title={ORG_ADMIN_SA_EXPIRY_COPY.cardTitle}
        subtitle={ORG_ADMIN_SA_EXPIRY_COPY.cardSubtitle}
      >
        <ServiceAccountExpiryForm currentDays={org?.service_account_expiry_days} />
      </SettingsCard>

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

      {orgID && selfRegistrationServed && (
        <SelfRegistrationSection
          orgId={orgID}
          slug={org?.slug ?? ""}
          initial={registrationSettings}
          mailDelivery={idpCapabilities?.mail_ceremonies !== false}
          instanceOff={instanceOff}
        />
      )}

      {/* Domains card — list/add/verify/set-primary/remove. The DNS-TXT
          challenge value surfaces ONLY immediately after a successful
          add; subsequent renders show only the operator-safe row state. */}
      <DomainsCard
        domains={domains}
        loadError={domainsLoadError}
        selfRegistration={selfRegistrationServed}
      />

      {/* Read-only observability sections landed by
          identuum-20260530-org-admin-settings-readonly-tabs. Each
          section renders ONLY the operator-safe field set returned
          by its wire helper; mutation (create / edit / delete) is
          intentionally not available from this page. */}
      {identityProvidersResult && (
        <IdentityProvidersReadOnlySection result={identityProvidersResult} />
      )}
      {rolesResult && <OrgRolesReadOnlySection result={rolesResult} />}
      {/* CE-UI-5a: an IdP that does not serve scope templates gets no
          section at all, not a "not exposed" panel. */}
      {scopeTemplatesResult && (
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

function SettingsCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 className="text-sm font-semibold text-sky-950">{title}</h2>
        <p className="text-xs text-stone-400 mt-0.5">{subtitle}</p>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
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
