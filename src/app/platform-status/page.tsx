/**
 * /platform-status
 *
 * Runtime composition status page. Shows the current platform mode and
 * the live discovery state of each configured backend.
 *
 * This page calls the backend /api/v1/component endpoints server-side via
 * getServerRuntimeState(). It is the intended entry point when the root
 * page detects a misconfigured state.
 *
 * Security: no internal backend URLs, tokens, session data, or stack
 * traces are rendered. Only public metadata from each backend is shown.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AGCEOrgLinkAvailabilityCard } from "@/components/shared/ag-ce-org-link-availability-card";
import { LocalTime } from "@/components/ui/local-time";
import { fetchAgAuthProviders } from "@/lib/ag-auth-providers";
import { getCapabilityAvailability } from "@/lib/runtime-composition";
import { agBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type {
  AgAuthProviderDiscoveryState,
  BackendComponentState,
  ComponentCapabilities,
  ComponentLicenseInfo,
  PlatformMode,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Platform Status — Identuum" };

export default async function PlatformStatusPage() {
  const state = await getServerRuntimeState();
  const cfg = loadRuntimeConfig();
  const agUrl = cfg?.ag.enabled ? agBaseUrl(cfg) : null;

  const agProviders = await fetchAgAuthProviders(agUrl);

  if (!state) {
    return <SetupRequiredPrompt />;
  }

  // Read the AG CE-specific org-link availability verdict from the
  // composed runtime state (2026-07-08). The readiness probe round-trip
  // was moved into `getServerRuntimeState` so this page no longer fetches
  // it directly — same verdict, single cached source of truth across
  // pages. `null` when AG is not enabled in the UI runtime config; the
  // page then skips the AG CE availability callout entirely.
  const agCEAvailability = state.agCEOrgLinkAvailability ?? null;

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-sky-950 tracking-tight">Platform Status</h1>
          <p className="text-sm text-stone-500 mt-1">
            Live discovery state of configured Identuum backends.
          </p>
        </div>

        <ModeBadge mode={state.mode} />

        <div className="space-y-4">
          {/* ABSENCE IS NOT FAILURE (THE-ABSENT-BACKEND): a backend that is
              not enabled in the runtime config is not mentioned at all — no
              card, no error, no callout. The ModeBadge above already carries
              the composition vocabulary ("Identity Only", …). A backend that
              IS enabled but unreachable still renders its card with
              "Unavailable" — that distinction is the point. */}
          {cfg?.idp.enabled && (
            <BackendCard
              label="Identity (IDP)"
              abbreviation="IDP"
              backend={state.components.idp}
              expectedComponent="identuum-idp"
            />
          )}
          {cfg?.ag.enabled && (
            <BackendCard
              label="Agent Governance (AG)"
              abbreviation="AG"
              backend={state.components.ag}
              expectedComponent="identuum-ag"
            />
          )}
          {/* AG auth provider discovery — shown when AG is configured */}
          {(cfg?.ag.enabled || agProviders.available || agProviders.error_code) && (
            <AgAuthProviderCard providers={agProviders} />
          )}
          {/* AG CE org-link availability — read-only callout. Surfaced
              here so an operator inspecting platform health sees the
              same 4-variant verdict that drives /site-admin/org-link/
              readiness. No link/unlink CTAs on /platform-status —
              actionable variant drills into /readiness only. Verdict
              composed by `getServerRuntimeState` (2026-07-08); shared
              component lives at
              `src/components/shared/ag-ce-org-link-availability-card.tsx`
              (2026-07-06 refactor). Skipped entirely when AG is not
              enabled in the UI runtime config. */}
          {agCEAvailability && (
            <AGCEOrgLinkAvailabilityCard
              availability={agCEAvailability}
              actionableTarget={{
                href: "/site-admin/org-link/readiness",
                label: "Open readiness",
              }}
              copyVariant="operational-health"
            />
          )}
        </div>

        <div className="border-t border-stone-200 pt-4 flex flex-wrap gap-6">
          <a href="/" className="text-sm text-sky-600 hover:text-sky-700 underline">
            Return to home
          </a>
          {/* Org linking is an IDP↔AG feature — the drill-in is only offered
              when AG is enabled (absence is not mentioned). */}
          {cfg?.ag.enabled && (
            <a
              href="/site-admin/org-link/readiness"
              className="text-sm text-stone-500 hover:text-stone-700 underline"
            >
              Organization linking readiness
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: PlatformMode }) {
  const config: Record<PlatformMode, { label: string; colorClass: string; description: string }> = {
    "full-platform": {
      label: "Full Platform",
      colorClass: "bg-emerald-100 text-emerald-800 border-emerald-200",
      description: "Both Identity and Agent Governance backends are operational.",
    },
    "identity-only": {
      label: "Identity Only",
      colorClass: "bg-sky-100 text-sky-800 border-sky-200",
      description: "Only the Identity backend is configured and operational.",
    },
    "agent-governance-only": {
      label: "Agent Governance Only",
      colorClass: "bg-sky-100 text-sky-800 border-sky-200",
      description: "Only the Agent Governance backend is configured and operational.",
    },
    "degraded-idp-unavailable": {
      label: "Degraded — Identity Unavailable",
      colorClass: "bg-amber-100 text-amber-800 border-amber-200",
      description:
        "The Identity backend is configured but is not responding correctly. Agent Governance is operational.",
    },
    "degraded-ag-unavailable": {
      label: "Degraded — AG Unavailable",
      colorClass: "bg-amber-100 text-amber-800 border-amber-200",
      description:
        "The Agent Governance backend is configured but is not responding correctly. Identity is operational.",
    },
    misconfigured: {
      label: "Misconfigured",
      colorClass: "bg-red-100 text-red-800 border-red-200",
      description:
        "Both backends are configured but neither is responding correctly. Check backend connectivity.",
    },
    // BOTH backends absent is an ERROR, not a calm empty state
    // (THE-ABSENT-BACKEND addendum): identuum-ui-setup refuses to write a
    // config with no enabled backend, so reaching this mode means the
    // runtime config is missing or was hand-edited into an invalid state.
    unconfigured: {
      label: "Unconfigured",
      colorClass: "bg-red-100 text-red-800 border-red-200",
      description:
        "No backends are configured — this is an invalid configuration. Run identuum-ui-setup to write the runtime configuration.",
    },
  };

  const { label, colorClass, description } = config[mode] ?? config.misconfigured;

  return (
    <div className={`rounded-xl border px-4 py-3 ${colorClass}`}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs mt-0.5 opacity-80">{description}</p>
    </div>
  );
}

