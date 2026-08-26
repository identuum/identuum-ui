/**
 * Site-admin signing-key inventory — READ-ONLY.
 *
 * Slice identuum-20260530-site-admin-observability-pages. Auth + role
 * enforced by /site-admin/layout.tsx. This page does NOT add any
 * mutation control: no generate / rotate / deprecate / delete /
 * reload button is rendered. Those operations are HIGH-risk (the
 * IDP signs every issued token with these keys) and will land in a
 * dedicated future slice.
 *
 * The wire helper listSigningKeys() explicitly projects ONLY the
 * documented safe public-material fields. Private key bytes / PEM /
 * seed / inline JWKS private components (`d`, `p`, `q`, `dp`, `dq`,
 * `qi`, `k`) are NEVER read from the wire response and NEVER reach
 * this page.
 */

import type { Metadata } from "next";
import { listSigningKeys } from "@/lib/idp-admin-client";

export const metadata: Metadata = {
  title: "Signing keys — Identuum Site Admin",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default async function SiteAdminKeysPage() {
  const result = await listSigningKeys();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Signing keys</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Read-only inventory of the IDP's JWT signing keys. Key rotation, generation, deprecation,
          and deletion are not available from this page; contact your platform administrator for
          those operations.
        </p>
      </div>

      {!result.ok && result.forbidden && <ForbiddenPanel />}
      {!result.ok && !result.forbidden && <ErrorPanel />}

      {result.ok && result.keys.length === 0 && <EmptyPanel />}

      {result.ok && result.keys.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">
              {result.count === 1 ? "1 signing key" : `${result.count} signing keys`}
            </p>
            <p className="text-xs text-stone-400 mt-0.5">
              The current and historical keys used by the IDP to sign issued tokens.
            </p>
          </div>
          <ul className="divide-y divide-stone-100">
            {result.keys.map((k) => (
              <li key={k.kid} className="px-6 py-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-semibold text-sky-950 truncate">{k.kid}</p>
                    <p className="text-xs font-mono text-stone-500 truncate">{k.algorithm}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge tone={badgeToneForState(k.state)} label={k.state} />
                  </div>
                </div>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="font-medium text-stone-500">Created</dt>
                  <dd className="font-mono text-sky-950">{formatDate(k.created_at)}</dd>
                  {k.activated_at && (
                    <>
                      <dt className="font-medium text-stone-500">Activated</dt>
                      <dd className="font-mono text-sky-950">{formatDate(k.activated_at)}</dd>
                    </>
                  )}
                  {k.rotated_at && (
                    <>
                      <dt className="font-medium text-stone-500">Rotated</dt>
                      <dd className="font-mono text-sky-950">{formatDate(k.rotated_at)}</dd>
                    </>
                  )}
                  {k.expires_at && (
                    <>
                      <dt className="font-medium text-stone-500">Expires</dt>
                      <dd className="font-mono text-sky-950">{formatDate(k.expires_at)}</dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function badgeToneForState(state: string): "sky" | "amber" | "stone" {
  const s = state.toLowerCase();
  if (s === "active" || s === "current") return "sky";
  if (s === "deprecated" || s === "rotating") return "amber";
  return "stone";
}

function Badge({ tone, label }: { tone: "sky" | "amber" | "stone"; label: string }) {
  const cls =
    tone === "sky"
      ? "text-sky-700 bg-sky-100"
      : tone === "amber"
        ? "text-amber-800 bg-amber-100"
        : "text-stone-600 bg-stone-100";
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  );
}

function EmptyPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-10 text-center">
      <p className="text-sm font-semibold text-sky-950">No signing keys recorded</p>
      <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto leading-relaxed">
        The IDP key inventory is empty. This is unusual in production deployments; if the IDP is
        running it should have at least one active key.
      </p>
    </div>
  );
}

function ForbiddenPanel() {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-sky-950">Access denied</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Your session does not have permission to view signing keys. This page requires the
        ScopeKeysRead grant.
      </p>
    </div>
  );
}

function ErrorPanel() {
  return (
    <div className="bg-white border border-red-100 rounded-[1.5rem] shadow-sm px-6 py-6">
      <p className="text-sm font-semibold text-red-700">Could not load signing keys</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">
        Reload the page or try again later. Contact your platform administrator if the problem
        persists.
      </p>
    </div>
  );
}
