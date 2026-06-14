/**
 * idp-license-client.ts — client/server helpers for the CE license
 * upload + status surface exposed by `identuum-idp-ce` at
 * `/api/setup/license`. All calls flow through the existing
 * same-origin `/api/idp/...` proxy, so no IDP base URL is ever
 * exposed to browser code (per the standard idp-client.ts
 * invariant).
 *
 * Discriminated-union results mirror `idp-setup-client.ts`: each
 * function returns a tagged outcome rather than throwing, so the
 * wizard CE license step can render branch-specific messages
 * without try/catch noise.
 *
 * The setup-license routes are pre-completion only — they live
 * OUTSIDE `/api/v1/` deliberately, alongside the appliance setup
 * APIs. Before `setup_complete`, POST is gated by the same setup
 * token the wizard already verified. After `setup_complete`, POST
 * returns 401 `admin_upload_pending` — admin-screen license upload
 * is a deferred follow-on slice and the UI presents that as such.
 *
 * The browser MUST NOT persist license envelope content, the setup
 * token plaintext, or any other secret. The two functions below
 * pass values through fetch() and never touch localStorage,
 * sessionStorage, or document.cookie. Source-invariant tests pin
 * this discipline.
 */

const LICENSE_PATHS = {
  status: "/api/idp/api/setup/license",
  upload: "/api/idp/api/setup/license",
  adminStatus: "/api/idp/admin/license",
  adminUpload: "/api/idp/admin/license",
} as const;

/**
 * Wire-stable license state vocabulary surfaced by the IDP.
 * Matches the Go-side license.LicenseStatusState enum.
 */
export type LicenseStatusState =
  | "license_missing"
  | "license_valid"
  | "license_invalid"
  | "license_expired";

export interface LicenseStatusBody {
  state: LicenseStatusState;
  distribution: string;
  product: string;
  tier?: string;
  licensee?: string;
  expiresAt?: string;
  licenseId?: string;
  licenseType?: string;
  nextAction?: string;
}

export type LicenseStatusResult =
  | { kind: "ok"; status: LicenseStatusBody }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export interface UploadLicenseInput {
  setupToken: string;
  /**
   * Raw license envelope text. The wizard passes whatever the
   * operator pasted or uploaded — the IDP runs the full Verifier
   * code path and returns a discriminated outcome below.
   */
  license: string;
}

/**
 * Granular error codes the wizard maps to per-case copy. They
 * match the backend's stable wire codes; do not rename without
 * a matching backend slice.
 */
export type LicenseUploadFailure =
  | "license_envelope_required"
  | "license_envelope_malformed"
  | "license_invalid"
  | "license_expired"
  | "license_product_mismatch"
  | "license_persist_failed"
  | "license_persist_path_unset";

export type UploadLicenseResult =
  | { kind: "ok"; status: LicenseStatusBody }
  | { kind: "bad_token" }
  | { kind: "setup_token_required" }
  | { kind: "admin_upload_pending"; message: string }
  | { kind: "rejected"; code: LicenseUploadFailure; message: string }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

function isLicenseState(value: unknown): value is LicenseStatusState {
  return (
    value === "license_missing" ||
    value === "license_valid" ||
    value === "license_invalid" ||
    value === "license_expired"
  );
}

