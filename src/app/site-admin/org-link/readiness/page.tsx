import type { Metadata } from "next";
import { AGCEOrgLinkAvailabilityCard } from "@/components/shared/ag-ce-org-link-availability-card";
/**
 * /site-admin/org-link/readiness
 *
 * Organization linking readiness foundation page.
 *
 * Tells an operator whether IDP↔AG organization linking can proceed based on
 * backend presence and discovered capability flags. Does not execute any
 * linking or import operations.
 *
 * SCOPE: organizations only.
 * NOT IN SCOPE — never shown, never imported, never linked:
 *   - Users, org admins, passwords, or MFA state
 *   - Role bindings or permission grants
 *   - Reviewers, auditors, or approval state
 *   - Credentials of any kind
 *
 * Security: renders only typed safe fields from BackendComponentState and
 * ComponentCapabilities. No raw backend payloads, internal URLs, entitlements,
 * license keys, customer IDs, signatures, ciphertext, or user data are rendered.
 */
import { BackendNotConfiguredNotice } from "@/components/shared/backend-not-configured-notice";
import {
  deriveOrganizationCandidateMatches,
  type OrganizationCandidateMatch,
  type OrgExportFetchResult,
} from "@/lib/org-export-candidates";
import {
  fetchAGOrganizationExportCandidates,
  fetchIDPOrganizationExportCandidates,
} from "@/lib/org-export-candidates-client";
import { dryRunImportIDPOrganizationToAG } from "@/lib/org-import-dry-run-client";
import {
  deriveOrganizationLinkingReadiness,
  type LinkingPrerequisite,
} from "@/lib/org-linking-readiness";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import type {
  BackendComponentState,
  ComponentCapabilities,
  OrganizationExportCandidate,
  OrgImportDryRunResult,
} from "@/lib/types";
import { executeOrganizationImportFormAction } from "./actions";

/** Maximum dry-run previews to issue per render. Bounded to keep the page snappy. */
const DRY_RUN_PREVIEW_CAP = 10;

