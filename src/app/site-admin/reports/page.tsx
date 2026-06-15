/**
 * Site-admin reports landing page — READ-ONLY.
 *
 * Slice identuum-20260530-site-admin-observability-pages. Auth + role
 * enforced by /site-admin/layout.tsx. Renders four report families
 * (user-access, failed-auth, privilege-changes, audit-log) with
 * deep links to the available export formats (JSON / CSV / PDF).
 *
 * SECURITY:
 *   - This page does NOT eagerly fetch any report. Clicking a link
 *     triggers the operator's browser to download (CSV / PDF) or
 *     open (JSON) the file. The IDP emits a `data_accessed` audit
 *     event per §5.9 SOC2 CC6.1 on the JSON endpoints — that's the
 *     correct audit trail behavior.
 *   - The links are constructed from a server-side constant
 *     (SITE_ADMIN_REPORT_FAMILIES) — no operator input is reflected
 *     into URL paths.
 *   - Each link uses target="_blank" + rel="noreferrer" so a malformed
 *     report payload cannot navigate the operator's audit-page tab.
 */
import { FeatureBoundaryPanel } from "@/components/shared/feature-boundary-panel";
import { type ReportLink, SITE_ADMIN_REPORT_FAMILIES } from "@/lib/idp-admin-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports — Identuum Site Admin",
};

export default function SiteAdminReportsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Reports</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Read-only operator reports. Clicking an export link triggers the IDP to generate the
          report; a <span className="font-mono">data_accessed</span> audit event is emitted per SOC2
          CC6.1 for accountability.
        </p>
      </div>

      <FeatureBoundaryPanel
        title="Reports require Enterprise/CE"
        body="These export endpoints are commercial IDP capabilities. IDP OSS operators can use this direct page to identify the boundary; the links remain available for CE deployments."
      />

      <ul className="space-y-4">
        {SITE_ADMIN_REPORT_FAMILIES.map((family) => (
          <li
            key={family.key}
            className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-stone-100">
              <h2 className="text-sm font-semibold text-sky-950">{family.name}</h2>
              <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{family.description}</p>
            </div>
            <div className="px-6 py-4 flex flex-wrap items-center gap-2">
              {family.links.map((link) => (
                <ReportLinkButton key={link.path} link={link} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportLinkButton({ link }: { link: ReportLink }) {
  return (
    <a
      href={`/api/idp${link.path}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
    >
      {link.label}
    </a>
  );
}
