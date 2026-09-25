"use client";

/**
 * upgrade-wizard.tsx — OSS-to-CE upgrade wizard rendered at /upgrade.
 *
 * Phase 9 / D-IDP-INSTALL-13 / D-IDP-INSTALL-14 / D-IDP-INSTALL-15:
 * the UI detects upgrade-required state, fetches the friendly impact
 * preview, gates on explicit backup confirmation, accepts the
 * one-time upgrade token from the CE service logs, and applies the
 * upgrade. The post-apply screen advises the operator to restart the
 * CE service and continue with first-run setup.
 *
 * Hard rules pinned by source-invariant tests:
 *   - No reads or writes of localStorage, sessionStorage, or
 *     document.cookie. The upgrade token lives only in the React
 *     state of this component and is cleared after the apply call
 *     returns.
 *   - The wizard does not display internal schema vocabulary
 *     (goose_db_version_ce / oauth_clients TEXT[]→JSONB /
 *     local_sessions / retired signing_keys) in primary copy. The
 *     backend-provided friendly Label strings are the primary
 *     surface; operator-facing Detail strings are revealed only
 *     under an explicit "Show details" disclosure.
 *   - The wizard does not name a direct identuum-idp URL — every
 *     call flows through the same-origin /api/idp/... proxy.
 */

import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  KeyRound,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { LocalTime } from "@/components/ui/local-time";
import { formatCount } from "@/lib/format-count";
import {
  applyUpgrade,
  type BackupAvailabilityBody,
  type BackupCreateBody,
  type BackupMetadataBody,
  type CreateBackupFailure,
  createBackup,
  getBackupStatus,
  getUpgradePreflight,
  getUpgradeStatus,
  type PruneBackupFailure,
  pruneBackup,
  type UpgradeApplyBody,
  type UpgradePreflightBody,
  type UpgradeState,
} from "@/lib/idp-upgrade-client";

interface InitialStatus {
  state: UpgradeState;
  distribution: string;
  product: string;
  upgradeAvailable: boolean;
  backupRequired: boolean;
  ossDatabaseDetected: boolean;
  ceMigrationsCurrent: boolean;
  nextAction: string;
  pendingCount: number;
  appliedVersion?: string;
  targetVersion?: string;
}

interface Props {
  initialStatus: InitialStatus | null;
}

type PreflightState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; body: UpgradePreflightBody }
  | { kind: "database_unreachable"; message: string }
  | { kind: "unreachable" }
  | { kind: "error"; message: string };

type ApplyState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; body: UpgradeApplyBody }
  | { kind: "error"; message: string };

type BackupStatusState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; body: BackupAvailabilityBody }
  | { kind: "unreachable" }
  | { kind: "error"; message: string };

type BackupCreateState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; body: BackupCreateBody }
  | { kind: "error"; message: string };

/**
 * Per-row prune state. The wizard tracks one in-flight prune at a
 * time (a future slice may extend this to a per-row map if multiple
 * concurrent prunes are required), and stores the last-attempted
 * filename + outcome so the surface remains stable across
 * subsequent list refreshes. The pending-confirm state is the
 * inline confirmation step before the destructive POST is fired.
 */
type BackupPruneState =
  | { kind: "idle" }
  | { kind: "pending-confirm"; filename: string }
  | { kind: "submitting"; filename: string }
  | { kind: "ok"; filename: string }
  | { kind: "error"; filename: string; message: string };

