"use server";

/**
 * Server actions for /site-admin/org-link/readiness.
 *
 * Currently scoped to a single action: executeOrganizationImportAction,
 * which performs an organization-only AG create-or-link operation for
 * exactly one IDP candidate per invocation.
 *
 * SCOPE GUARANTEES — organization-only:
 *   - Never copies users, org_admins, passwords, MFA state, role bindings,
 *     reviewers, auditors, sessions, tokens, license fields, signatures, or
 *     ciphertext.
 *   - The action accepts only a small allowlist of FormData fields. Any
 *     other field — including known sensitive names — is ignored at the
 *     parser level, and a defensive check rejects the request with
 *     forbidden_field if a known-sensitive name was present at all.
 *   - The action does NOT accept a raw JSON blob: each field is read by
 *     name from FormData. There is no JSON.parse on client-supplied input.
 *   - The action requires confirm_scope === "organization_only". A missing
 *     or wrong value yields confirmation_missing.
 *   - Bulk execution is not supported here. The action takes one IDP org +
 *     optional one AG org and calls the execute client exactly once.
 *
 * Security:
 *   - Server-only ("use server"); browser code cannot import this module.
 *   - Internal AG backend URLs, session cookies, and bearer tokens never
 *     reach the browser. The execute client owns all of that.
 *   - Raw backend error bodies are never returned to the page; only the
 *     safe discriminated reason string from OrgImportExecuteResult.
 *   - On success, the action revalidates the readiness path so the dry-run
 *     preview reflects the new linked/created state on the next render.
 */

import { executeImportIDPOrganizationToAG } from "@/lib/org-import-execute-client";
import type { OrgImportExecuteResult, OrganizationExportCandidate } from "@/lib/types";
import { revalidatePath } from "next/cache";

const READINESS_PATH = "/site-admin/org-link/readiness";

/**
 * Fields the action reads from FormData. Every other field name is ignored
 * at the parser level (we never iterate FormData keys). The defensive
 * forbidden-field check below adds a second layer for known-sensitive names.
 *
 * Required:
 *   - confirm_scope (must equal "organization_only")
 *   - idp_id
 *   - idp_name
 *   - idp_source_component (must equal "identuum-idp")
 *
 * Optional:
 *   - idp_slug
 *   - idp_status
 *   - idp_created_at
 *   - idp_updated_at
 *   - ag_organization_id (when linking an existing AG org)
 */
const ALLOWED_FORM_FIELDS = [
  "confirm_scope",
  "idp_id",
  "idp_name",
  "idp_slug",
  "idp_status",
  "idp_created_at",
  "idp_updated_at",
  "idp_source_component",
  "ag_organization_id",
] as const;

type AllowedFormField = (typeof ALLOWED_FORM_FIELDS)[number];

/**
 * Field names that must never appear in the FormData. If a client tampers
 * with the form to attempt smuggling user/admin/role/credential data into
 * the server action, the action rejects with invalid_request before any
 * backend call.
 *
 * The forbidden list is intentionally redundant with the allowlist read
 * pattern above — both layers must agree before the action proceeds.
 */
const FORBIDDEN_FORM_FIELDS = [
  "users",
  "user_count",
  "admins",
  "org_admins",
  "emails",
  "email",
  "password",
  "passwords",
  "mfa",
  "mfa_secret",
  "totp",
  "totp_secret",
  "role_bindings",
  "roles",
  "reviewers",
  "auditors",
  "sessions",
  "session",
  "tokens",
  "token",
  "license",
  "license_id",
  "signature",
  "ciphertext",
  "private_key",
  "raw_payload",
  "metadata",
  "audit",
  "raw_json",
  "json",
];

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * executeOrganizationImportAction performs one organization-only AG
 * create-or-link operation against the AG import-from-idp endpoint with
 * dry_run=false.
 *
 * Returns a safe discriminated result. The caller (a form submitted from
 * /site-admin/org-link/readiness) renders the message/status text directly;
 * no raw backend body is exposed.
 *
 * One mutation per call. Bulk execution is not supported.
 */
