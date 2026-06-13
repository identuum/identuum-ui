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
  organizationName: string;
  organizationDomain: string;
  adminEmail: string;
  adminPassword: string;
}

export interface CompleteSetupBody {
  state: "setup_complete";
  organizationId: string;
  organizationName: string;
  adminEmail: string;
}

export type CompleteSetupResult =
  | { kind: "ok"; result: CompleteSetupBody }
  | { kind: "bad_token" }
  | { kind: "already_complete" }
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
        organization_name: input.organizationName,
        organization_domain: input.organizationDomain,
        admin_email: input.adminEmail,
        admin_password: input.adminPassword,
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
      // so it is safe to surface as a hint.
      let message = "Setup request was rejected";
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string" && body.error) {
          message = body.error.replace(/_/g, " ");
        }
      } catch {
        // ignore
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

  return {
    kind: "ok",
    result: {
      state: "setup_complete",
      organizationId: typeof body.organization_id === "string" ? body.organization_id : "",
      organizationName: typeof body.organization_name === "string" ? body.organization_name : "",
      adminEmail: typeof body.admin_email === "string" ? body.admin_email : "",
    },
  };
}
