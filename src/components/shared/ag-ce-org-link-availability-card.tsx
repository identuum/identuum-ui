/**
 * ag-ce-org-link-availability-card.tsx
 *
 * Shared presentational component rendering the AG CE org-link
 * availability verdict computed by
 * `deriveAGCEOrgLinkAvailability` (lib/ag-ce-org-linking-availability.ts).
 *
 * BEFORE THIS FILE (2026-07-06 refactor):
 *   - `/site-admin/org-link/readiness/page.tsx` defined
 *     `AGCEOrgLinkAvailabilityCard` inline (2026-07-03).
 *   - `/platform-status/page.tsx` defined
 *     `AGCEOrgLinkAvailabilityCallout` inline (2026-07-05).
 *   Both inline components had identical 4-variant switches but
 *   slightly different copy + actionable affordance (one drilled to
 *   the link/unlink console, the other to the readiness page).
 *
 * THIS COMPONENT:
 *   - Replaces both inline definitions.
 *   - Renders the four canonical variants (actionable,
 *     readiness_pending, capability_missing, readiness_unknown).
 *   - Accepts the actionable-affordance difference via the
 *     `actionableTarget` prop (each call site passes its own href +
 *     label).
 *   - Accepts the per-page copy difference via the `copyVariant`
 *     prop (`"action-planning"` for /site-admin/org-link/readiness
 *     where the page is about TAKING the action; `"operational-
 *     health"` for /platform-status where the page is a backend
 *     health overview).
 *
 * STRICT SCOPE (this file owns ONLY presentation):
 *   - Receives the already-derived `AGCEOrgLinkAvailability` from a
 *     server-side caller. No fetch, no derive, no client creation
 *     happens here.
 *   - Knows NOTHING about operator tokens, cookies, Authorization
 *     headers, server actions, link/unlink execution, AG CE fetch
 *     behavior, or `import "server-only"` modules. Safe to import
 *     from any rendering context.
 *   - Renders only the documented operator-readable strings + the
 *     caller-supplied `actionableTarget`. AG CE editorial `notes`
 *     are surfaced verbatim in the `readiness_pending` variant
 *     (already bounded by AG CE's contract per
 *     `wiki/repos/identuum-ag-ce.md` §"Latest landed slice —
 *     2026-07-01").
 *
 * VISUAL LANGUAGE: warm stone background, sky/navy accents,
 * rounded-xl cards with semantic borders (emerald=ok, amber=pending,
 * stone=neutral), restrained motion. Matches the existing
 * BackendReadinessCard + BackendCard primitives. No new design-
 * system primitives introduced.
 */
import type { AGCEOrgLinkAvailability } from "@/lib/ag-ce-org-linking-availability";

/**
 * Drill-in / action target the actionable variant renders. Both
 * existing call sites pass a different target:
 *
 *   /site-admin/org-link/readiness  → href="/site-admin/org-link",
 *                                      label="Open the org-link console"
 *   /platform-status                → href="/site-admin/org-link/readiness",
 *                                      label="Open readiness"
 *
 * The shared component is INTENTIONALLY ignorant of which page the
 * target points to — each call site decides. The component must
 * not bake in either route.
 */
export interface AGCEOrgLinkActionableTarget {
  href: string;
  label: string;
}

/**
 * Copy + layout variant selector. The two canonical sets of copy
 * are preserved from the 2026-07-03 + 2026-07-05 inline components
 * BYTE-IDENTICAL so the existing source-invariant tests on each
 * page (the ones that assert the verbatim copy strings) continue
 * to pass after the refactor.
 *
 *   "action-planning"     — used on action-taking pages (e.g.
 *                            /site-admin/org-link/readiness). Verbose
 *                            descriptions. Stacked actionable layout
 *                            (link on its own line below the
 *                            description).
 *   "operational-health"  — used on operator-health dashboards (e.g.
 *                            /platform-status). Brief descriptions.
 *                            Inline actionable layout (link to the
 *                            right of the description in a flex row).
 */