export function UpgradeWizard({ initialStatus }: Props) {
  const [status, setStatus] = useState<InitialStatus | null>(initialStatus);
  const [statusRefreshing, setStatusRefreshing] = useState(false);

  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [preflight, setPreflight] = useState<PreflightState>({ kind: "idle" });

  const [upgradeToken, setUpgradeToken] = useState("");
  const [applyState, setApplyState] = useState<ApplyState>({ kind: "idle" });
  const [showDetails, setShowDetails] = useState(false);

  // Phase 10 — product-managed backup automation (D-IDP-INSTALL-15).
  // The wizard exposes a "Create backup" affordance when the backend
  // reports `automation_available=true`. When automation is
  // unavailable (older CE image without pg_dump, customer-managed
  // Postgres, unsafe data dir) the wizard still requires the
  // backup-confirmed checkbox so the operator has to confirm an
  // external backup before applying.
  const [backupStatus, setBackupStatus] = useState<BackupStatusState>({ kind: "idle" });
  const [backupCreate, setBackupCreate] = useState<BackupCreateState>({ kind: "idle" });
  // Retention/pruning slice (2026-06-17). The wizard reads the
  // newest-first `backups` array from the availability snapshot and
  // surfaces a per-row "Remove" action. The destructive POST runs
  // only after the operator clicks "Confirm". No auto-prune anywhere.
  const [backupPrune, setBackupPrune] = useState<BackupPruneState>({ kind: "idle" });

  // Re-fetch status on mount so a stale tab landing here does not
  // strand the operator on outdated copy. The server component's
  // initial fetch is fine for the first paint; this is defense in
  // depth for tabs left open across operator actions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getUpgradeStatus();
      if (cancelled || res.kind !== "ok") return;
      setStatus({
        state: res.status.state,
        distribution: res.status.distribution,
        product: res.status.product,
        upgradeAvailable: res.status.upgradeAvailable,
        backupRequired: res.status.backupRequired,
        ossDatabaseDetected: res.status.ossDatabaseDetected,
        ceMigrationsCurrent: res.status.ceMigrationsCurrent,
        nextAction: res.status.nextAction,
        pendingCount: res.status.pendingCount,
        appliedVersion: res.status.appliedVersion,
        targetVersion: res.status.targetVersion,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Probe the backup-automation availability on mount and whenever
  // the underlying state changes (e.g. after a refresh). The probe
  // is read-only and does NOT spawn pg_dump.
  useEffect(() => {
    if (!status || status.state === "upgrade_complete") return;
    let cancelled = false;
    setBackupStatus({ kind: "loading" });
    (async () => {
      const res = await getBackupStatus();
      if (cancelled) return;
      switch (res.kind) {
        case "ok":
          setBackupStatus({ kind: "ok", body: res.status });
          break;
        case "unreachable":
          setBackupStatus({ kind: "unreachable" });
          break;
        default:
          setBackupStatus({
            kind: "error",
            message: `Could not check backup availability (HTTP ${res.status}).`,
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Fire the preflight probe whenever the operator toggles the
  // backup-confirmed checkbox or the underlying state changes. The
  // preflight is read-only — it never mutates the database.
  useEffect(() => {
    if (!status || status.state === "upgrade_complete") return;
    let cancelled = false;
    setPreflight({ kind: "loading" });
    (async () => {
      const res = await getUpgradePreflight(backupConfirmed);
      if (cancelled) return;
      switch (res.kind) {
        case "ok":
          setPreflight({ kind: "ok", body: res.preflight });
          break;
        case "database_unreachable":
          setPreflight({ kind: "database_unreachable", message: res.message });
          break;
        case "unreachable":
          setPreflight({ kind: "unreachable" });
          break;
        default:
          setPreflight({
            kind: "error",
            message: `Could not load the upgrade preview (HTTP ${res.status}).`,
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backupConfirmed, status]);

  async function handleRefreshStatus() {
    setStatusRefreshing(true);
    const res = await getUpgradeStatus();
    setStatusRefreshing(false);
    if (res.kind !== "ok") return;
    setStatus({
      state: res.status.state,
      distribution: res.status.distribution,
      product: res.status.product,
      upgradeAvailable: res.status.upgradeAvailable,
      backupRequired: res.status.backupRequired,
      ossDatabaseDetected: res.status.ossDatabaseDetected,
      ceMigrationsCurrent: res.status.ceMigrationsCurrent,
      nextAction: res.status.nextAction,
      pendingCount: res.status.pendingCount,
      appliedVersion: res.status.appliedVersion,
      targetVersion: res.status.targetVersion,
    });
  }

  async function handleCreateBackup() {
    setBackupCreate({ kind: "submitting" });
    const res = await createBackup();
    switch (res.kind) {
      case "ok":
        setBackupCreate({ kind: "ok", body: res.result });
        // After a successful product-managed backup, mark the
        // operator-facing checkbox confirmed. The Apply call still
        // forwards backup_confirmed=true to the backend so the gate
        // logic is unchanged.
        setBackupConfirmed(true);
        // Refresh the availability snapshot so latest_backup carries
        // the new file metadata.
        setBackupStatus({ kind: "loading" });
        {
          const refresh = await getBackupStatus();
          if (refresh.kind === "ok") {
            setBackupStatus({ kind: "ok", body: refresh.status });
          }
        }
        break;
      case "rejected":
        setBackupCreate({
          kind: "error",
          message: backupRejectionCopy(res.code, res.message),
        });
        break;
      case "unreachable":
        setBackupCreate({
          kind: "error",
          message:
            "Could not reach the identity provider while creating the backup. Check that the CE container is running and retry.",
        });
        break;
      default:
        setBackupCreate({
          kind: "error",
          message: `Backup creation failed (HTTP ${res.status}).`,
        });
    }
  }

  /**
   * Two-step prune flow:
   *   1. The "Remove" button in the per-row affordance flips
   *      backupPrune.kind to "pending-confirm" with the operator-
   *      visible filename verbatim. The destructive POST is NOT
   *      fired yet.
   *   2. The inline "Confirm" button fires `pruneBackup(filename)`.
   *      The client helper re-checks the filename against the
   *      product-managed pattern before the network call; the
   *      backend is authoritative either way.
   * The wizard refreshes the availability snapshot after a
   * successful delete so the list re-renders without the dropped
   * entry.
   */
  function handleRequestPrune(filename: string) {
    setBackupPrune({ kind: "pending-confirm", filename });
  }

  function handleCancelPrune() {
    setBackupPrune({ kind: "idle" });
  }

  async function handleConfirmPrune(filename: string) {
    setBackupPrune({ kind: "submitting", filename });
    const res = await pruneBackup(filename);
    switch (res.kind) {
      case "ok":
        setBackupPrune({ kind: "ok", filename: res.result.filename });
        // Refresh the list so the just-deleted row is gone.
        setBackupStatus({ kind: "loading" });
        {
          const refresh = await getBackupStatus();
          if (refresh.kind === "ok") {
            setBackupStatus({ kind: "ok", body: refresh.status });
          }
        }
        break;
      case "rejected":
        setBackupPrune({
          kind: "error",
          filename,
          message: pruneRejectionCopy(res.code, res.message),
        });
        break;
      case "unreachable":
        setBackupPrune({
          kind: "error",
          filename,
          message:
            "Could not reach the identity provider while removing the backup. Check that the CE container is running and retry.",
        });
        break;
      default:
        setBackupPrune({
          kind: "error",
          filename,
          message: `Removing the backup failed (HTTP ${res.status}).`,
        });
    }
  }

  async function handleApply(event: React.FormEvent) {
    event.preventDefault();
    if (!backupConfirmed) {
      setApplyState({
        kind: "error",
        message: "Confirm a database backup before starting the upgrade.",
      });
      return;
    }
    const tokenToSend = upgradeToken.trim();
    if (tokenToSend === "") {
      setApplyState({
        kind: "error",
        message: "Paste the upgrade token from the CE service logs before applying.",
      });
      return;
    }
    setApplyState({ kind: "submitting" });
    const res = await applyUpgrade({
      backupConfirmed: true,
      upgradeToken: tokenToSend,
    });
    // Drop the token from React state once the apply call returns.
    // The wizard never persists it beyond the single request.
    setUpgradeToken("");

    switch (res.kind) {
      case "ok":
        setApplyState({ kind: "ok", body: res.result });
        setStatus({
          state: res.result.state,
          distribution: status?.distribution ?? "",
          product: status?.product ?? "",
          upgradeAvailable: false,
          backupRequired: false,
          ossDatabaseDetected: status?.ossDatabaseDetected ?? false,
          ceMigrationsCurrent: true,
          nextAction: res.result.nextAction,
          pendingCount: 0,
          appliedVersion: res.result.appliedVersion,
          targetVersion: res.result.targetVersion,
        });
        break;
      case "rejected":
        setApplyState({
          kind: "error",
          message: rejectionCopy(res.code, res.message),
        });
        break;
      case "unreachable":
        setApplyState({
          kind: "error",
          message:
            "Could not reach the identity provider while applying the upgrade. Check that the CE container is running and retry.",
        });
        break;
      default:
        setApplyState({
          kind: "error",
          message: `Upgrade apply failed (HTTP ${res.status}).`,
        });
    }
  }

  const summary = describeStatus(status);
  const showApplyForm =
    status !== null &&
    status.state !== "ce_migrations_current" &&
    status.state !== "upgrade_complete" &&
    status.state !== "incompatible_database";
  const showCompleted = status?.state === "upgrade_complete" || applyState.kind === "ok";

  return (
    <div className="mt-6 flex flex-col gap-8" data-testid="upgrade-wizard">
      {/* Section 1 — current state summary */}
      <section aria-labelledby="upgrade-summary" className="flex flex-col gap-3">
        <h2
          id="upgrade-summary"
          className="text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Current state
        </h2>
        <div
          className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 leading-relaxed"
          data-testid="upgrade-state-card"
        >
          <p className="flex items-start gap-2 font-medium">
            <Database aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
            <span data-testid="upgrade-state-title">{summary.title}</span>
          </p>
          <p className="mt-1 text-stone-600" data-testid="upgrade-state-copy">
            {summary.copy}
          </p>
          {status?.nextAction ? (
            <p
              className="mt-2 text-xs text-stone-500 leading-relaxed"
              data-testid="upgrade-next-action"
            >
              <strong className="text-stone-700">Next:</strong> {status.nextAction}
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshStatus}
              disabled={statusRefreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs text-sky-950 shadow-sm hover:bg-stone-50 disabled:opacity-70 disabled:cursor-not-allowed"
              data-testid="upgrade-refresh-status"
            >
              {statusRefreshing ? (
                <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCcw aria-hidden="true" className="h-3 w-3" />
              )}
              Refresh status
            </button>
          </div>
        </div>
      </section>

      {/* Section 2 — friendly impact preview (preflight checks) */}
      {showApplyForm ? (
        <section aria-labelledby="upgrade-preflight" className="flex flex-col gap-3">
          <h2
            id="upgrade-preflight"
            className="text-sm font-semibold uppercase tracking-wide text-stone-500"
          >
            What this upgrade does
          </h2>
          {preflight.kind === "loading" ? (
            <p
              className="flex items-center gap-2 text-sm text-stone-500"
              data-testid="upgrade-preflight-loading"
            >
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Loading the upgrade preview…
            </p>
          ) : preflight.kind === "ok" ? (
            <ul
              className="flex flex-col gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3"
              data-testid="upgrade-preflight-checks"
            >
              {preflight.body.checks.map((check) => (
                <li
                  key={check.id}
                  className="flex items-start gap-2 text-sm text-sky-950"
                  data-testid={`upgrade-preflight-check-${check.id}`}
                >
                  {check.ok ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600"
                    />
                  ) : (
                    <AlertCircle
                      aria-hidden="true"
                      className="h-4 w-4 mt-0.5 shrink-0 text-amber-600"
                    />
                  )}
                  <span className="flex-1">
                    <span className="block font-medium">{check.label}</span>
                  </span>
                </li>
              ))}
              {preflight.body.checks.some((c) => c.detail) ? (
                <li className="mt-1">
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-sky-700"
                    data-testid="upgrade-preflight-details-toggle"
                    aria-expanded={showDetails}
                  >
                    {showDetails ? (
                      <ChevronDown aria-hidden="true" className="h-3 w-3" />
                    ) : (
                      <ChevronRight aria-hidden="true" className="h-3 w-3" />
                    )}
                    {showDetails ? "Hide technical details" : "Show technical details"}
                  </button>
                  {showDetails ? (
                    <ul
                      className="mt-2 flex flex-col gap-1.5 border-t border-stone-100 pt-2"
                      data-testid="upgrade-preflight-details"
                    >
                      {preflight.body.checks
                        .filter((c) => c.detail)
                        .map((c) => (
                          <li
                            key={`${c.id}-detail`}
                            className="text-xs text-stone-500 leading-relaxed"
                          >
                            <strong className="text-stone-600">{c.label}:</strong> {c.detail}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </li>
              ) : null}
            </ul>
          ) : preflight.kind === "database_unreachable" ? (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-rose-700"
              data-testid="upgrade-preflight-database-unreachable"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{preflight.message}</span>
            </p>
          ) : preflight.kind === "unreachable" ? (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-rose-700"
              data-testid="upgrade-preflight-unreachable"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Could not reach the identity provider to load the upgrade preview.</span>
            </p>
          ) : preflight.kind === "error" ? (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-rose-700"
              data-testid="upgrade-preflight-error"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{preflight.message}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Section 2b — product-managed backup automation. The
          backend reports whether pg_dump-driven backups are available
          for the local Compose Postgres. When available the wizard
          renders a "Create backup" affordance that writes a pg_dump
          to the appliance data volume. When unavailable (older
          image, customer-managed Postgres, unsafe data dir) the
          wizard surfaces the operator-facing "Confirm an external
          backup" path. The backup-confirmed checkbox in the next
          section gates Apply in both cases. */}
      {showApplyForm && !showCompleted ? (
        <section aria-labelledby="upgrade-backup" className="flex flex-col gap-3">
          <h2
            id="upgrade-backup"
            className="text-sm font-semibold uppercase tracking-wide text-stone-500"
          >
            Database backup
          </h2>
          {backupStatus.kind === "loading" || backupStatus.kind === "idle" ? (
            <p
              className="flex items-center gap-2 text-sm text-stone-500"
              data-testid="upgrade-backup-loading"
            >
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Checking backup availability…
            </p>
          ) : backupStatus.kind === "ok" && backupStatus.body.automationAvailable ? (
            <div
              className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-sky-950 leading-relaxed"
              data-testid="upgrade-backup-automation-card"
            >
              <p className="flex items-start gap-2">
                <Archive aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
                <span>
                  {backupStatus.body.nextAction ||
                    "Create a product-managed database backup before applying the upgrade."}
                </span>
              </p>
              {backupStatus.body.latestBackup ? (
                <p className="text-xs text-stone-500" data-testid="upgrade-backup-latest">
                  <strong className="text-stone-700">Latest backup:</strong>{" "}
                  <span className="font-mono break-all">
                    {backupStatus.body.latestBackup.filename}
                  </span>{" "}
                  <span className="text-stone-400">
                    ({formatCount(backupStatus.body.latestBackup.sizeBytes)} bytes,{" "}
                    <LocalTime
                      value={backupStatus.body.latestBackup.createdAt}
                      fallback={backupStatus.body.latestBackup.createdAt}
                    />
                    )
                  </span>
                </p>
              ) : null}
              {/* Retention/pruning slice (2026-06-17). The backend
                  returns a newest-first list of product-managed
                  backups; the wizard surfaces it so the operator can
                  see what is on disk and explicitly remove an old
                  entry. No auto-prune anywhere. */}
              <BackupList
                backups={backupStatus.body.backups ?? []}
                pruneState={backupPrune}
                onRequestPrune={handleRequestPrune}
                onCancelPrune={handleCancelPrune}
                onConfirmPrune={handleConfirmPrune}
              />
              {backupPrune.kind === "ok" ? (
                <p
                  className="flex items-start gap-2 text-sm text-emerald-700"
                  data-testid="upgrade-backup-prune-ok"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600"
                  />
                  <span>
                    Backup removed:{" "}
                    <span className="font-mono break-all">{backupPrune.filename}</span>
                  </span>
                </p>
              ) : null}
              {backupPrune.kind === "error" ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 text-sm text-rose-700"
                  data-testid="upgrade-backup-prune-error"
                >
                  <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{backupPrune.message}</span>
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleCreateBackup}
                  disabled={backupCreate.kind === "submitting"}
                  className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-800 shadow-sm hover:bg-sky-100 disabled:opacity-70 disabled:cursor-not-allowed"
                  data-testid="upgrade-backup-create"
                >
                  {backupCreate.kind === "submitting" ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Archive aria-hidden="true" className="h-4 w-4" />
                  )}
                  {backupCreate.kind === "submitting" ? "Creating backup…" : "Create backup"}
                </button>
                {backupStatus.body.backupDirectory ? (
                  <span className="text-xs text-stone-500" data-testid="upgrade-backup-directory">
                    Backups are written to{" "}
                    <span className="font-mono">{backupStatus.body.backupDirectory}</span>
                  </span>
                ) : null}
              </div>
              {backupCreate.kind === "ok" ? (
                <p
                  className="flex items-start gap-2 text-sm text-emerald-700"
                  data-testid="upgrade-backup-create-ok"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600"
                  />
                  <span>
                    Backup created:{" "}
                    <span className="font-mono break-all">{backupCreate.body.filename}</span> (
                    {formatCount(backupCreate.body.sizeBytes)} bytes).
                  </span>
                </p>
              ) : null}
              {backupCreate.kind === "error" ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 text-sm text-rose-700"
                  data-testid="upgrade-backup-create-error"
                >
                  <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{backupCreate.message}</span>
                </p>
              ) : null}
            </div>
          ) : backupStatus.kind === "ok" ? (
            <p
              className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed"
              data-testid="upgrade-backup-external-required"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <span>{backupStatus.body.nextAction}</span>
            </p>
          ) : backupStatus.kind === "unreachable" ? (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-rose-700"
              data-testid="upgrade-backup-status-unreachable"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Could not reach the identity provider to check backup availability.</span>
            </p>
          ) : backupStatus.kind === "error" ? (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-rose-700"
              data-testid="upgrade-backup-status-error"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{backupStatus.message}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Section 3 — apply form. Backup confirmation + upgrade token. */}
      {showApplyForm && !showCompleted ? (
        <section aria-labelledby="upgrade-apply" className="flex flex-col gap-3">
          <h2
            id="upgrade-apply"
            className="text-sm font-semibold uppercase tracking-wide text-stone-500"
          >
            Start the upgrade
          </h2>
          <form onSubmit={handleApply} className="flex flex-col gap-4" noValidate>
            {/* Backup confirmation */}
            <label
              htmlFor="upgrade_backup_confirmed"
              className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 cursor-pointer hover:bg-stone-50"
              data-testid="upgrade-backup-confirm-label"
            >
              <input
                id="upgrade_backup_confirmed"
                name="upgrade_backup_confirmed"
                type="checkbox"
                checked={backupConfirmed}
                onChange={(e) => setBackupConfirmed(e.target.checked)}
                disabled={applyState.kind === "submitting"}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 text-sky-600 focus:ring-sky-300"
                data-testid="upgrade-backup-confirm"
              />
              <span className="flex flex-col gap-1 text-sm text-sky-950">
                <strong className="font-medium">I have a database backup in place</strong>
                <span className="text-xs text-stone-500 leading-relaxed">
                  The upgrade is one-way. To roll back you must restore the pre-upgrade database
                  backup. Confirm you have a backup before continuing.
                </span>
              </span>
            </label>

            {/* Upgrade token */}
            <div className="flex flex-col gap-2">
              <label htmlFor="upgrade_token" className="text-sm text-sky-950">
                Upgrade token
              </label>
              <p className="text-xs text-stone-500 leading-relaxed">
                Paste the one-time upgrade token your CE service printed on startup. It authorises
                this wizard only and is not an administrator password.
              </p>
              <div className="relative">
                <KeyRound
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400"
                />
                <input
                  id="upgrade_token"
                  name="upgrade_token"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={upgradeToken}
                  onChange={(e) => setUpgradeToken(e.target.value)}
                  disabled={applyState.kind === "submitting"}
                  className="w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 py-2 text-sm text-sky-950 shadow-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-70 disabled:cursor-not-allowed font-mono"
                  placeholder="ABCDEF…"
                  data-testid="upgrade-token-input"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={
                !backupConfirmed ||
                upgradeToken.trim().length === 0 ||
                applyState.kind === "submitting"
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:opacity-70 disabled:cursor-not-allowed"
              data-testid="upgrade-apply-submit"
            >
              {applyState.kind === "submitting" ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck aria-hidden="true" className="h-4 w-4" />
              )}
              {applyState.kind === "submitting" ? "Applying upgrade…" : "Start upgrade"}
            </button>

            {applyState.kind === "error" ? (
              <p
                role="alert"
                className="flex items-start gap-2 text-sm text-rose-700"
                data-testid="upgrade-apply-error"
              >
                <AlertCircle aria-hidden="true" className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{applyState.message}</span>
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {/* Section 4 — completed state. */}
      {showCompleted ? (
        <section aria-labelledby="upgrade-complete" className="flex flex-col gap-3">
          <h2
            id="upgrade-complete"
            className="text-sm font-semibold uppercase tracking-wide text-stone-500"
          >
            Upgrade complete
          </h2>
          <div
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 leading-relaxed"
            data-testid="upgrade-complete-card"
          >
            <p className="flex items-start gap-2 font-medium">
              <CheckCircle2
                aria-hidden="true"
                className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600"
              />
              <span>The CE schema upgrade is complete.</span>
            </p>
            <p className="mt-1 text-emerald-800">
              {applyState.kind === "ok"
                ? applyState.body.nextAction
                : (status?.nextAction ??
                  "Restart the CE service to finish loading the upgraded schema, then continue with first-run setup.")}
            </p>
            <ol className="mt-3 list-decimal list-inside text-xs text-emerald-900 leading-relaxed flex flex-col gap-1">
              <li>Restart the CE service to load the upgraded schema.</li>
              <li>Open the UI again to continue with first-run setup.</li>
            </ol>
          </div>
        </section>
      ) : null}

      {/* Section 5 — incompatible / no-op terminal states. */}
      {status?.state === "incompatible_database" ? (
        <section aria-labelledby="upgrade-incompatible" className="flex flex-col gap-3">
          <h2
            id="upgrade-incompatible"
            className="text-sm font-semibold uppercase tracking-wide text-stone-500"
          >
            Upgrade not available
          </h2>
          <p
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed"
            data-testid="upgrade-incompatible-card"
          >
            <AlertCircle
              aria-hidden="true"
              className="inline-block h-4 w-4 mr-2 -mt-0.5 text-amber-600"
            />
            The database has been written by a newer CE version than this binary supports. Upgrade
            the CE binary before continuing.
          </p>
        </section>
      ) : null}
    </div>
  );
}

/**
 * describeStatus renders the customer-facing state summary block.
 * Backend friendly Label / next_action strings are surfaced; no
 * internal schema vocabulary is rendered in primary copy.
 */
function describeStatus(status: InitialStatus | null): { title: string; copy: string } {
  if (!status) {
    return {
      title: "Checking the upgrade state…",
      copy: "If this message does not change soon, the CE service may be unreachable.",
    };
  }
  switch (status.state) {
    case "fresh_ce":
      return {
        title: "Ready to install the CE schema",
        copy: "No existing data was detected. The wizard will install the CE schema after you confirm a backup and supply the upgrade token.",
      };
    case "oss_database_detected":
      return {
        title: "Existing self-hosted deployment detected",
        copy: "An existing self-hosted database was detected. The wizard will preserve your users, organizations, OAuth clients, and sessions while installing the CE schema.",
      };
    case "upgrade_required":
      return {
        title: "Upgrade in progress",
        copy: "An earlier upgrade did not complete. Resume the upgrade to finish installing the CE schema.",
      };
    case "ce_migrations_current":
      return {
        title: "CE schema is already current",
        copy: "No upgrade is required. The database is already on the CE schema.",
      };
    case "upgrade_complete":
      return {
        title: "Upgrade complete",
        copy: "The CE schema upgrade is complete. Restart the CE service, then continue with first-run setup.",
      };
    case "incompatible_database":
      return {
        title: "Upgrade not available",
        copy: "The database has been written by a newer CE version than this binary supports. Upgrade the CE binary before continuing.",
      };
    case "database_unreachable":
      return {
        title: "Database not reachable",
        copy: "The CE service cannot reach the configured database. Confirm the database service is running, then retry.",
      };
    case "backup_required":
      return {
        title: "Backup required",
        copy: "Confirm a database backup before starting the upgrade.",
      };
  }
}

/**
 * rejectionCopy maps stable backend wire codes to customer-friendly
 * copy. The fallback string is the next_action from the backend,
 * which is already operator-friendly.
 */
/**
 * backupRejectionCopy maps the backup-create wire codes to
 * customer-friendly copy. The fallback string is the backend's
 * next_action which is already operator-friendly when present.
 */
/**
 * BackupList renders the newest-first list of product-managed
 * backups with a per-row "Remove" affordance. The component is
 * deliberately stateless — every visible state is derived from the
 * parent's `pruneState` so the wizard can keep the prune behaviour
 * centralised.
 *
 * The list shows only safe metadata (filename, size, created_at).
 * The backup body is NEVER fetched or rendered.
 */
function BackupList({
  backups,
  pruneState,
  onRequestPrune,
  onCancelPrune,
  onConfirmPrune,
}: {
  backups: BackupMetadataBody[];
  pruneState: BackupPruneState;
  onRequestPrune: (filename: string) => void;
  onCancelPrune: () => void;
  onConfirmPrune: (filename: string) => Promise<void>;
}): React.ReactNode {
  if (backups.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="upgrade-backup-list">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Recent backups</p>
      <ul className="flex flex-col gap-1 rounded-xl border border-stone-200 bg-stone-50/40 px-2 py-1.5">
        {backups.map((b) => {
          const isPendingThis =
            pruneState.kind === "pending-confirm" && pruneState.filename === b.filename;
          const isSubmittingThis =
            pruneState.kind === "submitting" && pruneState.filename === b.filename;
          return (
            <li
              key={b.filename}
              className="flex flex-wrap items-center gap-3 py-1.5"
              data-testid={`upgrade-backup-list-row-${b.filename}`}
            >
              <Archive
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 ${b.isLatest ? "text-sky-600" : "text-stone-400"}`}
              />
              <span className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="font-mono text-xs text-sky-950 break-all">
                  {b.filename}
                  {b.isLatest ? (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                      latest
                    </span>
                  ) : null}
                </span>
                <span className="text-[11px] text-stone-500">
                  {formatCount(b.sizeBytes)} bytes ·{" "}
                  <LocalTime value={b.createdAt} fallback={b.createdAt} />
                </span>
              </span>
              {isPendingThis ? (
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-rose-700 font-medium">
                    Permanently remove this local backup?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void onConfirmPrune(b.filename);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
                    data-testid={`upgrade-backup-prune-confirm-${b.filename}`}
                  >
                    <Trash2 aria-hidden="true" className="h-3 w-3" />
                    Confirm remove
                  </button>
                  <button
                    type="button"
                    onClick={onCancelPrune}
                    className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700 hover:bg-stone-50"
                    data-testid={`upgrade-backup-prune-cancel-${b.filename}`}
                  >
                    Cancel
                  </button>
                </span>
              ) : isSubmittingThis ? (
                <span
                  className="inline-flex items-center gap-1 text-xs text-stone-500"
                  data-testid={`upgrade-backup-prune-submitting-${b.filename}`}
                >
                  <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                  Removing…
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRequestPrune(b.filename)}
                  disabled={pruneState.kind === "submitting"}
                  className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  data-testid={`upgrade-backup-prune-request-${b.filename}`}
                  aria-label={`Remove backup ${b.filename}`}
                >
                  <Trash2 aria-hidden="true" className="h-3 w-3" />
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-stone-500 leading-relaxed">
        Removing a backup permanently deletes the local appliance file. The CE service does not keep
        a hidden copy and restore is only possible from a backup that is still on disk.
      </p>
    </div>
  );
}

/**
 * pruneRejectionCopy maps the prune-backup wire codes to
 * customer-friendly copy. The fallback string is the backend's
 * next_action which is already operator-friendly when present.
 */
function pruneRejectionCopy(code: PruneBackupFailure, fallback: string): string {
  switch (code) {
    case "backup_automation_unavailable":
      return (
        fallback ||
        "Local backup automation is not available. Backups cannot be removed through the wizard."
      );
    case "backup_filename_invalid":
      return (
        fallback ||
        "The filename did not match a product-managed backup. Refresh the backup list and retry."
      );
    case "backup_not_found":
      return fallback || "No backup with that filename exists. Refresh the backup list and retry.";
    case "filename_required":
      return "The prune request did not name a backup file.";
    case "invalid_request":
      return "The prune request was rejected. Reload the page and try again.";
    case "backup_prune_failed":
      return fallback || "Removing the backup failed. Check the CE service logs, then retry.";
  }
}

function backupRejectionCopy(code: CreateBackupFailure, fallback: string): string {
  switch (code) {
    case "backup_automation_unavailable":
      return (
        fallback ||
        "Local backup automation is not available. Confirm an external database backup before applying the upgrade."
      );
    case "database_unreachable":
      return (
        fallback ||
        "The CE service cannot reach the configured database to take a backup. Confirm the database service is running, then retry."
      );
    case "backup_failed":
      return (
        fallback ||
        "Backup creation failed. Check the CE service logs for the pg_dump error, then retry."
      );
  }
}

function rejectionCopy(
  code:
    | "backup_confirmation_required"
    | "upgrade_token_required"
    | "incompatible_database"
    | "database_unreachable"
    | "upgrade_apply_failed"
    | "invalid_request",
  fallback: string
): string {
  switch (code) {
    case "backup_confirmation_required":
      return "Confirm a database backup before starting the upgrade.";
    case "upgrade_token_required":
      return "The upgrade token is required. Paste the one-time token printed in the CE service logs.";
    case "incompatible_database":
      return "The database has been written by a newer CE version than this binary supports. Upgrade the CE binary before continuing.";
    case "database_unreachable":
      return (
        fallback ||
        "The CE service cannot reach the configured database. Confirm the database service is running, then retry."
      );
    case "upgrade_apply_failed":
      return (
        fallback ||
        "The CE migration runner returned an error. Check the CE service logs for details, restore the pre-upgrade database backup if needed, then retry."
      );
    case "invalid_request":
      return "The upgrade request was rejected. Reload the page and try again.";
  }
}
