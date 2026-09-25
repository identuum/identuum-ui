/**
 * Site-admin reports page — READ-ONLY boundary.
 *
 * Owner decision 5 (2026-09-25): the UI shows no surface that no edition
 * serves. Neither identuum-idp-oss nor identuum-idp-ce serves the report
 * export routes (/api/v1/reports/*), so this page offers no export link; it
 * states the boundary for an operator who reaches it directly. The nav entry
 * stays hidden unless the IdP advertises the `reporting` capability.
 */

import type { Metadata } from "next";
import { FeatureBoundaryPanel } from "@/components/shared/feature-boundary-panel";

export const metadata: Metadata = {
  title: "Reports — Identuum Site Admin",
};

export default function SiteAdminReportsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Reports</h1>
        <p className="text-sm text-stone-500 mt-0.5">Operator report exports.</p>
      </div>

      <FeatureBoundaryPanel
        title="Report exports are not available"
        body="No edition of the identity provider serves report exports in this release. Audit events remain available on the Audit page."
      />
    </div>
  );
}
