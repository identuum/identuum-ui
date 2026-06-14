/**
 * idp-upgrade-client.ts — client/server helpers for the OSS-to-CE
 * upgrade wizard backend exposed by `identuum-idp-ce` at
 * `/api/upgrade/*`. All calls flow through the existing same-origin
 * `/api/idp/...` proxy, so no IDP base URL is ever exposed to browser
 * code (per the standard idp-client.ts invariant).
 *
 * Discriminated-union results mirror `idp-setup-client.ts` and
 * `idp-license-client.ts`: each function returns a tagged outcome
 * rather than throwing, so the wizard can render branch-specific
 * messages without try/catch noise.
 *
 * The upgrade routes live OUTSIDE `/api/v1/` deliberately, alongside
 * the appliance setup APIs. In upgrade mode the CE binary mounts only
 * `/healthz` + `/api/upgrade/*`; in normal serve mode the upgrade
 * routes are mounted alongside `/api/setup/*` so the wizard can probe
 * `ce_migrations_current` / `upgrade_complete` on a healthy CE
 * deployment.
 *
 * The browser MUST NOT persist the upgrade token plaintext or any
 * other secret. `applyUpgrade` passes the token through fetch() and
 * never touches localStorage, sessionStorage, or document.cookie.
 * Source-invariant tests pin this discipline.
 */

const UPGRADE_PATHS = {
  status: "/api/idp/api/upgrade/status",
  preflight: "/api/idp/api/upgrade/preflight",
  apply: "/api/idp/api/upgrade/apply",
  backup: "/api/idp/api/upgrade/backup",
  /**
   * Retention/pruning slice (2026-06-17). Explicit operator-driven
   * delete of a single product-managed backup by filename. The
   * filename in the request body is validated server-side against
   * the strict product-managed pattern; client-side validation here
   * exists for UX only and is not load-bearing.
   */
  backupPrune: "/api/idp/api/upgrade/backup/prune",
} as const;

/**
 * Wire-stable upgrade state vocabulary surfaced by the CE binary.
 * Matches the Go-side `upgrade.State` enum verbatim.
 */
export type UpgradeState =
  | "fresh_ce"
  | "oss_database_detected"
  | "upgrade_required"
  | "ce_migrations_current"
  | "upgrade_complete"
  | "incompatible_database"
  | "database_unreachable"
  | "backup_required";

export interface UpgradeStatusBody {
  state: UpgradeState;
  product: string;
  distribution: string;
  upgradeAvailable: boolean;
  ceMigrationsCurrent: boolean;
  ossDatabaseDetected: boolean;
  backupRequired: boolean;
  nextAction: string;
  appliedVersion?: string;
  targetVersion?: string;
  pendingCount: number;
}

export type UpgradeStatusResult =
  | { kind: "ok"; status: UpgradeStatusBody }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export interface UpgradePreflightCheck {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
}

export interface UpgradePreflightBody {
  state: UpgradeState;
  ready: boolean;
  backupConfirmed: boolean;
  backupRequired: boolean;
  checks: UpgradePreflightCheck[];
  nextAction: string;
}

export type UpgradePreflightResult =
  | { kind: "ok"; preflight: UpgradePreflightBody }
  | { kind: "database_unreachable"; message: string }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export interface ApplyUpgradeInput {
  /** Operator confirmation that a database backup is in place. */
  backupConfirmed: boolean;
  /**
   * One-time upgrade token printed to the CE service logs during
   * upgrade-mode boot. Forwarded verbatim — the wizard never
   * persists this string outside the React state of the active
   * call.
   */
  upgradeToken: string;
}

export interface UpgradeApplyBody {
  state: UpgradeState;
  appliedMigrationsCount: number;
  embeddedMigrationsCount: number;
  appliedVersion?: string;
  targetVersion?: string;
  nextAction: string;
}

/**
 * Granular failure codes the wizard maps to per-case copy. They
 * match the backend's stable wire codes; do not rename without a
 * matching backend slice.
 */
export type ApplyUpgradeFailure =
  | "backup_confirmation_required"
  | "upgrade_token_required"
  | "incompatible_database"
  | "database_unreachable"
  | "upgrade_apply_failed"
  | "invalid_request";

export type ApplyUpgradeResult =
  | { kind: "ok"; result: UpgradeApplyBody }
  | { kind: "rejected"; code: ApplyUpgradeFailure; message: string }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

