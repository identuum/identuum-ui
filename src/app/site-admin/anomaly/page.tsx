/**
 * Site-admin anomaly observability — READ-ONLY.
 *
 * Slice identuum-20260530-site-admin-observability-pages. Auth + role
 * enforced by /site-admin/layout.tsx. Renders a stats summary card +
 * a compact list of recent anomaly events.
 *
 * The compact event rows render ONLY operator-safe fields: the
 * anomaly id, organization id, score, detection method, and
 * timestamp. The wire helper's projection drops the IDP's `metadata`
 * map — that field MAY contain detection-method-specific payload the
 * UI does not need and could be confused for credentials by an
 * operator scanning the page. No mutation control is rendered.
 */

import type { Metadata } from "next";
import { FeatureBoundaryPanel } from "@/components/shared/feature-boundary-panel";
import { LocalTime } from "@/components/ui/local-time";
import { getAnomalyStats, listAnomalyEvents } from "@/lib/idp-admin-client";

export const metadata: Metadata = {
  title: "Anomaly — Identuum Site Admin",
};

export default async function SiteAdminAnomalyPage() {
  const [statsResult, eventsResult] = await Promise.all([getAnomalyStats(), listAnomalyEvents()]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Anomaly</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Read-only summary of authentication anomalies detected by the IDP's adaptive-enforcement
          engine.
        </p>
      </div>

      <StatsCard result={statsResult} />
      <EventsCard result={eventsResult} />
    </div>
  );
}

function StatsCard({ result }: { result: Awaited<ReturnType<typeof getAnomalyStats>> }) {
  if (!result.ok && result.forbidden) {
    return (
      <ForbiddenPanel
        title="Access denied"
        body="Your session does not have permission to view anomaly statistics. This page requires the ScopeSystemMetrics grant."
      />
    );
  }
  if (!result.ok && result.featureUnavailable) {
    return <FeatureUnavailablePanel title="Anomaly statistics require Enterprise/CE" />;
  }
  if (!result.ok) {
    return <ErrorPanel title="Could not load anomaly statistics" />;
  }
  return (
    <section
      aria-labelledby="anomaly-stats-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 id="anomaly-stats-heading" className="text-sm font-semibold text-sky-950">
          Summary
        </h2>
      </div>
      <dl className="grid grid-cols-3 gap-px bg-stone-100">
        <Stat label="Total anomalies" value={result.stats.total_anomalies} />
        <Stat label="Last 24h" value={result.stats.recent_24h} />
        <Stat label="High-risk (last 24h)" value={result.stats.high_risk_24h} />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white px-6 py-4">
      <p className="text-xs text-stone-500 leading-tight">{label}</p>
      <p className="text-2xl font-extrabold tracking-tight text-sky-950 mt-1">{value}</p>
    </div>
  );
}

function EventsCard({ result }: { result: Awaited<ReturnType<typeof listAnomalyEvents>> }) {
  if (!result.ok && result.forbidden) {
    return (
      <ForbiddenPanel
        title="Access denied"
        body="Your session does not have permission to view anomaly events."
      />
    );
  }
  if (!result.ok && result.featureUnavailable) {
    return <FeatureUnavailablePanel title="Anomaly events require Enterprise/CE" />;
  }
  if (!result.ok) {
    return <ErrorPanel title="Could not load anomaly events" />;
  }
  const events = result.events;
  return (
    <section
      aria-labelledby="anomaly-events-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 id="anomaly-events-heading" className="text-sm font-semibold text-sky-950">
          Recent events
        </h2>
        <p className="text-xs text-stone-400 mt-0.5">Latest detections across all organizations.</p>
      </div>
      {events.length === 0 ? (
        <div className="px-6 py-5">
          <p className="text-xs text-stone-500">No anomaly events recorded.</p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100">
          {events.map((e) => (
            <li key={e.id} className="px-6 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-xs font-mono text-sky-950 truncate">{e.id}</p>
                <p className="text-[10px] text-stone-400 leading-tight">
                  Org: <span className="font-mono">{e.organization_id}</span>
                </p>
                <p className="text-[10px] text-stone-400 leading-tight">
                  Method: {e.detection_method}
                </p>
              </div>
              <div className="shrink-0 text-right space-y-0.5">
                <p className="text-xs font-semibold text-sky-950">{e.score.toFixed(2)}</p>
                <p className="text-[10px] text-stone-400 whitespace-nowrap">
                  <LocalTime value={e.created_at} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ForbiddenPanel({ title, body }: { title: string; body: string }) {
  return <FeatureBoundaryPanel title={title} body={body} tone="error" />;
}

function FeatureUnavailablePanel({ title }: { title: string }) {
  return (
    <FeatureBoundaryPanel
      title={title}
      body="Anomaly detection is an Enterprise/CE IDP capability. In IDP OSS, direct access shows this boundary instead of treating the page as a supported Starter feature."
    />
  );
}

function ErrorPanel({ title }: { title: string }) {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">{title}</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Reload the page or try again later. Contact your platform administrator if the problem
        persists.
      </p>
    </div>
  );
}
