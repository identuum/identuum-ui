/**
 * Site-admin CE license management page.
 *
 * Slice agent-a-20260616-idp-ce-license-upload-admin-foundation — second
 * half of Phase 14 / D-IDP-INSTALL-22. The setup-time wizard at /setup
 * drives the FIRST license activation; this page is the supported path
 * AFTER setup_complete.
 *
 * Auth + role enforced by /site-admin/layout.tsx. The CE admin license
 * route group (`/admin/license`) sits behind the CE binary's bearer-token
 * + `admin:license`-scope admin middleware, so the actual upload + status
 * fetch requires an admin bearer token the cookie session DOES NOT carry.
 * The page renders a one-time admin-token input that the
 * `LicenseManager` client component keeps in React state only (never
 * localStorage / sessionStorage / document.cookie / URL / log line).
 * Source-invariant tests pin this discipline.
 *
 * The page server component renders the shell + heading + the documented
 * customer copy. It does NOT pre-fetch license status — that fetch requires
 * the admin token which by definition we don't have until the operator
 * supplies it on this page.
 */
import type { Metadata } from "next";
import { LicenseManager } from "./license-manager";

export const metadata: Metadata = {
  title: "License — Identuum Site Admin",
};

export default function SiteAdminLicensePage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">License</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          View and replace the CE license. The setup-time wizard activates the first license;
          replacements after setup is complete happen here.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-sky-950">How this page works</h2>
          <p className="text-sm text-stone-600 mt-1">
            The CE admin license API (<code className="font-mono text-xs">/admin/license</code>) is
            gated by a bearer admin token carrying the{" "}
            <code className="font-mono text-xs">admin:license</code> scope. Paste a current admin
            token below to view the license state, then optionally paste or upload a new license
            envelope to replace it.
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
