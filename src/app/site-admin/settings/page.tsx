/**
 * Site-admin settings page — system / infrastructure settings.
 *
 * Auth and role are enforced by the parent layout (site-admin/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Security:
 *   - Only safe operational data is displayed (enabled/healthy flags, public URLs).
 *   - internal_base_url, DB addresses, Redis config, secrets, and license keys
 *     are intentionally NOT shown.
 *   - Health checks are performed server-side; no internal URLs reach the browser.
 */
import { agBaseUrl, idpBaseUrl, loadRuntimeConfig } from "@/lib/runtime-config";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings — Identuum Admin" };

// ── Server-side health check ──────────────────────────────────────────────────

async function checkHealth(url: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
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

async function loadSystemStatus(): Promise<ServiceStatus[]> {
  const cfg = loadRuntimeConfig();

  if (!cfg) {
    return [
      { name: "Identity Provider (IdP)", enabled: false, healthy: null },
      { name: "Agentic Governor (AG)", enabled: false, healthy: null },
    ];
  }

  const [idpHealthy, agHealthy] = await Promise.all([
    cfg.idp.enabled ? checkHealth(idpBaseUrl(cfg)) : Promise.resolve(null),
    cfg.ag.enabled ? checkHealth(agBaseUrl(cfg)) : Promise.resolve(null),
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
  const services = await loadSystemStatus().catch(
    (): ServiceStatus[] => [
      { name: "Identity Provider (IdP)", enabled: false, healthy: null },
      { name: "Agentic Governor (AG)", enabled: false, healthy: null },
    ]
  );

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
          {services.map((svc) => (
            <ServiceRow key={svc.name} service={svc} />
          ))}
        </div>
      </div>

      {/* Placeholder system settings cards */}
      <PlaceholderCard
        title="License"
        description="View and update the Identuum license key for this deployment."
      />
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
