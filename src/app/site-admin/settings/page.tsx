/**
 * Site-admin settings page — system / infrastructure settings.
 *
 * Auth and role are enforced by the parent layout (site-admin/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Security:
 *   - Only safe operational data is displayed (enabled/healthy flags, public URLs,
 *     and the safe license-status projection — state + product + distribution
 *     + tier).
 *   - internal_base_url, DB addresses, Redis config, secrets, license envelope
 *     bytes, licensee, expires_at, license_id, license_type, signing material,
 *     and admin bearer tokens are intentionally NOT shown.
 *   - Health checks AND the license-status probe are performed server-side; no
 *     internal URLs reach the browser.
 */
import {
  type LicenseProbeOutcome,
  type SafeLicenseStatus,
  licenseBadge,
  loadLicenseStatus,
} from "@/lib/license-status";
import { agBaseUrl, idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings — Identuum Admin" };

// ── Server-side health check ──────────────────────────────────────────────────

// Backend liveness path. identuum-idp-ce uses the Kubernetes-convention
// `/healthz` (registered in cmd/identuum-idp/serve.go and the symmetric
// upgrade_serve.go); the same path is also wired into the UI container's own
// Dockerfile HEALTHCHECK. identuum-ag still publishes `/health` today; this
// helper preserves AG's behaviour until a paired AG-side audit confirms the
// Kubernetes convention is universal there too. Same per-domain branch as
// src/app/api/status/route.ts::healthPath — kept in sync deliberately so a
// future refactor that consolidates onto /api/status does not silently regress
// the IDP probe back to `/health`. Pinned by src/__tests__/settings-system-
// status-health-paths.test.ts.
type HealthDomain = "idp" | "ag";

function healthPath(domain: HealthDomain): string {
  if (domain === "idp") return "/healthz";
  return "/health";
}

async function checkHealth(url: string, domain: HealthDomain): Promise<boolean | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}${healthPath(domain)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return null;
  }
}

interface ServiceStatus {
  name: string;
  enabled: boolean;
  healthy: boolean | null;
  publicUrl?: string;
}

// Server-side license-status probe + safe projection live in
// `@/lib/license-status`. Shared with `/site-admin/license` (the
// read-only status section above the bearer-token-gated
// LicenseManager). Safety pin: src/__tests__/license-status-lib-safety.test.ts.

