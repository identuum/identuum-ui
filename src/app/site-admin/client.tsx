"use client";

import { Spinner } from "@/components/ui/spinner";
import type { CurrentUser, PublicRuntimeConfig, StatusResponse, UserRole } from "@/lib/types";
import { fetchRuntimeConfig, fetchStatus } from "@/lib/ui-api";
import { useEffect, useState } from "react";

interface SiteAdminOverviewClientProps {
  initialUser: CurrentUser | null;
  initialRole: UserRole | string | null;
}

export function SiteAdminOverviewClient({
  initialUser,
  initialRole,
}: SiteAdminOverviewClientProps) {
  const [config, setConfig] = useState<PublicRuntimeConfig | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Both calls are same-origin. /api/status does server-side backend
        // health checks — no cross-origin calls from the browser.
        const [cfgData, statusData] = await Promise.all([fetchRuntimeConfig(), fetchStatus()]);
        setConfig(cfgData);
        setStatus(statusData);
      } catch {
        // Partial load — state clears and the page renders with null data.
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const email = initialUser?.email ?? "—";
  const role = initialUser?.role ?? initialRole ?? "—";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Overview</h1>
        <p className="text-sm text-stone-500 mt-0.5">System status and configuration</p>
      </div>

      {/* Identity */}
      <Section title="Identity">
        <Row label="Signed in as" value={email} mono={false} />
        <Row label="Role" value={role} mono />
      </Section>

      {/* Capabilities */}
      <Section title="Deployed capabilities">
        {loading ? (
          <LoadingRow />
        ) : config ? (
          <>
            <CapabilityRow
              label={status?.idp.product ?? "identuum-idp"}
              enabled={config.idp.enabled}
            />
            <CapabilityRow
              label={status?.ag.product ?? "identuum-ag"}
              enabled={config.ag.enabled}
            />
          </>
        ) : (
          <ErrorRow message="Could not load runtime configuration." />
        )}
      </Section>

      {/* Backend health */}
      <Section title="Backend health">
        {loading ? (
          <LoadingRow />
        ) : status ? (
          <>
            {status.idp.enabled && (
              <HealthRow label={status.idp.product} healthy={status.idp.healthy} />
            )}
            {status.ag.enabled && (
              <HealthRow label={status.ag.product} healthy={status.ag.healthy} />
            )}
            {!status.idp.enabled && !status.ag.enabled && (
              <ErrorRow message="No backends are enabled." />
            )}
          </>
        ) : (
          <ErrorRow message="Could not load backend status." />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{title}</p>
      </div>
      <div className="divide-y divide-stone-100">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-stone-500">{label}</span>
      <span
        className={`text-sm text-sky-950 ${mono ? "font-mono bg-stone-100 px-2 py-0.5 rounded text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function CapabilityRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm font-mono text-sky-950">{label}</span>
      {enabled ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
          enabled
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 border border-stone-200 px-2.5 py-0.5 text-xs font-semibold text-stone-500">
          disabled
        </span>
      )}
    </div>
  );
}

function HealthRow({ label, healthy }: { label: string; healthy: boolean | null }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm font-mono text-sky-950">{label}</span>
      {healthy === null ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 border border-stone-200 px-2.5 py-0.5 text-xs font-semibold text-stone-500">
          checking
        </span>
      ) : healthy ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          healthy
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-600">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          unreachable
        </span>
      )}
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 px-5 py-4 text-stone-400">
      <Spinner size="sm" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="px-5 py-3">
      <p className="text-sm text-stone-500">{message}</p>
    </div>
  );
}