const UPGRADE_STATES: ReadonlySet<UpgradeState> = new Set<UpgradeState>([
  "fresh_ce",
  "oss_database_detected",
  "upgrade_required",
  "ce_migrations_current",
  "upgrade_complete",
  "incompatible_database",
  "database_unreachable",
  "backup_required",
]);

function isUpgradeState(value: unknown): value is UpgradeState {
  return typeof value === "string" && UPGRADE_STATES.has(value as UpgradeState);
}

function projectStatus(body: Record<string, unknown>): UpgradeStatusBody | null {
  if (!isUpgradeState(body.state)) return null;
  return {
    state: body.state,
    product: typeof body.product === "string" ? body.product : "",
    distribution: typeof body.distribution === "string" ? body.distribution : "",
    upgradeAvailable: body.upgrade_available === true,
    ceMigrationsCurrent: body.ce_migrations_current === true,
    ossDatabaseDetected: body.oss_database_detected === true,
    backupRequired: body.backup_required === true,
    nextAction: typeof body.next_action === "string" ? body.next_action : "",
    appliedVersion: typeof body.applied_version === "string" ? body.applied_version : undefined,
    targetVersion: typeof body.target_version === "string" ? body.target_version : undefined,
    pendingCount: typeof body.pending_count === "number" ? body.pending_count : 0,
  };
}

function projectCheck(raw: unknown): UpgradePreflightCheck | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.label !== "string") return null;
  return {
    id: r.id,
    ok: r.ok === true,
    label: r.label,
    detail: typeof r.detail === "string" ? r.detail : undefined,
  };
}

function projectPreflight(body: Record<string, unknown>): UpgradePreflightBody | null {
  if (!isUpgradeState(body.state)) return null;
  const rawChecks = body.checks;
  const checks: UpgradePreflightCheck[] = [];
  if (Array.isArray(rawChecks)) {
    for (const raw of rawChecks) {
      const check = projectCheck(raw);
      if (check) checks.push(check);
    }
  }
  return {
    state: body.state,
    ready: body.ready === true,
    backupConfirmed: body.backup_confirmed === true,
    backupRequired: body.backup_required === true,
    checks,
    nextAction: typeof body.next_action === "string" ? body.next_action : "",
  };
}

function projectApply(body: Record<string, unknown>): UpgradeApplyBody | null {
  if (!isUpgradeState(body.state)) return null;
  return {
    state: body.state,
    appliedMigrationsCount:
      typeof body.applied_migrations_count === "number" ? body.applied_migrations_count : 0,
    embeddedMigrationsCount:
      typeof body.embedded_migrations_count === "number" ? body.embedded_migrations_count : 0,
    appliedVersion: typeof body.applied_version === "string" ? body.applied_version : undefined,
    targetVersion: typeof body.target_version === "string" ? body.target_version : undefined,
    nextAction: typeof body.next_action === "string" ? body.next_action : "",
  };
}

async function readErrorEnvelope(res: Response): Promise<{ error?: string; nextAction?: string }> {
  try {
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      error: typeof raw.error === "string" ? raw.error : undefined,
      nextAction: typeof raw.next_action === "string" ? raw.next_action : undefined,
    };
  } catch {
    return {};
  }
}

const APPLY_FAILURE_CODES: ReadonlySet<ApplyUpgradeFailure> = new Set<ApplyUpgradeFailure>([
  "backup_confirmation_required",
  "upgrade_token_required",
  "incompatible_database",
  "database_unreachable",
  "upgrade_apply_failed",
  "invalid_request",
]);

function isApplyFailure(value: string | undefined): value is ApplyUpgradeFailure {
  return value !== undefined && APPLY_FAILURE_CODES.has(value as ApplyUpgradeFailure);
}

/**
 * Fetch the current upgrade status snapshot. Always returns a tagged
 * outcome — never throws. The status payload carries no DB URL, no
 * SQL error, no schema fragment, and no upgrade-token plaintext.
 */
export async function getUpgradeStatus(): Promise<UpgradeStatusResult> {
  let res: Response;
  try {
    res = await fetch(UPGRADE_PATHS.status, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (!res.ok) return { kind: "error", status: res.status };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "error", status: res.status };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "error", status: res.status };
  }
  const view = projectStatus(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", status: view };
}