async function loadSystemStatus(): Promise<ServiceStatus[]> {
  const cfg = loadRuntimeConfig();

  if (!cfg) {
    return [
      { name: "Identity Provider (IdP)", enabled: false, healthy: null },
      { name: "Agentic Governor (AG)", enabled: false, healthy: null },
    ];
  }

  const [idpHealthy, agHealthy] = await Promise.all([
    cfg.idp.enabled ? checkHealth(idpBaseUrl(cfg), "idp") : Promise.resolve(null),
    cfg.ag.enabled ? checkHealth(agBaseUrl(cfg), "ag") : Promise.resolve(null),
  ]);

  return [
    {
      name: "Identity Provider (IdP)",
      enabled: cfg.idp.enabled,
      healthy: idpHealthy,
      // Only the public URL — never internal_base_url
      publicUrl: cfg.idp.public_base_url || undefined,
    },
    {
      name: "Agentic Governor (AG)",
      enabled: cfg.ag.enabled,
      healthy: agHealthy,
      publicUrl: cfg.ag.public_base_url || undefined,
    },
  ];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function SiteAdminSettingsPage() {
  const [services, licenseOutcome] = await Promise.all([
    loadSystemStatus().catch((): ServiceStatus[] => [
      { name: "Identity Provider (IdP)", enabled: false, healthy: null },
      { name: "Agentic Governor (AG)", enabled: false, healthy: null },
    ]),
    loadLicenseStatus().catch((): LicenseProbeOutcome => ({ kind: "unknown" })),
  ]);

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Settings</h1>
        <p className="text-sm text-stone-500 mt-0.5">System and infrastructure configuration.</p>
      </div>

      {/* Admin account — personal settings live at /account/settings */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-sky-950">Admin account</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Manage your personal credentials and passkeys.
            </p>
          </div>
          <a
            href="/account/settings"
            className="shrink-0 inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 transition-colors"
          >
            Account settings →
          </a>
        </div>
      </div>

      {/* System status */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">System status</p>
          <p className="text-xs text-stone-400 mt-0.5">
            Runtime health of configured backend services.
          </p>
        </div>
        <div className="px-6 py-5 divide-y divide-stone-100">
          {/* ABSENCE IS NOT FAILURE (THE-ABSENT-BACKEND): backends that are
              not enabled in the runtime config are not mentioned — no row,
              no "Disabled" badge. Enabled-but-unhealthy still shows
              Unhealthy. */}
          {services.filter((svc) => svc.enabled).length > 0 ? (
            services
              .filter((svc) => svc.enabled)
              .map((svc) => <ServiceRow key={svc.name} service={svc} />)
          ) : (
            // BOTH absent is an ERROR (invalid runtime config — setup
            // refuses to write it), not a calm empty state.
            <p className="py-3.5 text-sm font-medium text-red-600">
              No backends are enabled — invalid runtime configuration. Re-run identuum-ui-setup.
            </p>
          )}
        </div>
      </div>

      {/* License — live safe-status projection from /api/setup/license */}
      <LicenseCard outcome={licenseOutcome} />

      {/* Audit log — real page at /site-admin/audit */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-sky-950">Audit log</p>
            <p className="text-xs text-stone-400 mt-0.5">
              System-wide audit events across all organizations and users.
            </p>
          </div>
          <a
            href="/site-admin/audit"
            className="shrink-0 inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 transition-colors"
          >
            View audit log →
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ServiceRow({ service }: { service: ServiceStatus }) {
  const badge = statusBadge(service);

  return (
    <div className="py-3.5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-sky-950">{service.name}</p>
        {service.enabled && service.publicUrl && (
          <p className="text-xs text-stone-400 mt-0.5 font-mono truncate max-w-[320px]">
            {service.publicUrl}
          </p>
        )}
      </div>
      <span
        className={[
          "shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
          badge.cls,
        ].join(" ")}
      >
        {badge.label}
      </span>
    </div>
  );
}

function statusBadge(svc: ServiceStatus): { label: string; cls: string } {
  if (!svc.enabled) {
    return { label: "Disabled", cls: "bg-stone-100 text-stone-500" };
  }
  if (svc.healthy === true) {
    return { label: "Healthy", cls: "bg-emerald-50 text-emerald-700" };
  }
  if (svc.healthy === false) {
    return { label: "Unhealthy", cls: "bg-red-50 text-red-600" };
  }
  return { label: "Unknown", cls: "bg-amber-50 text-amber-700" };
}

// ── License card ─────────────────────────────────────────────────────────────
//
// Renders the safe license-status projection from the server-side probe.
// SAFETY: only state badge + product + distribution + optional tier reach
// the browser. licensee, expires_at, license_id, license_type, raw envelope,
// admin bearer tokens are NEVER rendered. The full license-management surface
// (upload + replace) lives at /site-admin/license behind admin-bearer-token
// gating; this page links there for that workflow.

function LicenseCard({ outcome }: { outcome: LicenseProbeOutcome }) {
  const badge = licenseBadge(outcome);
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-sky-950">License</p>
          <p className="text-xs text-stone-400 mt-0.5">
            Identuum deployment license status. Upload or replace at{" "}
            <a
              href="/site-admin/license"
              className="font-medium text-sky-700 hover:text-sky-900 underline-offset-2 hover:underline"
            >
              /site-admin/license
            </a>
            .
          </p>
          {outcome.kind === "ok" && <LicenseDetails status={outcome.status} />}
        </div>
        <span
          className={[
            "shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
            badge.cls,
          ].join(" ")}
        >
          {badge.label}
        </span>
      </div>
    </div>
  );
}

function LicenseDetails({ status }: { status: SafeLicenseStatus }) {
  const productLine = [status.product, status.distribution].filter((v) => v.length > 0).join(" · ");
  return (
    <div className="mt-2 space-y-0.5">
      {productLine !== "" && <p className="text-xs text-stone-600">{productLine}</p>}
      {status.tier !== undefined && status.tier !== "" && (
        <p className="text-xs text-stone-500">Tier: {status.tier}</p>
      )}
    </div>
  );
}