function licenseStatusDisplay(status: string): string {
  if (status === "unknown") return "—";
  if (status === "valid") return "Valid";
  if (status === "invalid") return "Invalid";
  if (status === "expired") return "Expired";
  if (status === "missing") return "Missing";
  return status;
}

function licenseStatusClass(status: string): string {
  if (status === "valid") return "text-emerald-600 font-medium";
  if (status === "invalid" || status === "expired") return "text-red-600 font-medium";
  return "text-stone-500";
}

function daysRemainingClass(days: number): string {
  if (days <= 0) return "text-red-600 font-medium";
  if (days <= 30) return "text-amber-600 font-medium";
  return "text-stone-600";
}

function LicenseRows({ lic }: { lic: ComponentLicenseInfo }) {
  return (
    <>
      <StatusRow
        label="License"
        value={licenseStatusDisplay(lic.status)}
        valueClass={licenseStatusClass(lic.status)}
      />
      {lic.product && <StatusRow label="Product" value={lic.product} />}
      {lic.tier && <StatusRow label="Tier" value={lic.tier} />}
      {lic.expires_at != null && (
        <StatusRow
          label="Expires"
          value={<LocalTime value={lic.expires_at} style="date" fallback={lic.expires_at} />}
        />
      )}
      {lic.days_remaining != null && (
        <StatusRow
          label="Days left"
          value={String(lic.days_remaining)}
          valueClass={daysRemainingClass(lic.days_remaining)}
        />
      )}
      {lic.deployment_mode != null && lic.deployment_mode !== "" && (
        <StatusRow label="Deploy mode" value={lic.deployment_mode} />
      )}
      {lic.license_type != null && lic.license_type !== "" && (
        <StatusRow label="License type" value={lic.license_type} />
      )}
    </>
  );
}