/**
 * Fetch the friendly impact-preview checks. Read-only — runs no
 * migrations. The check list is stable across calls; only the
 * `ok` flag flips between runs.
 */
export async function getUpgradePreflight(
  backupConfirmed: boolean
): Promise<UpgradePreflightResult> {
  let res: Response;
  try {
    res = await fetch(UPGRADE_PATHS.preflight, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backup_confirmed: backupConfirmed }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (res.status === 503) {
    const env = await readErrorEnvelope(res);
    if (env.error === "database_unreachable") {
      return {
        kind: "database_unreachable",
        message:
          env.nextAction ??
          "Cannot reach the configured database. Confirm the database service is running, then retry.",
      };
    }
    return { kind: "error", status: res.status };
  }

  if (!res.ok) return { kind: "error", status: res.status };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "error", status: res.status };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "error", status: res.status };
  }
  const view = projectPreflight(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", preflight: view };
}

/**
 * Apply the embedded CE migrations. Idempotent: re-running against
 * an already-current database returns
 * `{state: "ce_migrations_current", appliedMigrationsCount: 0}`. The
 * token is forwarded only when the path is mutating; the wizard
 * surfaces `upgrade_token_required` when the operator submits
 * without one.
 */
export async function applyUpgrade(input: ApplyUpgradeInput): Promise<ApplyUpgradeResult> {
  let res: Response;
  try {
    res = await fetch(UPGRADE_PATHS.apply, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backup_confirmed: input.backupConfirmed,
        upgrade_token: input.upgradeToken,
      }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (!res.ok) {
    const env = await readErrorEnvelope(res);
    if (isApplyFailure(env.error)) {
      return {
        kind: "rejected",
        code: env.error,
        message: env.nextAction ?? env.error.replace(/_/g, " "),
      };
    }
    return { kind: "error", status: res.status };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "error", status: res.status };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "error", status: res.status };
  }
  const view = projectApply(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", result: view };
}

/**
 * Wire-stable backup-availability reason codes the wizard maps to
 * customer-facing copy. Matches the Go-side
 * `upgrade.BackupReason*` constants verbatim.
 */
export type BackupReason =
  | "pg_dump_unavailable"
  | "data_dir_unset"
  | "data_dir_unsafe"
  | "database_url_unset"
  | "database_url_invalid";

export interface BackupMetadataBody {
  backupId: string;
  filename: string;
  createdAt: string;
  sizeBytes: number;
  format: string;
  /**
   * True when the entry is the newest backup in the list. Pinned
   * server-side on the first entry of `backups`; mirrored on the
   * `latestBackup` field. The wizard reads this to highlight the
   * primary "Restore this one" candidate without re-comparing
   * filenames client-side.
   */
  isLatest?: boolean;
}

export interface BackupAvailabilityBody {
  automationAvailable: boolean;
  reason?: BackupReason;
  backupDirectory?: string;
  latestBackup?: BackupMetadataBody;
  /**
   * Newest-first list of product-managed backups currently on disk.
   * Capped server-side at `MaxBackupListEntries` (currently 64).
   * The first entry, when present, has `isLatest=true` and is the
   * same record as `latestBackup`. Older wizard versions that read
   * only `latestBackup` keep working unchanged.
   */
  backups?: BackupMetadataBody[];
  nextAction: string;
}

export type BackupStatusResult =
  | { kind: "ok"; status: BackupAvailabilityBody }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export interface BackupCreateBody {
  backupId: string;
  filename: string;
  createdAt: string;
  sizeBytes: number;
  format: string;
  backupDirectory: string;
  nextAction: string;
}

/**
 * Granular failure codes the wizard maps to per-case copy when a
 * Create call is rejected by the backend. They match the backend's
 * stable wire codes; do not rename without a matching backend slice.
 */
export type CreateBackupFailure =
  | "backup_automation_unavailable"
  | "database_unreachable"
  | "backup_failed";

export type CreateBackupResult =
  | { kind: "ok"; result: BackupCreateBody }
  | { kind: "rejected"; code: CreateBackupFailure; reason?: BackupReason; message: string }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

const BACKUP_REASONS: ReadonlySet<BackupReason> = new Set<BackupReason>([
  "pg_dump_unavailable",
  "data_dir_unset",
  "data_dir_unsafe",
  "database_url_unset",
  "database_url_invalid",
]);