function projectLicenseStatus(body: Record<string, unknown>): LicenseStatusBody | null {
  if (!isLicenseState(body.state)) return null;
  return {
    state: body.state,
    distribution: typeof body.distribution === "string" ? body.distribution : "",
    product: typeof body.product === "string" ? body.product : "",
    tier: typeof body.tier === "string" ? body.tier : undefined,
    licensee: typeof body.licensee === "string" ? body.licensee : undefined,
    expiresAt: typeof body.expires_at === "string" ? body.expires_at : undefined,
    licenseId: typeof body.license_id === "string" ? body.license_id : undefined,
    licenseType: typeof body.license_type === "string" ? body.license_type : undefined,
    nextAction: typeof body.next_action === "string" ? body.next_action : undefined,
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

const UPLOAD_FAILURE_CODES: ReadonlySet<LicenseUploadFailure> = new Set<LicenseUploadFailure>([
  "license_envelope_required",
  "license_envelope_malformed",
  "license_invalid",
  "license_expired",
  "license_product_mismatch",
  "license_persist_failed",
  "license_persist_path_unset",
]);

function isUploadFailure(value: string | undefined): value is LicenseUploadFailure {
  return value !== undefined && UPLOAD_FAILURE_CODES.has(value as LicenseUploadFailure);
}

/**
 * Fetch the current CE license status. Always returns a tagged
 * outcome — never throws. The status payload carries no envelope
 * material; see internal/license/upload.go for the safe field set.
 */
export async function getLicenseStatus(): Promise<LicenseStatusResult> {
  let res: Response;
  try {
    res = await fetch(LICENSE_PATHS.status, {
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
  const view = projectLicenseStatus(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", status: view };
}

/**
 * Upload a CE license envelope. The wizard supplies the envelope
 * text exactly as the operator pasted or uploaded it; the IDP
 * runs the full Verifier code path and returns either an updated
 * status view or a per-case failure code.
 */
export async function uploadLicense(input: UploadLicenseInput): Promise<UploadLicenseResult> {
  let res: Response;
  try {
    res = await fetch(LICENSE_PATHS.upload, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setup_token: input.setupToken,
        license: input.license,
      }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (res.status === 401) {
    const env = await readErrorEnvelope(res);
    if (env.error === "admin_upload_pending") {
      return {
        kind: "admin_upload_pending",
        message:
          env.nextAction ??
          "Setup is already complete. License upload from an admin screen is a deferred follow-on.",
      };
    }
    if (env.error === "setup_token_invalid") return { kind: "bad_token" };
    if (env.error === "setup_token_required") return { kind: "setup_token_required" };
    return { kind: "bad_token" };
  }

  if (!res.ok) {
    const env = await readErrorEnvelope(res);
    if (isUploadFailure(env.error)) {
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
  const view = projectLicenseStatus(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", status: view };
}

// ---------------------------------------------------------------------------
// Admin-time post-setup license management — distinct from the setup-time
// surface above.
//
// The CE binary exposes the same safe-status + upload contract under
// `/admin/license` behind its bearer-token + `admin:license`-scope admin
// middleware. After `setup_complete` the setup-time `POST /api/setup/license`
// returns `admin_upload_pending`; the admin path picks up from there.
//
// AUTH MODEL — the admin routes are bearer-token gated. The UI session is
// cookie-based and DOES NOT carry an admin bearer token, so the admin helpers
// below accept an admin token per call. The site-admin page renders a
// one-time input for the token; the value lives in React state for the
// duration of the request and is never persisted to localStorage,
// sessionStorage, document.cookie, the URL, or a log line. Source-invariant
// tests pin this discipline.
//
// On a missing / invalid / wrong-scope token the discriminated outcome is
// `kind: "unauthorized"` (mapped from 401) or `kind: "forbidden"` (403). The
// page surfaces a friendly "supply an admin bearer token" message rather than
// blindly retrying.
// ---------------------------------------------------------------------------

export type AdminLicenseStatusResult =
  | { kind: "ok"; status: LicenseStatusBody }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export interface AdminUploadLicenseInput {
  /**
   * Raw bearer admin token. Sent via the Authorization header (the
   * same-origin proxy forwards Authorization through to CE).
   * The token is never persisted by the helper itself — it lives only
   * in the closure of the fetch() call below.
   */
  adminToken: string;
  /**
   * Raw license envelope text. Same shape as `UploadLicenseInput.license`
   * on the setup-time surface above.
   */
  license: string;
}

export type AdminUploadLicenseResult =
  | { kind: "ok"; status: LicenseStatusBody }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "rejected"; code: LicenseUploadFailure; message: string }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

/**
 * Fetch the post-setup admin license status. Always returns a tagged
 * outcome — never throws. Symmetric in body shape with the setup-time
 * `getLicenseStatus()` above so the page can share `LicenseStatusBody`
 * rendering helpers.
 *
 * Auth: when `adminToken` is non-empty it is sent via the Authorization
 * header. When omitted the helper still fires the request — the page
 * may want to show "status unavailable" before the operator supplies a
 * token.
 */
export async function adminGetLicenseStatus(adminToken: string): Promise<AdminLicenseStatusResult> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (adminToken !== "") headers.Authorization = `Bearer ${adminToken}`;
  let res: Response;
  try {
    res = await fetch(LICENSE_PATHS.adminStatus, {
      method: "GET",
      headers,
      cache: "no-store",
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 403) return { kind: "forbidden" };
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
  const view = projectLicenseStatus(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", status: view };
}

/**
 * Upload a CE license envelope via the admin surface. The page supplies
 * the envelope text exactly as the operator pasted or uploaded it; CE runs
 * the same Verifier code path as the setup-time surface and returns either
 * an updated status view or a per-case failure code.
 *
 * The helper does NOT persist the admin token or the envelope — both live
 * only in the closure of this single fetch() call.
 */
export async function adminUploadLicense(
  input: AdminUploadLicenseInput
): Promise<AdminUploadLicenseResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.adminToken !== "") headers.Authorization = `Bearer ${input.adminToken}`;
  let res: Response;
  try {
    res = await fetch(LICENSE_PATHS.adminUpload, {
      method: "POST",
      headers,
      body: JSON.stringify({ license: input.license }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 403) return { kind: "forbidden" };

  if (!res.ok) {
    const env = await readErrorEnvelope(res);
    if (isUploadFailure(env.error)) {
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
  const view = projectLicenseStatus(raw as Record<string, unknown>);
  if (!view) return { kind: "error", status: res.status };
  return { kind: "ok", status: view };
}
