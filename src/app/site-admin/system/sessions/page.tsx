/**
 * Site-admin system sessions — READ-ONLY.
 *
 * Slice identuum-20260530-site-admin-observability-pages.
 *
 * NO emergency-revoke button is rendered. NO session token / cookie /
 * selector value is read or surfaced. The wire helper's projection
 * drops the IDP's masked-token field for defence-in-depth.
 */

import type { Metadata } from "next";
import { FeatureBoundaryPanel } from "@/components/shared/feature-boundary-panel";
import { LocalTime } from "@/components/ui/local-time";
import { listAdminSessions } from "@/lib/idp-admin-client";

export const metadata: Metadata = {
  title: "Admin sessions — Identuum Site Admin",
};

export default async function SiteAdminSystemSessionsPage() {
  const result = await listAdminSessions();

  return (
    <div className="space-y-6 max-w-4xl">
      <a
        href="/site-admin/system"
        className="inline-flex items-center text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 rounded"
      >
        ← Back to System
      </a>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Admin sessions</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Read-only list of active and recent IDP sessions for administrative identities. Emergency
          revoke is not available from this page.
        </p>
      </div>

      {!result.ok && result.forbidden && (
        <ForbiddenPanel
          title="Access denied"
          body="Your session does not have permission to view system sessions."
        />
      )}
      {/* EDITION-SURFACE-1: /api/v1/system/sessions is a commercial-only route
          (identuum-idp-oss serves no such route and answers 404). Show the
          honest edition boundary — never the outage panel. */}
      {!result.ok && !result.forbidden && result.featureUnavailable && (
        <FeatureBoundaryPanel
          title="Admin sessions require Enterprise/CE"
          body="System admin-session listing depends on the commercial /api/v1/system/sessions route. In IDP OSS, direct access shows this boundary instead of treating the page as a supported Starter feature."
        />
      )}
      {!result.ok && !result.forbidden && !result.featureUnavailable && (
        <ErrorPanel title="Could not load system sessions" />
      )}

      {result.ok && result.sessions.length === 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
          <p className="text-sm font-semibold text-sky-950">No active sessions</p>
          <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
            No admin sessions are currently tracked by the IDP.
          </p>
        </div>
      )}

      {result.ok && result.sessions.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">
              {result.total_count === 1
                ? "1 admin session"
                : `${result.total_count} admin sessions`}
            </p>
          </div>
          <ul className="divide-y divide-stone-100">
            {result.sessions.map((s) => (
              <li key={s.id} className="px-6 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs font-mono text-sky-950 truncate">{s.id}</p>
                  <p className="text-[10px] text-stone-400 leading-tight">
                    Created <LocalTime value={s.created_at} /> · Expires{" "}
                    <LocalTime value={s.expires_at} />
                    {s.last_used_at && (
                      <>
                        {" "}
                        · Last used <LocalTime value={s.last_used_at} />
                      </>
                    )}
                  </p>
                </div>
                <div className="shrink-0">
                  {s.is_active ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 border border-stone-200 px-2.5 py-0.5 text-[10px] font-semibold text-stone-500">
                      inactive
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
