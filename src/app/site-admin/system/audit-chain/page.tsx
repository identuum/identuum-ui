/**
 * Site-admin audit-chain verification — READ-ONLY.
 *
 * Slice identuum-20260530-site-admin-observability-pages.
 *
 * The IDP's GET /api/v1/system/audit/chain/verify is a read-only
 * diagnostic endpoint (the handler explicitly does not write the
 * verification result back to audit, to avoid a feedback loop). It
 * walks the per-organization audit hash chain shard-by-shard and
 * returns aggregate pass/fail counts plus per-shard summaries.
 *
 * UX: the page does NOT auto-trigger verification on render — that
 * would be expensive on busy deployments (the walk is bounded by the
 * audit row count). Instead, the operator clicks a "Verify audit
 * chain" link that navigates to `?verify=true`, and the page
 * re-renders with the report. No POST / no state mutation.
 *
 * SECURITY:
 *   - The wire helper's projection drops per-shard `head_hash` and
 *     `head_signature` hex strings. Those are SOC2 chain-integrity
 *     diagnostics but could be confused for credentials by an
 *     operator scanning the page. The UI surfaces only the summary
 *     counts + per-shard pass/fail status.
 */

import type { Metadata } from "next";
import { FeatureBoundaryPanel } from "@/components/shared/feature-boundary-panel";
import { verifyAuditChain } from "@/lib/idp-admin-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";

export const metadata: Metadata = {
  title: "Audit chain verify — Identuum Site Admin",
};

export default async function SiteAdminAuditChainPage({
  searchParams,
}: {
  searchParams?: Promise<{ verify?: string }>;
}) {
  const params = (await searchParams) ?? {};
  // AUDIT-CHAIN-INVITE-1: pre-gate on the discovered capability (the same
  // source the System index consults). When the edition does not support audit
  // chain verification (audit_chain === false on OSS), the invitation must not
  // render — the boundary shows directly and the Verify button never mounts, so
  // the operator is never invited to a click the backend answers with 404.
  const runtimeState = await getServerRuntimeState();
  const auditChainSupported = runtimeState?.components.idp.capabilities?.audit_chain !== false;
  const shouldVerify = auditChainSupported && params.verify === "true";
  const result = shouldVerify ? await verifyAuditChain() : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <a
        href="/site-admin/system"
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to System
      </a>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Audit chain verify</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          On-demand integrity check of the per-organization audit hash chain. Read-only diagnostic —
          no audit state is written.
        </p>
      </div>

      {/* AUDIT-CHAIN-INVITE-1: unsupported edition → boundary only; no invite. */}
      {!auditChainSupported && <FeatureUnavailablePanel />}

      {auditChainSupported && !shouldVerify && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-6 space-y-4">
          <div>
            <p className="text-sm font-semibold text-sky-950">Ready to verify</p>
            <p className="text-xs text-stone-500 mt-1 leading-relaxed">
              Verification walks the audit hash chain for every tenant organization and reports
              pass/fail per shard. This may take several seconds on busy deployments. No audit state
              is written; the result is rendered once and not persisted.
            </p>
          </div>
          <a
            href="/site-admin/system/audit-chain?verify=true"
            className="inline-flex items-center rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
          >
            Verify audit chain
          </a>
        </div>
      )}

      {shouldVerify && result && !result.ok && result.forbidden && (
        <ForbiddenPanel
          title="Access denied"
          body="Your session does not have permission to run audit chain verification."
        />
      )}
      {shouldVerify && result && !result.ok && result.featureUnavailable && (
        <FeatureUnavailablePanel />
      )}
      {shouldVerify && result && !result.ok && !result.forbidden && !result.featureUnavailable && (
        <ErrorPanel title="Could not verify audit chain" />
      )}

      {shouldVerify && result && result.ok && (
        <div className="space-y-4">
          <section
            aria-labelledby="audit-chain-summary-heading"
            className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-stone-100">
              <h2 id="audit-chain-summary-heading" className="text-sm font-semibold text-sky-950">
                Summary
              </h2>
              <p className="text-xs text-stone-400 mt-0.5">
                Verified at {result.report.generated_at || "—"} · {result.report.shard_count} shard
                {result.report.shard_count === 1 ? "" : "s"}
              </p>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-stone-100">
              <Stat label="OK" value={result.report.ok_count} tone="emerald" />
              <Stat label="Diverged" value={result.report.diverged_count} tone="red" />
              <Stat label="Empty" value={result.report.empty_count} tone="stone" />
              <Stat label="Signed" value={result.report.signed_count} tone="sky" />
              <Stat label="Unsigned" value={result.report.unsigned_count} tone="amber" />
              <Stat
                label="Signature invalid"
                value={result.report.signature_invalid_count}
                tone="red"
              />
              <Stat label="Uncheckable" value={result.report.uncheckable_count} tone="stone" />
            </dl>
          </section>

          {result.report.shards.length > 0 && (
            <section
              aria-labelledby="audit-chain-shards-heading"
              className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-stone-100">
                <h2 id="audit-chain-shards-heading" className="text-sm font-semibold text-sky-950">
                  Per-shard status
                </h2>
              </div>
              <ul className="divide-y divide-stone-100">
                {result.report.shards.map((s) => (
                  <li
                    key={s.organization_id}
                    className="px-6 py-3 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs font-mono text-sky-950 truncate">{s.organization_id}</p>
                      <p className="text-[10px] text-stone-400 leading-tight">
                        {s.rows_verified} row{s.rows_verified === 1 ? "" : "s"} verified · Signature{" "}
                        {s.head_signature_status || "—"}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <StatusPill status={s.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "red" | "sky" | "amber" | "stone";
}) {
  const color = {
    emerald: "text-emerald-700",
    red: "text-red-700",
    sky: "text-sky-700",
    amber: "text-amber-700",
    stone: "text-stone-500",
  }[tone];
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] text-stone-500 leading-tight">{label}</p>
      <p className={`text-lg font-extrabold tracking-tight ${color} mt-0.5`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
        ok
      </span>
    );
  }
  if (s === "diverged") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700">
        diverged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 border border-stone-200 px-2.5 py-0.5 text-[10px] font-semibold text-stone-500">
      {s || "—"}
    </span>
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

function FeatureUnavailablePanel() {
  return (
    <FeatureBoundaryPanel
      title="Audit chain verification requires Enterprise/CE"
      body="Audit chain verification depends on the commercial audit-log capability. In IDP OSS, direct access shows this boundary instead of treating the page as a supported Starter feature."
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
