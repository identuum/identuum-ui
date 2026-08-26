/**
 * Site-admin CE license management page.
 *
 * Two surfaces, two auth models — pinned by source-invariant tests:
 *
 *   1. **Read-only status section (top of page, no bearer token).**
 *      Added by `agent-a-20260620-idp-ui-site-admin-license-readonly-view`.
 *      Runs a server-side probe of `/api/setup/license` from the
 *      `@/lib/license-status` shared helper — same surface as the
 *      live License card on `/site-admin/settings`. Renders ONLY the
 *      safe projection: status badge + product + distribution +
 *      optional tier. NEVER renders `licensee`, `expires_at`,
 *      `license_id`, `license_type`, raw envelope bytes, signing
 *      material, or any admin bearer token. Any authenticated
 *      site_admin sees this immediately without pasting anything.
 *      Pinned by src/__tests__/license-page-readonly-status-safety.test.ts.
 *
 *   2. **Upload / replace flow (LicenseManager, bearer-token-gated).**
 *      The CE admin license route group (`/admin/license`) sits
 *      behind the CE binary's bearer-token + `admin:license`-scope
 *      admin middleware, so the actual upload + the admin-side status
 *      fetch require an admin bearer token the cookie session DOES
 *      NOT carry. The `LicenseManager` client component keeps the
 *      token in React state only (never localStorage / sessionStorage
 *      / document.cookie / URL / log line). After admin auth, the
 *      LicenseManager's own status panel can render the wider field
 *      set (including `licensee`, `expiresAt`, `licenseId`,
 *      `licenseType`, `nextAction`) — that disclosure is explicitly
 *      operator-controlled. Pinned by
 *      src/__tests__/admin-license-page-source-invariants.test.ts.
 *
 * Auth + role enforced by /site-admin/layout.tsx; this page does NOT
 * repeat the guard.
 */

import type { Metadata } from "next";
import { licenseBadge, loadLicenseStatus } from "@/lib/license-status";
import { LicenseManager } from "./license-manager";

export const metadata: Metadata = {
  title: "License — Identuum Site Admin",
};

export default async function SiteAdminLicensePage() {
  const licenseOutcome = await loadLicenseStatus().catch(() => ({ kind: "unknown" }) as const);
  const badge = licenseBadge(licenseOutcome);
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">License</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          View read-only license status, and replace the CE license envelope. The setup-time wizard
          activates the first license; replacements after setup is complete happen here.
        </p>
      </div>

      {/* Read-only status — visible to any authenticated site_admin, no bearer token */}
      <div
        className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
        data-testid="readonly-license-status-card"
      >
        <div className="px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-sky-950">Current status</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Safe public projection from <code className="font-mono">/api/setup/license</code>. No
              bearer token required. Full fields are visible below after admin token verification.
            </p>
            {licenseOutcome.kind === "ok" && (
              <div className="mt-2 space-y-0.5">
                {(licenseOutcome.status.product !== "" ||
                  licenseOutcome.status.distribution !== "") && (
                  <p className="text-xs text-stone-600">
                    {[licenseOutcome.status.product, licenseOutcome.status.distribution]
                      .filter((v) => v.length > 0)
                      .join(" · ")}
                  </p>
                )}
                {licenseOutcome.status.tier !== undefined && licenseOutcome.status.tier !== "" && (
                  <p className="text-xs text-stone-500">Tier: {licenseOutcome.status.tier}</p>
                )}
              </div>
            )}
          </div>
          <span
            className={[
              "shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
              badge.cls,
            ].join(" ")}
            data-testid="readonly-license-status-badge"
          >
            {badge.label}
          </span>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-sky-950">Replace the license envelope</h2>
          <p className="text-sm text-stone-600 mt-1">
            The CE admin license API (<code className="font-mono text-xs">/admin/license</code>) is
            gated by a bearer admin token carrying the{" "}
            <code className="font-mono text-xs">admin:license</code> scope. Paste a current admin
            token below to load the full administrative field set, then optionally paste or upload a
            new license envelope to replace it.
          </p>
          <p className="text-xs text-stone-500 mt-2">
            The admin token and the license envelope are held only in this page's memory for the
            duration of the request. Neither is stored in the browser, cookies, or the URL, and
            neither is shown again after submission.
          </p>
        </div>

        <LicenseManager />
      </div>
    </div>
  );
}