function BackendCard({
  label,
  abbreviation,
  backend,
  expectedComponent,
}: {
  label: string;
  abbreviation: string;
  backend: BackendComponentState;
  expectedComponent: string;
}) {
  const statusColor = backend.usable
    ? "text-emerald-600"
    : backend.configured
      ? "text-amber-600"
      : "text-stone-400";

  const statusLabel = backend.usable
    ? "Operational"
    : backend.configured
      ? "Unavailable"
      : "Not configured";

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-sky-700">{abbreviation}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-sky-950">{label}</p>
            {backend.component && backend.component !== expectedComponent && (
              <p className="text-xs text-red-600 mt-0.5">
                Wrong component: returned &ldquo;{backend.component}&rdquo;
              </p>
            )}
          </div>
        </div>
        <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <StatusRow label="Configured" value={backend.configured ? "Yes" : "No"} />
        <StatusRow label="Reachable" value={backend.reachable ? "Yes" : "No"} />
        <StatusRow label="Usable" value={backend.usable ? "Yes" : "No"} />
        {/*
          Backend identity rows. Shown only when the backend reported them;
          when absent (older backend, unreachable, not configured) the rows
          stay hidden so unknown/unavailable remains the displayed state.
        */}
        {backend.product && <StatusRow label="Backend product" value={backend.product} />}
        {backend.capability_map_schema_version && (
          <StatusRow
            label="Capability schema"
            value={backend.capability_map_schema_version}
            valueClass="text-stone-600 font-mono"
          />
        )}
        <LicenseRows lic={backend.license} />
        {backend.version && <StatusRow label="Version" value={backend.version} />}
        {backend.error && (
          <StatusRow label="Error" value={backend.error} valueClass="text-amber-700 font-mono" />
        )}
      </div>

      {backend.capabilities && Object.keys(backend.capabilities).length > 0 && (
        <CapabilitiesList capabilities={backend.capabilities} />
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  valueClass = "text-stone-600",
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-stone-400 uppercase tracking-wide text-[10px]">{label}</span>
      <span className={`font-medium mt-0.5 ${valueClass}`}>{value}</span>
    </div>
  );
}

const CAPABILITY_LABELS: Record<keyof ComponentCapabilities, string> = {
  component_discovery: "Component discovery",
  license_status: "License status",
  auth_provider_discovery: "Auth provider discovery",
  organization_export: "Organization export",
  organization_import: "Organization import",
  organization_linking: "Organization linking",
  identity_provider: "Identity provider",
  agent_governance: "Agent governance",
  hitl: "HITL",
  agent_sessions: "Agent sessions",
  account_self_service: "Account self-service",
  user_sessions: "User sessions",
  mfa: "MFA",
  webauthn: "WebAuthn",
  authorization_server: "Authorization Server",
  oauth_clients: "OAuth clients",
  api_resources: "API resources",
  service_accounts: "Service accounts",
  scope_templates: "Scope templates",
  org_roles: "Organization roles",
  protocol_settings: "Protocol settings",
  client_credentials: "Client credentials",
  dynamic_client_registration: "DCR",
  scim: "SCIM",
  audit_log: "Audit log",
  audit_chain: "Audit chain",
  reporting: "Reporting",
  anomaly_detection: "Anomaly detection",
  observability: "Observability",
};

function CapabilitiesList({ capabilities }: { capabilities: ComponentCapabilities }) {
  const entries = (Object.keys(CAPABILITY_LABELS) as Array<keyof ComponentCapabilities>)
    .map((k) => ({
      key: k,
      label: CAPABILITY_LABELS[k],
      availability: getCapabilityAvailability(capabilities, k),
    }))
    .filter((entry) => entry.availability !== "unknown");

  if (entries.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-stone-400 mb-1.5">Capabilities</p>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(({ key, label, availability }) => (
          <span
            key={key}
            className={
              availability === "available"
                ? "rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                : "rounded-md bg-stone-100 border border-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-500"
            }
          >
            {label}: {availability === "available" ? "Available" : "Unavailable"}
          </span>
        ))}
      </div>
    </div>
  );
}

