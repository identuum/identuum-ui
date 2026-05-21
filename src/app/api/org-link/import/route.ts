/**
 * POST /api/org-link/import
 *
 * UI proxy route for AG org-link import (create + link) operation.
 * Creates a new AG organization linked to an IDP organization ID.
 *
 * Security:
 *   - Validates inputs server-side before forwarding to AG.
 *   - Never exposes internal AG backend URL in response.
 *   - Strips any unexpected fields from AG response before returning to browser.
 *   - Requires an active AG operator session (ag_access_token cookie).
 *   - Organization-only: never creates users, admins, credentials, MFA, or roles.
 */
import {
  importAGOrganization,
  isValidUUID,
} from "@/lib/ag-org-link-write-client";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  let idpOrgId: string;
  let name: string;
  let displayName: string | undefined;

  try {
    const body = (await req.json()) as {
      idp_org_id?: unknown;
      name?: unknown;
      display_name?: unknown;
    };

    if (typeof body.idp_org_id !== "string" || !isValidUUID(body.idp_org_id)) {
      return NextResponse.json(
        { ok: false, error_code: "invalid_request", message: "idp_org_id must be a valid UUID." },
        { status: 400 }
      );
    }

    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { ok: false, error_code: "invalid_request", message: "name must be a non-empty string." },
        { status: 400 }
      );
    }

    idpOrgId = body.idp_org_id;
    name = body.name.trim();
    displayName = typeof body.display_name === "string" && body.display_name.trim()
      ? body.display_name.trim()
      : undefined;
  } catch {
    return NextResponse.json(
      { ok: false, error_code: "invalid_request", message: "Request body is missing or malformed." },
      { status: 400 }
    );
  }

  const result = await importAGOrganization(idpOrgId, name, displayName);
  const status = result.ok ? 201 : errorCodeToStatus(result.error_code ?? "write_failed");
  return NextResponse.json(result, { status });
}

function errorCodeToStatus(code: string): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "ag_auth_required":
      return 401;
    case "ag_forbidden":
    case "system_org_not_allowed":
      return 403;
    case "idp_org_already_linked":
    case "org_name_already_exists":
      return 409;
    case "not_configured":
    case "ag_unavailable":
      return 503;
    default:
      return 500;
  }
}
