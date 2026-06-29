/**
 * idp-setup-client.ts — client/server helpers for the appliance
 * first-run setup APIs exposed by `identuum-idp-oss` at
 * `/api/setup/*`. All calls flow through the existing same-origin
 * `/api/idp/...` proxy, so no IDP base URL is ever exposed to browser
 * code (per the standard idp-client.ts invariant).
 *
 * Discriminated-union results mirror `idp-client.ts`: each function
 * returns a tagged outcome rather than throwing, so the wizard can
 * render branch-specific messages without try/catch noise.
 *
 * Setup APIs are pre-completion only — they live OUTSIDE `/api/v1/`
 * deliberately. After `setup_complete`, the verify-token and complete
 * endpoints respond `410 Gone` (mapped to `already_complete` here).
 *
 * The wizard form passes the admin password into `completeSetup` as
 * plaintext; the backend argon2id-hashes it on insert. We do not
 * persist, log, or echo the password from the client.
 */

const SETUP_PATHS = {
  status: "/api/idp/api/setup/status",
  verifyToken: "/api/idp/api/setup/verify-token",
  complete: "/api/idp/api/setup/complete",
} as const;

export interface SetupStatusBody {
  state: "setup_required" | "setup_complete";
  setupComplete: boolean;
  setupTokenRequired: boolean;
  product: string;
  distribution: string;
  issuer?: string;
  firstSigningKeyExists: boolean;
  siteAdminExists: boolean;
  firstOrganizationExists: boolean;
  nextAction: string;
}

export type SetupStatusResult =
  | { kind: "ok"; status: SetupStatusBody }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export type VerifySetupTokenResult =
  | { kind: "ok" }
  | { kind: "bad_token" }
  | { kind: "already_complete" }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

export interface CompleteSetupInput {
  setupToken: string;
  /**
   * createTenantOrg controls whether the wizard creates a first
   * customer/tenant organization during setup. Default is FALSE
   * (site-admin-only bootstrap). When false the `organizationName`
   * and `organizationDomain` fields are ignored by the IDP, so the
   * caller MAY leave them as empty strings.
   *
   * The hidden System Organization sentinel row exists independently
   * of this choice — it is infrastructure data seeded by the IDP at
   * boot and is never surfaced by /api/v1/organizations.
   */
  createTenantOrg: boolean;
  organizationName: string;
  organizationDomain: string;
  adminEmail: string;
  adminPassword: string;
  /**
   * D-IDP-INSTALL-26. The wizard MUST drive `/api/setup/mfa/initiate`
   * + `/api/setup/mfa/verify` BEFORE submitting Complete, and thread
   * the resulting session id + the verified 6-digit code through
   * these fields. Empty values trigger a server-side
   * `mfa_enrollment_required` 400 — handled here as
   * `kind: "mfa_required"`. agent-a-20260627-idp-ce-setup-wizard-site-admin-totp-enrollment-implementation.
   */
  adminMFASessionId: string;
  adminMFACode: string;
}

export interface CompleteSetupBody {
  state: "setup_complete";
  /**
   * createTenantOrg echoes the request flag back so the UI's success
   * screen can render an honest "no tenant org yet" hint when the
   * operator opted into site-admin-only bootstrap.
   */
  createTenantOrg: boolean;
  /**
   * Tenant org fields are empty strings when `createTenantOrg=false`.
   * The IDP emits them as JSON-omitempty; the projection here
   * defaults to "" so callers can `.organizationId.length > 0`-check
   * without a separate union type.
   */
  organizationId: string;
  organizationName: string;
  adminEmail: string;
  /**
   * D-IDP-INSTALL-26 recovery codes. The IDP returns the verified
   * site_admin's recovery codes ONCE in the Complete response so the
   * wizard's success screen can render them; the codes never come back
   * from the IDP again. Empty array on an older IDP that does not
   * implement D-IDP-INSTALL-26 (forward-compat). agent-a-20260627-idp-ce-setup-wizard-site-admin-totp-enrollment-implementation.
   */
  recoveryCodes: string[];
}

export type CompleteSetupResult =
  | { kind: "ok"; result: CompleteSetupBody }
  | { kind: "bad_token" }
  | { kind: "already_complete" }
  | { kind: "mfa_required" }
  | { kind: "mfa_session_invalid" }
  | { kind: "mfa_code_invalid" }
  | { kind: "invalid"; message: string }
  | { kind: "unreachable" }
  | { kind: "error"; status: number };