export type AGCEOrgLinkAvailabilityCopyVariant = "action-planning" | "operational-health";

export interface AGCEOrgLinkAvailabilityCardProps {
  availability: AGCEOrgLinkAvailability;
  actionableTarget: AGCEOrgLinkActionableTarget;
  copyVariant: AGCEOrgLinkAvailabilityCopyVariant;
}

export function AGCEOrgLinkAvailabilityCard({
  availability,
  actionableTarget,
  copyVariant,
}: AGCEOrgLinkAvailabilityCardProps) {
  switch (availability.state) {
    case "actionable":
      return copyVariant === "operational-health" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-800">AG org-link surface ready</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                AG advertises org-linking capability and reports the management surface is mounted.
              </p>
            </div>
            <a
              href={actionableTarget.href}
              className="shrink-0 text-xs font-medium text-sky-700 underline hover:text-sky-800"
            >
              {actionableTarget.label}
            </a>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-emerald-800">
            AG organization linking available
          </p>
          <p className="text-xs text-emerald-700 leading-relaxed">
            Agent Governance reports both the org-linking capability and that the read/write
            org-link routes are mounted. You can proceed to the org-link console.
          </p>
          <div className="pt-1">
            <a
              href={actionableTarget.href}
              className="inline-block text-xs font-medium text-sky-700 underline hover:text-sky-800"
            >
              {actionableTarget.label}
            </a>
          </div>
        </div>
      );
    case "readiness_pending":
      return copyVariant === "operational-health" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-amber-800">AG org-link surface pending</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            AG advertises org-linking capability but reports the routes are not fully mounted yet.
          </p>
          {availability.reasons.length > 0 && (
            <ul className="space-y-1 pt-1">
              {availability.reasons.map((reason) => (
                <li key={reason} className="text-xs text-amber-700 leading-relaxed">
                  • {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-amber-800">
            AG organization linking not yet ready
          </p>
          <p className="text-xs text-amber-700 leading-relaxed">
            Agent Governance advertises the org-linking capability but reports the routes are not
            fully mounted yet. The AG operator must finish provisioning the management surface.
          </p>
          {availability.reasons.length > 0 && (
            <ul className="space-y-1 pt-1">
              {availability.reasons.map((reason) => (
                <li key={reason} className="text-xs text-amber-700 leading-relaxed">
                  • {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case "capability_missing":
      return copyVariant === "operational-health" ? (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-stone-700">
            AG org-link capability not advertised
          </p>
          <p className="text-xs text-stone-500 leading-relaxed">
            AG does not advertise the org-linking capability. The AG operator must enable the
            linking surface before this page can offer a drill-in.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-stone-700">
            AG organization linking capability not advertised
          </p>
          <p className="text-xs text-stone-500 leading-relaxed">
            Agent Governance does not advertise the org-linking capability. The AG operator must
            enable the linking surface before this UI can offer org-link actions.
          </p>
        </div>
      );
    case "readiness_unknown":
      return copyVariant === "operational-health" ? (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-stone-700">AG org-link status unavailable</p>
          <p className="text-xs text-stone-500 leading-relaxed">
            {availability.reason === "not_configured"
              ? "No Agent Governance backend is configured for this UI."
              : availability.reason === "ag_unavailable"
                ? "Agent Governance is configured but did not respond to the readiness probe."
                : "Agent Governance returned an unexpected readiness response."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-stone-700">
            AG organization linking status unavailable
          </p>
          <p className="text-xs text-stone-500 leading-relaxed">
            {availability.reason === "not_configured"
              ? "No Agent Governance backend is configured for this UI."
              : availability.reason === "ag_unavailable"
                ? "Agent Governance is configured but did not respond to the readiness probe."
                : "Agent Governance returned an unexpected readiness response."}
          </p>
        </div>
      );
  }
}