function AgAuthProviderCard({ providers }: { providers: AgAuthProviderDiscoveryState }) {
  const featureUnavailable =
    providers.login_available === false && providers.unavailable_reason === "forbidden_feature";

  const statusLabel = providers.available
    ? featureUnavailable
      ? "Feature unavailable"
      : "Available"
    : providers.error_code
      ? "Discovery failed"
      : "Not configured";
  const statusColor = providers.available
    ? featureUnavailable
      ? "text-amber-600"
      : "text-emerald-600"
    : providers.error_code
      ? "text-amber-600"
      : "text-stone-400";

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sky-950">AG Login Providers</p>
          <p className="text-xs text-stone-500 mt-0.5">
            Human/operator authentication options for AG.
          </p>
        </div>
        <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex flex-col">
          <span className="text-stone-400 uppercase tracking-wide text-[10px]">Auth Mode</span>
          <span className="font-medium text-stone-600 mt-0.5 font-mono">
            {providers.auth_mode ?? "—"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-stone-400 uppercase tracking-wide text-[10px]">Providers</span>
          <span className="font-medium text-stone-600 mt-0.5">{providers.provider_count}</span>
        </div>
        {providers.login_available !== null && (
          <div className="flex flex-col">
            <span className="text-stone-400 uppercase tracking-wide text-[10px]">Login</span>
            <span
              className={`font-medium mt-0.5 ${providers.login_available ? "text-emerald-600" : "text-amber-600"}`}
            >
              {providers.login_available ? "Available" : "Unavailable"}
            </span>
          </div>
        )}
        {providers.unavailable_reason && (
          <div className="flex flex-col">
            <span className="text-stone-400 uppercase tracking-wide text-[10px]">Reason</span>
            <span className="font-medium text-amber-700 mt-0.5 font-mono">
              {providers.unavailable_reason}
            </span>
          </div>
        )}
        {providers.error_code && (
          <div className="flex flex-col col-span-2">
            <span className="text-stone-400 uppercase tracking-wide text-[10px]">Error</span>
            <span className="font-medium text-amber-700 mt-0.5 font-mono">
              {providers.error_code}
            </span>
          </div>
        )}
      </div>
      {providers.providers.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-stone-400 mb-1.5">
            Configured providers
          </p>
          <div className="flex flex-wrap gap-1.5">
            {providers.providers.map((p) => (
              <span
                key={p.id}
                className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                  p.enabled
                    ? "bg-stone-100 border-stone-200 text-stone-600"
                    : "bg-amber-50 border-amber-200 text-amber-700"
                }`}
              >
                {p.display_name}
                {!p.enabled && p.unavailable_reason && (
                  <span className="ml-1 font-mono opacity-70">({p.unavailable_reason})</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SetupRequiredPrompt() {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="max-w-sm text-center space-y-3">
        <p className="text-sm font-semibold text-sky-950">UI not configured</p>
        <p className="text-xs text-stone-500 leading-relaxed">
          Run identuum-ui-setup to write the runtime configuration before accessing this page.
        </p>
        <a href="/" className="text-sm text-sky-600 hover:text-sky-700 underline">
          Return to home
        </a>
      </div>
    </div>
  );
}

// Note: the prior inline `AGCEOrgLinkAvailabilityCallout` sub-component
// was extracted to `@/components/shared/ag-ce-org-link-availability-card`
// in the 2026-07-06 refactor. The page renders that shared component
// directly above with `copyVariant="operational-health"` and a
// drill-in actionable target.
