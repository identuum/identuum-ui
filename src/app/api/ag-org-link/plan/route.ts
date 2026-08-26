/**
 * GET /api/ag-org-link/plan
 *
 * UI proxy for the AG OSS read-only org-link plan summary (AG-31).
 *
 * Distinct from the existing /api/org-link/plan which composes IDP+AG
 * monolith-shape responses; this route surfaces the AG OSS-shape plan
 * (total / linked_count / unlinked_count + organizations) without IDP
 * cross-composition.
 *
 * Security:
 *   - Operator-cookie auth is forwarded server-side as Bearer; the browser
 *     never sees the token.
 *   - Internal AG backend URLs are never returned.
 *   - 401/403/unreachable are mapped to UI-safe status codes — raw AG
 *     errors and HTTP details are not forwarded.
 */

import { NextResponse } from "next/server";
import { fetchAGOrgLinkPlanOSS } from "@/lib/ag-org-link-plan-oss-client";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const result = await fetchAGOrgLinkPlanOSS();

  switch (result.status) {
    case "ok":
      return NextResponse.json(
        {
          status: "ok",
          plan: result.plan,
        },
        { status: 200 }
      );
    case "not_configured":
      return NextResponse.json({ status: "not_configured" }, { status: 200 });
    case "ag_auth_required":
      return NextResponse.json({ status: "ag_auth_required" }, { status: 401 });
    case "ag_forbidden":
      return NextResponse.json({ status: "ag_forbidden" }, { status: 403 });
    case "ag_unavailable":
      return NextResponse.json({ status: "ag_unavailable" }, { status: 503 });
    case "error":
      return NextResponse.json({ status: "error" }, { status: 502 });
  }
}
