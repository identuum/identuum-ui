/**
 * Site-admin runtime info — READ-ONLY.
 *
 * Slice identuum-20260530-site-admin-observability-pages.
 *
 * Surfaces ONLY the non-sensitive operational metrics from
 * GET /api/v1/health/details: version string, database/Redis
 * liveness, and audit-system queue depth. The wire helper's
 * projection EXPLICITLY drops the DB connection-pool counters
 * (acquired/total/idle/max_conns/etc.) for defence-in-depth and
 * NEVER reads database URLs, Redis URLs, env var values, license
 * private fields, or signing key material from the response (none
 * of those are returned by the backend handler, but the projection
 * is explicit so a regression cannot leak through).
 */
import { getSystemInfo } from "@/lib/idp-admin-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Runtime info — Identuum Site Admin",
};

export default async function SiteAdminSystemInfoPage() {
  const result = await getSystemInfo();

  return (
    <div className="space-y-6 max-w-3xl">
      <a
        href="/site-admin/system"
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to System
      </a>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Runtime info</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Read-only IDP runtime metadata: version, dependency liveness, and audit queue depth. No
          database URLs, credentials, or configuration secrets are surfaced.
        </p>
      </div>

      {!result.ok && result.forbidden && (
        <ForbiddenPanel
          title="Access denied"
          body="Your session does not have permission to view runtime info."
        />
      )}
      {!result.ok && !result.forbidden && <ErrorPanel title="Could not load runtime info" />}

      {result.ok && (
        <section
          aria-labelledby="system-info-heading"
          className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-stone-100">
            <h2 id="system-info-heading" className="text-sm font-semibold text-sky-950">
              IDP runtime
            </h2>
          </div>
          <dl className="px-6 py-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-3 text-xs">
            <Row label="Status" value={result.info.status || "—"} />
            <Row label="Version" value={result.info.version || "—"} mono />
            <Row label="Database" value={result.info.database_status || "—"} mono />
            <Row
              label="Audit queue"
              value={`${result.info.audit_system_status || "—"} (${result.info.audit_queue_depth} queued)`}
            />
            {result.info.redis_status && (
              <Row label="Redis" value={result.info.redis_status} mono />
            )}
          </dl>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="font-medium text-stone-500">{label}</dt>
      <dd className={`text-sky-950 break-all ${mono ? "font-mono" : ""}`}>{value}</dd>
    </>
  );
}

function ForbiddenPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-sky-950">{title}</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">{body}</p>
    </div>
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