function projectStatus(body: Record<string, unknown>): SetupStatusBody | null {
  const state = body.state;
  if (state !== "setup_required" && state !== "setup_complete") return null;
  return {
    state,
    setupComplete: body.setup_complete === true,
    setupTokenRequired: body.setup_token_required === true,
    product: typeof body.product === "string" ? body.product : "",
    distribution: typeof body.distribution === "string" ? body.distribution : "",
    issuer: typeof body.issuer === "string" ? body.issuer : undefined,
    firstSigningKeyExists: body.first_signing_key_exists === true,
    siteAdminExists: body.site_admin_exists === true,
    firstOrganizationExists: body.first_organization_exists === true,
    nextAction: typeof body.next_action === "string" ? body.next_action : "",
  };
}

export async function getSetupStatus(): Promise<SetupStatusResult> {
  let res: Response;
  try {
    res = await fetch(SETUP_PATHS.status, {
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

export async function verifySetupToken(token: string): Promise<VerifySetupTokenResult> {
  let res: Response;
  try {
    res = await fetch(SETUP_PATHS.verifyToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_token: token }),
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (res.status === 204) return { kind: "ok" };
  if (res.status === 401) return { kind: "bad_token" };
  if (res.status === 410) return { kind: "already_complete" };
  return { kind: "error", status: res.status };
}

export async function completeSetup(input: CompleteSetupInput): Promise<CompleteSetupResult> {
  let res: Response;
  try {
    res = await fetch(SETUP_PATHS.complete, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setup_token: input.setupToken,
        create_tenant_org: input.createTenantOrg,
        // The IDP ignores organization_name / organization_domain when
        // create_tenant_org is false, so we forward whatever the form
        // captured rather than wiping it. The site-admin-only path
        // typically sends them as empty strings.
        organization_name: input.organizationName,
        organization_domain: input.organizationDomain,
        admin_email: input.adminEmail,
        admin_password: input.adminPassword,
        // D-IDP-INSTALL-26 fields. The server requires both; an empty
        // value triggers mfa_enrollment_required. The wizard MUST have
        // already driven the initiate + verify pair before reaching
        // this call.
        admin_mfa_session_id: input.adminMFASessionId,
        admin_mfa_code: input.adminMFACode,
      }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (res.status === 401) return { kind: "bad_token" };
  if (res.status === 410) return { kind: "already_complete" };

  if (!res.ok) {
    if (res.status === 400) {
      // Backend returns { error: "..." } on validation failures. The
      // message is a stable code string, not user-supplied content,
      // so it is safe to surface as a hint. D-IDP-INSTALL-26 codes
      // get routed to distinct variants so the wizard can re-arm the
      // MFA enrollment step instead of showing a generic invalid
      // message.
      let message = "Setup request was rejected";
      let code = "";
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string" && body.error) {
          code = body.error;
          message = body.error.replace(/_/g, " ");
        }
      } catch {
        // ignore
      }
      if (code === "mfa_enrollment_required" || code === "mfa_not_verified") {
        return { kind: "mfa_required" };
      }
      if (code === "mfa_session_invalid" || code === "mfa_email_mismatch") {
        return { kind: "mfa_session_invalid" };
      }
      if (code === "mfa_code_invalid") {
        return { kind: "mfa_code_invalid" };
      }
      return { kind: "invalid", message };
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
  const body = raw as Record<string, unknown>;
  if (body.state !== "setup_complete") return { kind: "error", status: res.status };

  const rawRecovery = body.recovery_codes;
  const recoveryCodes = Array.isArray(rawRecovery)
    ? rawRecovery.filter((c): c is string => typeof c === "string")
    : [];
  return {
    kind: "ok",
    result: {
      state: "setup_complete",
      createTenantOrg: body.create_tenant_org === true,
      organizationId: typeof body.organization_id === "string" ? body.organization_id : "",
      organizationName: typeof body.organization_name === "string" ? body.organization_name : "",
      adminEmail: typeof body.admin_email === "string" ? body.admin_email : "",
      recoveryCodes,
    },
  };
}