export async function executeOrganizationImportAction(
  formData: FormData
): Promise<OrgImportExecuteResult> {
  // Defensive forbidden-field rejection. If a tampered client smuggled any
  // known-sensitive field name into the form, refuse early — even though the
  // allowlist-read pattern below would silently drop it. This makes the
  // refusal explicit in logs and tests.
  for (const fk of FORBIDDEN_FORM_FIELDS) {
    if (formData.has(fk)) {
      return { ok: false, reason: "invalid_request" };
    }
  }

  // Defensive: the action does not accept a raw JSON blob — there is no
  // JSON.parse on client-supplied data. Even if a client wrote one, the
  // FORBIDDEN_FORM_FIELDS guard above already rejects "raw_json" and "json".

  const confirm = readFormString(formData, "confirm_scope");
  if (confirm !== "organization_only") {
    return { ok: false, reason: "confirmation_missing" };
  }

  const idpID = readFormString(formData, "idp_id");
  if (idpID === "" || !isUUID(idpID)) {
    return { ok: false, reason: "invalid_request" };
  }

  const idpName = readFormString(formData, "idp_name").trim();
  if (idpName === "") {
    return { ok: false, reason: "invalid_request" };
  }

  const sourceComponent = readFormString(formData, "idp_source_component");
  if (sourceComponent !== "identuum-idp") {
    return { ok: false, reason: "invalid_request" };
  }

  const agOrgID = readFormString(formData, "ag_organization_id").trim();
  if (agOrgID !== "" && !isUUID(agOrgID)) {
    return { ok: false, reason: "invalid_request" };
  }

  const candidate: OrganizationExportCandidate = {
    id: idpID,
    name: idpName,
    slug: readFormString(formData, "idp_slug"),
    status: readFormString(formData, "idp_status"),
    created_at: emptyToNull(readFormString(formData, "idp_created_at")),
    updated_at: emptyToNull(readFormString(formData, "idp_updated_at")),
    source_component: "identuum-idp",
  };

  // Exactly one backend call per server-action invocation.
  const result = await executeImportIDPOrganizationToAG({
    idpOrganization: candidate,
    agOrganizationId: agOrgID === "" ? undefined : agOrgID,
  });

  if (result.ok) {
    // Refresh the readiness page so the dry-run preview reflects the new
    // linked/created state on the next render. revalidatePath is a no-op
    // when called outside the request context, so we ignore any error.
    try {
      revalidatePath(READINESS_PATH);
    } catch {
      // ignore — revalidate failure does not invalidate the executed mutation
    }
  }

  return result;
}

/** Reads a single named string field from FormData, defaulting to "". */
function readFormString(form: FormData, key: AllowedFormField): string {
  const v = form.get(key);
  if (typeof v === "string") return v;
  return "";
}

function emptyToNull(s: string): string | null {
  return s === "" ? null : s;
}

// Note: ALLOWED_FORM_FIELDS / FORBIDDEN_FORM_FIELDS are module-private. They
// cannot be exported from a "use server" file (which restricts exports to
// async functions). Tests inspect the file source directly to assert the
// arrays remain free of sensitive field names.

/**
 * Form-compatible thin wrapper around executeOrganizationImportAction.
 *
 * Next.js form actions must have signature (formData: FormData) => void |
 * Promise<void>. This wrapper invokes the typed action and discards its
 * result so the same business logic can be bound to a server-component
 * <form action={...}>. After a successful mutation the typed action
 * already revalidates the readiness path, so the next render shows the
 * updated state.
 *
 * This wrapper does NOT widen the action's safety contract: it forwards
 * FormData unchanged. All confirmation, allowlist, forbidden-field, and
 * dry_run=false guarantees live in executeOrganizationImportAction.
 */
export async function executeOrganizationImportFormAction(formData: FormData): Promise<void> {
  await executeOrganizationImportAction(formData);
}