/** Shape of one dry-run preview row carried into the page renderer. */
interface DryRunPreviewRow {
  key: string;
  idp: OrganizationExportCandidate;
  ag: OrganizationExportCandidate | null;
  matchReason: "exact_slug" | "exact_name" | null;
  result: OrgImportDryRunResult;
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Organization Linking — Identuum" };

export default async function OrgLinkReadinessPage() {
  // ABSENCE IS NOT FAILURE (THE-ABSENT-BACKEND): org linking needs BOTH
  // backends. When either is not enabled in the runtime config this page
  // does not render readiness checks marked unmet — it states the
  // not-configured fact plainly (AG copy matches the /ag-admin route guard;
  // the rule is symmetric for the IdP). BOTH absent is an ERROR — an
  // invalid runtime config — and presents in the error style.
  const cfg = loadRuntimeConfig();
  if (cfg && (!cfg.ag.enabled || !cfg.idp.enabled)) {
    const missing = !cfg.ag.enabled && !cfg.idp.enabled ? "both" : !cfg.ag.enabled ? "ag" : "idp";
    return <BackendNotConfiguredNotice title="Organization linking" missing={missing} />;
  }

  const state = await getServerRuntimeState();

  if (!state) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-xl font-bold text-sky-950 tracking-tight">Organization linking</h1>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-sm text-stone-500">
            UI runtime configuration is not available. Run identuum-ui-setup first.
          </p>
        </div>
      </div>
    );
  }

  const readiness = deriveOrganizationLinkingReadiness(state);
  const unmet = readiness.prerequisites.filter((p) => !p.met);

  // Fetch IDP and AG candidate lists in parallel. Both fetches are server-side
  // only; backend URLs, cookies, and bearer tokens never reach the browser.
  // Each fetch independently returns a safe discriminated result — one
  // backend's failure does not block the other.
  //
  // The AG CE org-link availability verdict (capability + readiness probe)
  // is composed server-side by `getServerRuntimeState` (2026-07-08 slice) —
  // see `state.agCEOrgLinkAvailability`. No direct fetch / derive happens
  // here; the readiness round-trip is amortised inside the cached runtime-
  // state call.
  const [idpCandidatesResult, agCandidatesResult] = await Promise.all([
    fetchIDPOrganizationExportCandidates(),
    fetchAGOrganizationExportCandidates(),
  ]);

  // Read the AG CE-specific org-link availability verdict from the
  // composed runtime state. `null` when AG is not enabled in the UI
  // runtime config — the AG CE availability card is then skipped.
  const agCEAvailability = state.agCEOrgLinkAvailability ?? null;

  const idpCandidates = idpCandidatesResult.ok ? idpCandidatesResult.organizations : [];
  const agCandidates = agCandidatesResult.ok ? agCandidatesResult.organizations : [];
  const possibleMatches = deriveOrganizationCandidateMatches(idpCandidates, agCandidates);

  // ── Dry-run previews ──────────────────────────────────────────────────────
  // Build a capped, deterministic list of preview targets so the page never
  // fires unbounded backend calls. Possible matches are previewed first as
  // link-existing dry-runs; remaining slots go to unmatched IDP candidates
  // as create-new dry-runs. dry_run is forced to true inside the client and
  // cannot be overridden from this page.
  const dryRunPreviews = await buildDryRunPreviews(
    idpCandidates,
    agCandidates,
    possibleMatches,
    DRY_RUN_PREVIEW_CAP
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-sky-950 tracking-tight">Organization linking</h1>
        <p className="text-sm text-stone-500 mt-1">
          Readiness check for IDP ↔ AG organization linking.
        </p>
      </div>

      {/* Scope declaration */}
      <ScopeNotice />

      {/* Overall readiness badge */}
      <ReadinessBadge ready={readiness.ready} unmetCount={unmet.length} />

      {/* AG CE org-link availability (capability + readiness probe).
          Action-planning copy variant; actionable variant drills into
          the link/unlink console. Verdict composed by
          `getServerRuntimeState` (2026-07-08); shared component lives
          at `src/components/shared/ag-ce-org-link-availability-card.tsx`
          (2026-07-06 refactor). Skipped entirely when AG is not
          enabled in the UI runtime config. */}
      {agCEAvailability && (
        <AGCEOrgLinkAvailabilityCard
          availability={agCEAvailability}
          actionableTarget={{
            href: "/site-admin/org-link",
            label: "Open the org-link console",
          }}
          copyVariant="action-planning"
        />
      )}

      {/* Backend readiness cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <BackendReadinessCard
          label="Identity Provider (IDP)"
          abbreviation="IDP"
          backend={state.components.idp}
          capabilityKeys={["organization_export", "organization_linking"]}
          capabilityLabels={{
            organization_export: "Organization export",
            organization_linking: "Organization linking",
          }}
        />
        <BackendReadinessCard
          label="Agent Governance (AG)"
          abbreviation="AG"
          backend={state.components.ag}
          capabilityKeys={["organization_import", "organization_export", "organization_linking"]}
          capabilityLabels={{
            organization_import: "Organization import",
            organization_export: "Organization export",
            organization_linking: "Organization linking",
          }}
        />
      </div>

      {/* Prerequisites checklist */}
      <PrerequisitesList prerequisites={readiness.prerequisites} />

      {/* Missing prerequisites — shown only when not ready */}
      {!readiness.ready && unmet.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 space-y-2">
          <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
            Missing prerequisites
          </p>
          <ul className="space-y-1.5">
            {unmet.map((p) => (
              <li key={p.failMessage} className="flex items-start gap-2 text-xs text-amber-700">
                <span className="mt-0.5 shrink-0">✗</span>
                <span>{p.failMessage}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Organization candidates (read-only) */}
      <CandidatesSection idpResult={idpCandidatesResult} agResult={agCandidatesResult} />

      {/* Possible matches preview (read-only, non-mutating) */}
      <PossibleMatchesPreview matches={possibleMatches} />

      {/* Dry-run import/link preview (server-side, dry_run=true only) */}
      <DryRunPreviewSection rows={dryRunPreviews} cap={DRY_RUN_PREVIEW_CAP} />

      {/* Disabled action area */}
      <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-sky-950">Start organization linking</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Wizard implementation is pending. This page currently validates readiness only.
            </p>
          </div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="shrink-0 rounded-lg bg-stone-100 border border-stone-200 px-4 py-2 text-xs font-medium text-stone-400 cursor-not-allowed select-none"
          >
            Start linking
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="border-t border-stone-200 pt-4 flex gap-6">
        <a
          href="/site-admin/org-link"
          className="text-sm text-sky-600 hover:text-sky-700 underline"
        >
          Go to organization link
        </a>
        <a
          href="/platform-status"
          className="text-sm text-stone-400 hover:text-stone-500 underline"
        >
          Platform status
        </a>
        <a href="/site-admin" className="text-sm text-stone-400 hover:text-stone-500 underline">
          Back to admin
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScopeNotice() {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 space-y-1">
      <p className="text-xs font-semibold text-sky-800">Organization scope only</p>
      <p className="text-xs text-sky-700 leading-relaxed">
        This links organizations between Identuum IDP and Identuum AG. It does not copy users,
        passwords, MFA, org admins, reviewers, auditors, or role bindings. Admin assignment is a
        separate explicit workflow performed after organizations are linked.
      </p>
    </div>
  );
}

function ReadinessBadge({ ready, unmetCount }: { ready: boolean; unmetCount: number }) {
  if (ready) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-semibold text-emerald-800">Ready</p>
        <p className="text-xs text-emerald-700 mt-0.5">
          All prerequisites are met. Organization linking can proceed once the wizard is available.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-800">Not ready</p>
      <p className="text-xs text-amber-700 mt-0.5">
        {unmetCount} prerequisite{unmetCount !== 1 ? "s" : ""} must be met before organization
        linking can proceed.
      </p>
    </div>
  );
}

function BackendReadinessCard({
  label,
  abbreviation,
  backend,
  capabilityKeys,
  capabilityLabels,
}: {
  label: string;
  abbreviation: string;
  backend: BackendComponentState;
  capabilityKeys: Array<keyof ComponentCapabilities>;
  capabilityLabels: Partial<Record<keyof ComponentCapabilities, string>>;
}) {
  const statusColor = backend.usable
    ? "text-emerald-600"
    : backend.configured
      ? "text-amber-600"
      : "text-stone-400";

  const statusLabel = backend.usable
    ? "Operational"
    : backend.configured
      ? "Unavailable"
      : "Not configured";

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-sky-700">{abbreviation}</span>
          </div>
          <p className="text-sm font-semibold text-sky-950">{label}</p>
        </div>
        <span className={`text-xs font-medium shrink-0 ${statusColor}`}>{statusLabel}</span>
      </div>

      <div className="space-y-1.5 text-xs">
        <StatusRow label="Configured" met={backend.configured} />
        <StatusRow label="Reachable" met={backend.reachable} />
        <StatusRow label="Usable" met={backend.usable} />
        {backend.component && (
          <div className="flex items-center gap-2 text-stone-400 text-[10px]">
            <span className="uppercase tracking-wide">Component</span>
            <span className="font-mono text-stone-600">{backend.component}</span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-stone-400">Required capabilities</p>
        {capabilityKeys.map((key) => {
          const met = backend.capabilities[key] === true;
          const displayLabel = capabilityLabels[key] ?? String(key);
          return <StatusRow key={key} label={displayLabel} met={met} />;
        })}
      </div>

      {backend.license.status !== "unknown" && (
        <div className="pt-1 border-t border-stone-100">
          <LicenseStatusRow licenseStatus={backend.license.status} />
        </div>
      )}
    </div>
  );
}

function StatusRow({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={met ? "text-emerald-500" : "text-stone-300"}>{met ? "✓" : "✗"}</span>
      <span className={met ? "text-stone-700" : "text-stone-400"}>{label}</span>
    </div>
  );
}

function LicenseStatusRow({ licenseStatus }: { licenseStatus: string }) {
  const isValid = licenseStatus === "valid";
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="uppercase tracking-wide text-stone-400">License</span>
      <span
        className={
          isValid
            ? "text-emerald-600 font-medium"
            : licenseStatus === "expired" || licenseStatus === "invalid"
              ? "text-red-600 font-medium"
              : "text-stone-500"
        }
      >
        {isValid ? "Valid" : licenseStatus}
      </span>
    </div>
  );
}

function PrerequisitesList({ prerequisites }: { prerequisites: LinkingPrerequisite[] }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
      <p className="text-sm font-semibold text-sky-950">Prerequisites</p>
      <ul className="space-y-1.5">
        {prerequisites.map((p) => (
          <li key={p.label} className="flex items-start gap-2 text-xs">
            <span className={`mt-0.5 shrink-0 ${p.met ? "text-emerald-500" : "text-stone-300"}`}>
              {p.met ? "✓" : "✗"}
            </span>
            <span className={p.met ? "text-stone-700" : "text-stone-400"}>{p.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organization candidates section
// ---------------------------------------------------------------------------

function CandidatesSection({
  idpResult,
  agResult,
}: {
  idpResult: OrgExportFetchResult;
  agResult: OrgExportFetchResult;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-sky-950">Organization candidates</p>
        <p className="text-xs text-stone-500 mt-0.5">
          Read-only preview of organizations on each backend. Nothing is written, copied, or linked.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CandidateCard
          label="Identity Provider organizations"
          abbreviation="IDP"
          result={idpResult}
          fallbackErrorLabel="Identity Provider"
        />
        <CandidateCard
          label="Agent Governance organizations"
          abbreviation="AG"
          result={agResult}
          fallbackErrorLabel="Agent Governance"
        />
      </div>
    </div>
  );
}

function CandidateCard({
  label,
  abbreviation,
  result,
  fallbackErrorLabel,
}: {
  label: string;
  abbreviation: string;
  result: OrgExportFetchResult;
  fallbackErrorLabel: string;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-sky-700">{abbreviation}</span>
          </div>
          <p className="text-sm font-semibold text-sky-950">{label}</p>
        </div>
        {result.ok && (
          <span className="text-xs font-medium text-stone-500">
            {result.organizations.length} {result.organizations.length === 1 ? "org" : "orgs"}
          </span>
        )}
      </div>

      {!result.ok && (
        <CandidatesErrorState reason={result.reason} fallbackErrorLabel={fallbackErrorLabel} />
      )}

      {result.ok && result.organizations.length === 0 && (
        <p className="text-xs text-stone-400">No organizations to show.</p>
      )}

      {result.ok && result.organizations.length > 0 && (
        <CandidateList orgs={result.organizations} />
      )}
    </div>
  );
}

function CandidatesErrorState({
  reason,
  fallbackErrorLabel,
}: {
  reason: "not_configured" | "not_ready" | "unauthorized" | "unreachable";
  fallbackErrorLabel: string;
}) {
  const messages: Record<typeof reason, string> = {
    not_configured: `${fallbackErrorLabel} backend is not configured.`,
    not_ready: `${fallbackErrorLabel} backend is not ready. Candidates cannot be loaded.`,
    unauthorized: `Not authorized to load ${fallbackErrorLabel} organization candidates.`,
    unreachable: `Could not load ${fallbackErrorLabel} organization candidates.`,
  };
  return <p className="text-xs text-stone-500">{messages[reason]}</p>;
}

function CandidateList({ orgs }: { orgs: OrganizationExportCandidate[] }) {
  const cap = 25;
  const shown = orgs.slice(0, cap);
  const overflow = orgs.length - shown.length;
  return (
    <ul className="space-y-2">
      {shown.map((o) => (
        <CandidateRow key={`${o.source_component}:${o.id}`} org={o} />
      ))}
      {overflow > 0 && <li className="text-xs text-stone-400">…and {overflow} more</li>}
    </ul>
  );
}

function CandidateRow({ org }: { org: OrganizationExportCandidate }) {
  const timestamp = pickTimestamp(org.updated_at, org.created_at);
  const linkStatus = org.link_status ?? "";
  const linkedIDP = org.linked_idp_organization_id ?? "";
  const isLinked = linkStatus === "linked" || linkedIDP !== "";
  const isUnlinked = linkStatus === "unlinked" && linkedIDP === "";

  return (
    <li className="text-xs text-stone-700">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{safeDisplayString(org.name) || "—"}</span>
        <div className="flex items-center gap-2 shrink-0">
          {isLinked && (
            <span className="text-[10px] uppercase tracking-wide rounded-md bg-sky-100 border border-sky-200 px-1.5 py-0.5 font-medium text-sky-700">
              Linked to IDP
            </span>
          )}
          {isUnlinked && (
            <span className="text-[10px] uppercase tracking-wide text-stone-400">Unlinked</span>
          )}
          {org.status && (
            <span
              className={`text-[10px] uppercase tracking-wide ${candidateStatusClass(org.status)}`}
            >
              {safeDisplayString(org.status)}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[10px] text-stone-400">
        {org.slug && org.slug.trim() !== "" && (
          <span className="font-mono">slug: {safeDisplayString(org.slug)}</span>
        )}
        <span className="font-mono">{safeDisplayString(org.source_component)}</span>
        {timestamp && <span>{timestamp}</span>}
        {isLinked && linkedIDP !== "" && (
          <span className="font-mono">idp: {shortenIDPUUID(linkedIDP)}</span>
        )}
      </div>
    </li>
  );
}

/**
 * shortenIDPUUID redacts a linked IDP UUID to the first 8 characters plus an
 * ellipsis so the operator has enough to correlate across systems without
 * carrying the full UUID across the page surface unnecessarily.
 */
function shortenIDPUUID(s: string): string {
  if (typeof s !== "string") return "";
  const trimmed = s.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 8)}…`;
}

function candidateStatusClass(status: string): string {
  switch (status) {
    case "active":
      return "text-emerald-600";
    case "suspended":
    case "disabled":
      return "text-amber-600";
    case "deleted":
      return "text-red-600";
    default:
      return "text-stone-400";
  }
}

/**
 * pickTimestamp returns a formatted date string for the most recently updated
 * timestamp available, falling back to created_at. Bad input renders nothing
 * instead of crashing.
 */
function pickTimestamp(updated: string | null, created: string | null): string | null {
  const candidate = updated ?? created;
  if (!candidate || candidate.trim() === "") return null;
  try {
    const d = new Date(candidate);
    if (Number.isNaN(d.getTime())) return safeDisplayString(candidate);
    return d.toISOString().slice(0, 10);
  } catch {
    return safeDisplayString(candidate);
  }
}

/**
 * safeDisplayString trims and bounds an arbitrary string field for display.
 * The pure parser already guarantees the field is a string and the allowlist
 * has already discarded sensitive keys; this is a final length-guard.
 */
function safeDisplayString(s: string): string {
  if (typeof s !== "string") return "";
  const trimmed = s.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}…`;
}

// ---------------------------------------------------------------------------
// Possible matches preview
// ---------------------------------------------------------------------------

function PossibleMatchesPreview({ matches }: { matches: OrganizationCandidateMatch[] }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold text-sky-950">Possible matches</p>
        <p className="text-xs text-stone-500 mt-0.5">
          Preview only. These are not real links. Matched by exact slug, then exact name (case- and
          whitespace-insensitive). Nothing is written.
        </p>
      </div>
      {matches.length === 0 ? (
        <p className="text-xs text-stone-400">
          No possible matches found between IDP and AG organization candidates.
        </p>
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => (
            <li
              key={`${m.idp.id}|${m.ag.id}`}
              className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-stone-700 truncate">
                  {safeDisplayString(m.idp.name)} <span className="text-stone-400">⇄</span>{" "}
                  {safeDisplayString(m.ag.name)}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {(m.ag.link_status === "linked" ||
                    (m.ag.linked_idp_organization_id ?? "") !== "") && (
                    <span className="text-[10px] uppercase tracking-wide rounded-md bg-sky-100 border border-sky-200 px-1.5 py-0.5 font-medium text-sky-700">
                      AG linked
                    </span>
                  )}
                  <span className="text-[10px] uppercase tracking-wide text-stone-400 font-mono">
                    {m.reason === "exact_slug" ? "slug match" : "name match"}
                  </span>
                </div>
              </div>
              <div className="text-[10px] text-stone-400 mt-0.5 font-mono">
                possible match · read-only preview
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dry-run preview section
// ---------------------------------------------------------------------------

/**
 * buildDryRunPreviews assembles a capped list of dry-run rows.
 *
 * Strategy:
 *   1. For each possible match (IDP↔AG pair) issue a dry-run with
 *      ag_organization_id set so AG previews "link existing".
 *   2. If slots remain under the cap, take the first unmatched IDP
 *      candidates and issue a dry-run with no ag_organization_id so AG
 *      previews "create new".
 *
 * Calls run in parallel via Promise.all but are bounded by `cap` so the
 * total backend round-trips per render are at most `cap`. The client
 * always sends dry_run=true and never dry_run=false.
 */
async function buildDryRunPreviews(
  idpCandidates: OrganizationExportCandidate[],
  agCandidates: OrganizationExportCandidate[],
  matches: OrganizationCandidateMatch[],
  cap: number
): Promise<DryRunPreviewRow[]> {
  if (cap <= 0) return [];
  // Need at least one IDP candidate to preview anything. If AG candidates are
  // empty there are no matches anyway; create-new previews are still possible
  // when IDP has candidates and AG accepted candidate read but has no orgs.
  if (idpCandidates.length === 0) return [];
  // If neither side returned candidates, nothing to preview.
  void agCandidates;

  // Use a Set to ensure no IDP candidate gets both a link-existing and a
  // create-new preview in the same render — the link-existing preview wins.
  const previewedIDPIds = new Set<string>();

  // Build the link-existing batch (one per possible match, up to cap).
  const matchTargets = matches.slice(0, cap);
  for (const m of matchTargets) previewedIDPIds.add(m.idp.id);

  // Remaining slots go to unmatched IDP candidates as create-new previews.
  const remaining = cap - matchTargets.length;
  const createTargets =
    remaining > 0
      ? idpCandidates.filter((o) => !previewedIDPIds.has(o.id)).slice(0, remaining)
      : [];

  const linkExistingCalls = matchTargets.map(async (m): Promise<DryRunPreviewRow> => {
    const result = await dryRunImportIDPOrganizationToAG({
      idpOrganization: m.idp,
      agOrganizationId: m.ag.id,
    });
    return {
      key: `link:${m.idp.id}:${m.ag.id}`,
      idp: m.idp,
      ag: m.ag,
      matchReason: m.reason,
      result,
    };
  });

  const createCalls = createTargets.map(async (idp): Promise<DryRunPreviewRow> => {
    const result = await dryRunImportIDPOrganizationToAG({
      idpOrganization: idp,
    });
    return {
      key: `create:${idp.id}`,
      idp,
      ag: null,
      matchReason: null,
      result,
    };
  });

  return Promise.all([...linkExistingCalls, ...createCalls]);
}

function DryRunPreviewSection({ rows, cap }: { rows: DryRunPreviewRow[]; cap: number }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold text-sky-950">Import/link dry-run preview</p>
        <p className="text-xs text-stone-500 mt-0.5">
          Dry-run only. Nothing is written. This does not create organizations or links. Previews
          are capped to the first {cap} candidates per render.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-stone-400">
          No dry-run previews available. Run the candidate sections above first.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <DryRunPreviewRow key={r.key} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DryRunPreviewRow({ row }: { row: DryRunPreviewRow }) {
  const idpName = safeDisplayString(row.idp.name) || "—";
  const agName = row.ag ? safeDisplayString(row.ag.name) || "—" : null;

  let actionLabel = "—";
  let statusLabel = "—";
  let message = "";
  let toneClass = "text-stone-500";

  if (row.result.ok) {
    actionLabel = dryRunActionLabel(row.result.response.action);
    statusLabel = dryRunStatusLabel(row.result.response.status);
    message = safeDisplayString(row.result.response.message);
    toneClass = dryRunToneClass(row.result.response.status);
  } else {
    actionLabel = "preview failed";
    statusLabel = dryRunFailureLabel(row.result.reason);
    message = dryRunFailureMessage(row.result.reason);
    toneClass = "text-amber-700";
  }

  return (
    <li className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-stone-700 truncate">
          {agName ? (
            <>
              {idpName} <span className="text-stone-400">⇄</span> {agName}
            </>
          ) : (
            <>{idpName}</>
          )}
        </span>
        <span className="shrink-0 rounded-md bg-sky-100 border border-sky-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700">
          dry-run
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-stone-400 uppercase tracking-wide">action</span>
        <span className="font-mono text-stone-600">{actionLabel}</span>
        <span className="text-stone-400 uppercase tracking-wide">status</span>
        <span className={`font-mono font-medium ${toneClass}`}>{statusLabel}</span>
      </div>
      {message && <div className="text-[10px] text-stone-500">{message}</div>}
      {row.matchReason && (
        <div className="text-[10px] text-stone-400 font-mono">
          matched by {row.matchReason === "exact_slug" ? "slug" : "name"}
        </div>
      )}
      {row.ag && isAGCandidateLinked(row.ag) && (
        <div className="text-[10px] text-sky-700 font-mono">
          AG already linked · idp: {shortenIDPUUID(row.ag.linked_idp_organization_id ?? "")}
        </div>
      )}
      {row.result.ok &&
        isExecutableDryRun(row.result.response.action, row.result.response.status) &&
        !shouldSuppressExecuteForAlreadyLinkedAG(row) && <ExecuteRowForm row={row} />}
    </li>
  );
}

/**
 * isAGCandidateLinked reports whether the parsed AG candidate is already
 * linked to an IDP organization, based on the safe link_status and
 * linked_idp_organization_id fields populated by the AG export endpoint.
 */
function isAGCandidateLinked(ag: OrganizationExportCandidate): boolean {
  if (ag.link_status === "linked") return true;
  if ((ag.linked_idp_organization_id ?? "") !== "") return true;
  return false;
}

/**
 * shouldSuppressExecuteForAlreadyLinkedAG hides the execute button for a
 * link-existing dry-run row when the matched AG candidate is already linked
 * to some IDP organization. The backend will still permit the click and may
 * either no-op or overwrite the link, but the UI defends against surfacing
 * a click that could silently change an existing link.
 *
 * The dry-run response itself already covers the same-IDP idempotent case
 * by returning action=noop/status=already_linked, which fails
 * isExecutableDryRun and would not reach this guard.
 */
function shouldSuppressExecuteForAlreadyLinkedAG(row: DryRunPreviewRow): boolean {
  if (!row.result.ok) return false;
  if (row.result.response.action !== "link_existing_ag_organization") return false;
  if (!row.ag) return false;
  return isAGCandidateLinked(row.ag);
}

/**
 * Returns true only for dry-run rows where executing the planned action is
 * safe to surface as a per-row form. noop/already_linked rows already
 * reflect the desired state and do not need an execute button.
 * rejected/failed rows have no actionable execute path.
 */
function isExecutableDryRun(action: string, status: string): boolean {
  if (status !== "planned") return false;
  return action === "create_ag_organization" || action === "link_existing_ag_organization";
}

/**
 * ExecuteRowForm renders an explicit, per-row server-action form for one
 * dry-run-planned operation. The form posts to executeOrganizationImportAction
 * with confirm_scope="organization_only" and the safe IDP candidate fields.
 *
 * No bulk action. No JSON blob. Each form is for exactly one IDP candidate
 * (and optionally one AG candidate when linking existing).
 *
 * Adjacent safety text reminds the operator that this is organization-only.
 */
function ExecuteRowForm({ row }: { row: DryRunPreviewRow }) {
  // Defensive: only render when dry-run succeeded and is planned. Caller
  // already gates via isExecutableDryRun, but keep the type-narrowing local.
  if (!row.result.ok) return null;
  if (row.result.response.status !== "planned") return null;

  const isLinkExisting = row.result.response.action === "link_existing_ag_organization";
  const buttonLabel = isLinkExisting ? "Link existing AG organization" : "Create AG organization";

  // The checkbox id needs to be unique within the rendered list so the
  // label can be properly associated with the input via htmlFor.
  const confirmInputId = `confirm-scope-${row.key}`;

  return (
    <form
      action={executeOrganizationImportFormAction}
      className="mt-2 pt-2 border-t border-stone-100 space-y-2"
    >
      {/* Safe IDP organization fields read by the server action from FormData.
          No JSON blob is ever posted. */}
      <input type="hidden" name="idp_id" value={row.idp.id} />
      <input type="hidden" name="idp_name" value={row.idp.name} />
      <input type="hidden" name="idp_slug" value={row.idp.slug} />
      <input type="hidden" name="idp_status" value={row.idp.status} />
      <input
        type="hidden"
        name="idp_created_at"
        value={typeof row.idp.created_at === "string" ? row.idp.created_at : ""}
      />
      <input
        type="hidden"
        name="idp_updated_at"
        value={typeof row.idp.updated_at === "string" ? row.idp.updated_at : ""}
      />
      <input type="hidden" name="idp_source_component" value="identuum-idp" />
      {isLinkExisting && row.ag && (
        <input type="hidden" name="ag_organization_id" value={row.ag.id} />
      )}

      {/* Visible required confirmation. When unchecked, the browser does NOT
          submit the confirm_scope field at all; the server action then
          returns reason="confirmation_missing" and the backend is not
          called. Combined with the server action's typed equality check
          (value must equal "organization_only"), this gives operators an
          explicit, audited "I understand" gesture before any mutation. */}
      <label
        htmlFor={confirmInputId}
        className="flex items-start gap-2 text-[10px] text-stone-600 leading-snug cursor-pointer select-none"
      >
        <input
          type="checkbox"
          id={confirmInputId}
          name="confirm_scope"
          value="organization_only"
          required
          aria-required="true"
          className="mt-0.5 shrink-0 accent-sky-600"
        />
        <span>
          I understand this action only creates or links the organization record. It does not copy
          users, passwords, MFA, roles, admins, reviewers, auditors, sessions, or tokens.
        </span>
      </label>
      <button
        type="submit"
        className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-800 hover:bg-sky-100 transition-colors"
      >
        {buttonLabel}
      </button>
    </form>
  );
}

function dryRunActionLabel(action: string): string {
  switch (action) {
    case "create_ag_organization":
      return "create AG org";
    case "link_existing_ag_organization":
      return "link existing AG org";
    case "noop":
      return "no change";
    case "rejected":
      return "rejected";
    default:
      return "unknown";
  }
}

function dryRunStatusLabel(status: string): string {
  switch (status) {
    case "planned":
      return "planned";
    case "already_linked":
      return "already linked";
    case "rejected":
      return "rejected";
    default:
      return "unknown";
  }
}

function dryRunToneClass(status: string): string {
  switch (status) {
    case "planned":
      return "text-emerald-600";
    case "already_linked":
      return "text-sky-600";
    case "rejected":
      return "text-red-600";
    default:
      return "text-stone-500";
  }
}

function dryRunFailureLabel(reason: string): string {
  switch (reason) {
    case "not_configured":
      return "not configured";
    case "not_ready":
      return "not ready";
    case "unauthorized":
      return "unauthorized";
    case "unsafe_response":
      return "unsafe response";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

function dryRunFailureMessage(reason: string): string {
  switch (reason) {
    case "not_configured":
      return "Agent Governance backend is not configured.";
    case "not_ready":
      return "Agent Governance backend is not ready for dry-run preview.";
    case "unauthorized":
      return "Not authorized to run dry-run preview against Agent Governance.";
    case "unsafe_response":
      return "Agent Governance returned an unexpected response for the dry-run preview.";
    case "failed":
      return "Dry-run preview could not be completed.";
    default:
      return "Dry-run preview could not be completed.";
  }
}

// Note: the prior inline `AGCEOrgLinkAvailabilityCard` sub-component
// was extracted to `@/components/shared/ag-ce-org-link-availability-card`
// in the 2026-07-06 refactor. The page renders that shared component
// directly above; the inline definition no longer lives here.