function isBackupReason(value: unknown): value is BackupReason {
  return typeof value === "string" && BACKUP_REASONS.has(value as BackupReason);
}

function projectBackupMetadata(raw: unknown): BackupMetadataBody | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.backup_id !== "string" || typeof r.filename !== "string") return undefined;
  return {
    backupId: r.backup_id,
    filename: r.filename,
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
    sizeBytes: typeof r.size_bytes === "number" ? r.size_bytes : 0,
    format: typeof r.format === "string" ? r.format : "",
    isLatest: r.is_latest === true,
  };
}

function projectBackupAvailability(body: Record<string, unknown>): BackupAvailabilityBody | null {
  if (typeof body.automation_available !== "boolean") return null;
  const out: BackupAvailabilityBody = {
    automationAvailable: body.automation_available,
    nextAction: typeof body.next_action === "string" ? body.next_action : "",
  };
  if (isBackupReason(body.reason)) out.reason = body.reason;
  if (typeof body.backup_directory === "string" && body.backup_directory !== "") {
    out.backupDirectory = body.backup_directory;
  }
  const latest = projectBackupMetadata(body.latest_backup);
  if (latest) out.latestBackup = latest;
  if (Array.isArray(body.backups)) {
    const projected: BackupMetadataBody[] = [];
    for (const raw of body.backups) {
      const m = projectBackupMetadata(raw);
      if (m) projected.push(m);
    }
    if (projected.length > 0) out.backups = projected;
  }
  return out;
}

function projectBackupCreate(body: Record<string, unknown>): BackupCreateBody | null {
  if (typeof body.backup_id !== "string" || typeof body.filename !== "string") return null;
  return {
    backupId: body.backup_id,
    filename: body.filename,
    createdAt: typeof body.created_at === "string" ? body.created_at : "",
    sizeBytes: typeof body.size_bytes === "number" ? body.size_bytes : 0,
    format: typeof body.format === "string" ? body.format : "",
    backupDirectory: typeof body.backup_directory === "string" ? body.backup_directory : "",
    nextAction: typeof body.next_action === "string" ? body.next_action : "",
  };
}

const CREATE_BACKUP_FAILURE_CODES: ReadonlySet<CreateBackupFailure> = new Set<CreateBackupFailure>([
  "backup_automation_unavailable",
  "database_unreachable",
  "backup_failed",
]);

function isCreateBackupFailure(value: string | undefined): value is CreateBackupFailure {
  return value !== undefined && CREATE_BACKUP_FAILURE_CODES.has(value as CreateBackupFailure);
}

/**
 * Fetch the current backup-automation status snapshot. Always
 * returns a tagged outcome — never throws. The status payload
 * carries no DB URL, no SQL error, no pg_dump stderr, and no
 * backup contents.
 */
export async function getBackupStatus(): Promise<BackupStatusResult> {
  let res: Response;
  try {
    res = await fetch(UPGRADE_PATHS.backup, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (!res.ok) return { kind: "error", status: res.status };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "error", status: res.status };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "error", status: res.status };
  }
  const view = projectBackupAvailability(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", status: view };
}

/**
 * Create a product-managed pg_dump backup against the configured
 * database. Returns a tagged outcome with safe metadata only — the
 * backup contents stay on the appliance data volume. Idempotent at
 * the directory level: repeated calls write additional timestamped
 * files; nothing is rotated.
 */
