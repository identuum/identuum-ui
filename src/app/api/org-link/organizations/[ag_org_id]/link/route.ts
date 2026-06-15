/**
 * /api/org-link/organizations/[ag_org_id]/link
 *
 * UI proxy routes for AG org-link write operations.
 *
 * PUT  — link an AG org to an IDP org (body: { idp_org_id })
 * DELETE — unlink an AG org from its current IDP org
 *
 * Security:
 *   - Validates inputs server-side before forwarding to AG.
 *   - Never exposes internal AG backend URL in response.
 *   - Strips any unexpected fields from AG response before returning to browser.
 *   - Requires an active AG operator session (ag_access_token cookie).
 *   - Organization-only: never writes users, admins, credentials, MFA, or roles.
 */
import {
  isValidUUID,
  linkAGOrganizationToIDPOrg,
  unlinkAGOrganizationFromIDPOrg,
} from "@/lib/ag-org-link-write-client";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ag_org_id: string }> };

export async function PUT(req: NextRequest, { params }: Params): Promise<Response> {
  const { ag_org_id } = await params;

  if (!isValidUUID(ag_org_id)) {
    return NextResponse.json(
      { ok: false, error_code: "invalid_request", message: "Invalid ag_org_id." },
      { status: 400 }
    );
  }

  let idpOrgId: string;
  try {
    const body = (await req.json()) as { idp_org_id?: unknown };
    if (typeof body.idp_org_id !== "string" || !isValidUUID(body.idp_org_id)) {
      return NextResponse.json(
        { ok: false, error_code: "invalid_request", message: "idp_org_id must be a valid UUID." },
        { status: 400 }
      );
    }
    idpOrgId = body.idp_org_id;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error_code: "invalid_request",
        message: "Request body is missing or malformed.",
      },
      { status: 400 }
    );
  }

  const result = await linkAGOrganizationToIDPOrg(ag_org_id, idpOrgId);
  const status = result.ok ? 200 : errorCodeToStatus(result.error_code ?? "write_failed");
  return NextResponse.json(result, { status });
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<Response> {
  const { ag_org_id } = await params;

  if (!isValidUUID(ag_org_id)) {
    return NextResponse.json(
      { ok: false, error_code: "invalid_request", message: "Invalid ag_org_id." },
      { status: 400 }
    );
  }

  const result = await unlinkAGOrganizationFromIDPOrg(ag_org_id);
  const status = result.ok ? 200 : errorCodeToStatus(result.error_code ?? "write_failed");
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
    case "org_not_found":
      return 404;
    case "idp_org_already_linked":
      return 409;
    case "not_configured":
    case "ag_unavailable":
      return 503;
    default:
      return 500;
  }
}
