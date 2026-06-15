/**
 * Site-admin System landing — index of the three read-only system
 * observability sub-pages: sessions, audit chain verification,
 * runtime info.
 *
 * Slice identuum-20260530-site-admin-observability-pages.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "System — Identuum Site Admin",
};

interface SystemCard {
  title: string;
  description: string;
  href: string;
}

const SYSTEM_CARDS: SystemCard[] = [
  {
    title: "Admin sessions",
    description:
      "Read-only list of active admin sessions. No emergency-revoke control is rendered.",
    href: "/site-admin/system/sessions",
  },
  {
    title: "Audit chain verify",
    description: "On-demand integrity check of the per-organization audit hash chain. Read-only.",
    href: "/site-admin/system/audit-chain",
  },
  {
    title: "Runtime info",
    description: "Version, dependency liveness, and audit-queue depth.",
    href: "/site-admin/system/info",
  },
];

export default function SiteAdminSystemPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">System</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Read-only system observability. Mutating system actions (emergency revoke, backup restore,
          compliance attest) are not available here.
        </p>
      </div>
      <ul className="space-y-3">
        {SYSTEM_CARDS.map((c) => (
          <li key={c.href}>
            <a
              href={c.href}
              aria-label={`Open ${c.title}`}
              className="block bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-5 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-sky-950">{c.title}</p>
                  <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{c.description}</p>
                </div>
                <span className="text-xs font-semibold text-sky-700 shrink-0">Open →</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