export async function createBackup(): Promise<CreateBackupResult> {
  let res: Response;
  try {
    res = await fetch(UPGRADE_PATHS.backup, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (!res.ok) {
    let envelope: { error?: string; reason?: string; next_action?: string } = {};
    try {
      envelope = (await res.json()) as typeof envelope;
    } catch {
      /* fall through with empty envelope */
    }
    if (isCreateBackupFailure(envelope.error)) {
      const reason = isBackupReason(envelope.reason) ? envelope.reason : undefined;
      return {
        kind: "rejected",
        code: envelope.error,
        reason,
        message: typeof envelope.next_action === "string" ? envelope.next_action : "",
      };
    }
    return { kind: "error", status: res.status };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "error", status: res.status };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "error", status: res.status };
  }
  const view = projectBackupCreate(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", result: view };
}

/**
 * Wire-stable prune-backup failure codes the wizard maps to
 * customer-facing copy. Matches the backend's stable wire codes;
 * do not rename without a matching backend slice.
 */
export type PruneBackupFailure =
  | "backup_automation_unavailable"
  | "backup_filename_invalid"
  | "backup_not_found"
  | "filename_required"
  | "invalid_request"
  | "backup_prune_failed";

export interface BackupPruneBody {
  filename: string;
  backupDirectory: string;
  nextAction: string;
}

export type PruneBackupResult =
  | { kind: "ok"; result: BackupPruneBody }
  | { kind: "rejected"; code: PruneBackupFailure; reason?: BackupReason; message: string }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

const PRUNE_BACKUP_FAILURE_CODES: ReadonlySet<PruneBackupFailure> = new Set<PruneBackupFailure>([
  "backup_automation_unavailable",
  "backup_filename_invalid",
  "backup_not_found",
  "filename_required",
  "invalid_request",
  "backup_prune_failed",
]);

function isPruneBackupFailure(value: string | undefined): value is PruneBackupFailure {
  return value !== undefined && PRUNE_BACKUP_FAILURE_CODES.has(value as PruneBackupFailure);
}

function projectBackupPrune(body: Record<string, unknown>): BackupPruneBody | null {
  if (typeof body.filename !== "string" || body.filename === "") return null;
  return {
    filename: body.filename,
    backupDirectory: typeof body.backup_directory === "string" ? body.backup_directory : "",
    nextAction: typeof body.next_action === "string" ? body.next_action : "",
  };
}

/**
 * Client-side product-managed-filename pattern. Matches the
 * server-side `backupFilenameRE`. The wire layer is authoritative —
 * this exists only so the UI can refuse an obvious typo before
 * issuing the network call (no point round-tripping a "../etc/passwd"
 * payload). Server-side validation MUST NOT depend on this.
 */
const PRODUCT_BACKUP_FILENAME_PATTERN =
  /^identuum-idp-ce-upgrade-backup-\d{8}T\d{6}Z-[0-9a-f]{8}\.sql$/;

export function isProductBackupFilename(value: unknown): value is string {
  return typeof value === "string" && PRODUCT_BACKUP_FILENAME_PATTERN.test(value);
}

/**
 * Delete a single product-managed backup file by filename.
 *
 * The wizard MUST pass the filename verbatim from the server-supplied
 * backups list — never a user-typed value, never a value reconstructed
 * from the directory + name. The backend re-validates strictly; this
 * helper does a basic pattern guard purely to avoid a round trip when
 * an obviously-malformed filename slipped through the wizard (e.g.
 * during a refactor that broke the list rendering).
 */
export async function pruneBackup(filename: string): Promise<PruneBackupResult> {
  if (!isProductBackupFilename(filename)) {
    // Mirror the backend wire shape so wizard code paths stay symmetrical.
    return {
      kind: "rejected",
      code: "backup_filename_invalid",
      message:
        "The filename did not match a product-managed backup. Refresh the backup list and retry.",
    };
  }
  let res: Response;
  try {
    res = await fetch(UPGRADE_PATHS.backupPrune, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (!res.ok) {
    let envelope: { error?: string; reason?: string; next_action?: string } = {};
    try {
      envelope = (await res.json()) as typeof envelope;
    } catch {
      /* fall through with empty envelope */
    }
    if (isPruneBackupFailure(envelope.error)) {
      const reason = isBackupReason(envelope.reason) ? envelope.reason : undefined;
      return {
        kind: "rejected",
        code: envelope.error,
        reason,
        message: typeof envelope.next_action === "string" ? envelope.next_action : "",
      };
    }
    return { kind: "error", status: res.status };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "error", status: res.status };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "error", status: res.status };
  }
  const view = projectBackupPrune(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", result: view };
}

/**
 * Convenience predicate the runtime probe + redirect priority use
 * to decide whether to route the operator to `/upgrade` ahead of
 * `/setup`. Returns true for states that need operator action in
 * the upgrade wizard.
 */
export function upgradeStateNeedsWizard(state: UpgradeState): boolean {
  return (
    state === "fresh_ce" ||
    state === "oss_database_detected" ||
    state === "upgrade_required" ||
    state === "incompatible_database" ||
    state === "database_unreachable" ||
    state === "backup_required"
  );
}
