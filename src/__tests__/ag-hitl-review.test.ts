/**
 * Tests for the HITL/CBAA review workflow.
 *
 * Covers queue page (intervention_id + review link) and the review detail
 * page (approve/deny, ACR error handling, request_payload exclusion).
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const queuePage = readFile("src/app/ag-admin/(authed)/hitl/page.tsx");
const reviewPage = readFile("src/app/ag-admin/(authed)/hitl/[id]/page.tsx");

// ── Queue page — review links ────────────────────────────────────────────────

describe("HITL queue page — review links", () => {
  it("includes intervention_id in HeldRequest interface", () => {
    expect(queuePage).toContain("intervention_id");
  });

  it("maps intervention_id from backend response", () => {
    expect(queuePage).toContain("r.intervention_id");
  });

  it("each row with intervention_id links to /ag-admin/hitl/:id", () => {
    expect(queuePage).toContain("/ag-admin/hitl/${item.intervention_id}");
    expect(queuePage).toContain("Review →");
  });

  it("session link still present per row", () => {
    expect(queuePage).toContain("Session →");
    expect(queuePage).toContain("/ag-admin/sessions/${item.agent_session_id}");
  });

  it("request_payload still not mapped", () => {
    expect(queuePage).toContain("request_payload intentionally not mapped");
    expect(queuePage).not.toContain("{r.request_payload}");
  });
});

// ── Review page — structure ───────────────────────────────────────────────────

describe("HITL review page — data source", () => {
  it("fetches from /admin/hitl/:id detail endpoint directly", () => {
    expect(reviewPage).toContain("/admin/hitl/${encodeURIComponent(interventionId)}");
    expect(reviewPage).toContain("fetchItem");
  });

  it("does NOT use the queue+filter workaround for the detail view", () => {
    expect(reviewPage).not.toContain("fetchQueueItem");
    expect(reviewPage).not.toContain("/admin/hitl/queue?limit=");
  });

  it("maps 404 from detail endpoint to not_found state", () => {
    expect(reviewPage).toContain("res.status === 404");
    expect(reviewPage).toContain("not_found");
  });

  it("parses backend held_request envelope correctly", () => {
    expect(reviewPage).toContain("held_request");
    expect(reviewPage).toContain("raw.success");
  });
});

describe("HITL review page — structure", () => {
  it("page title says 'Review HITL / CBAA request'", () => {
    expect(reviewPage).toContain("Review HITL / CBAA request");
  });

  it("metadata title set correctly", () => {
    expect(reviewPage).toContain("Review Intervention — Identuum AG");
  });

  it("is force-dynamic", () => {
    expect(reviewPage).toContain('export const dynamic = "force-dynamic"');
  });

  it("redirects to login on auth error", () => {
    expect(reviewPage).toContain("auth_error");
    expect(reviewPage).toContain('redirect("/ag-admin/login")');
  });

  it("back link to /ag-admin/hitl queue", () => {
    expect(reviewPage).toContain("← HITL / CBAA Queue");
    expect(reviewPage).toContain('href="/ag-admin/hitl"');
  });
});

// ── Review page — safe fields ─────────────────────────────────────────────────

describe("HITL review page — safe fields rendered", () => {
  it("renders gate_state badge", () => {
    expect(reviewPage).toContain("item.gate_state");
    expect(reviewPage).toContain("GATE_STATE_STYLES");
  });

  it("renders intervention ID", () => {
    expect(reviewPage).toContain("Intervention ID");
    expect(reviewPage).toContain("item.intervention_id");
  });

  it("links to agent session detail page", () => {
    expect(reviewPage).toContain("/ag-admin/sessions/${item.agent_session_id}");
    expect(reviewPage).toContain("item.agent_session_id");
  });

  it("shows pending_since and expires timestamps", () => {
    expect(reviewPage).toContain("item.pending_since");
    expect(reviewPage).toContain("item.expires_at");
  });

  it("shows decided_at when present", () => {
    expect(reviewPage).toContain("item.decided_at");
  });
});

// ── Review page — request_payload exclusion ───────────────────────────────────

describe("HITL review page — request_payload exclusion", () => {
  it("request_payload is never fetched or rendered", () => {
    expect(reviewPage).not.toContain("request_payload:");
    expect(reviewPage).not.toContain("{r.request_payload}");
    expect(reviewPage).not.toContain("{item.request_payload}");
  });

  it("shows operator notice that tool payload is intentionally excluded", () => {
    expect(reviewPage).toContain("Tool input payload is intentionally not displayed");
    expect(reviewPage).toContain("sensitive data");
  });
});

// ── Review page — approve/deny controls ──────────────────────────────────────

describe("HITL review page — approve/deny actions", () => {
  it("approve action calls /admin/hitl/:id/approve via agRequest POST", () => {
    expect(reviewPage).toContain("/admin/hitl/${encodeURIComponent(id)}/approve");
    expect(reviewPage).toContain('method: "POST"');
  });

  it("deny action calls /admin/hitl/:id/deny via agRequest POST", () => {
    expect(reviewPage).toContain("/admin/hitl/${encodeURIComponent(id)}/deny");
  });

  it("deny action requires reason from form data", () => {
    expect(reviewPage).toContain('formData.get("reason")');
    expect(reviewPage).toContain("reason_required");
  });

  it("deny reason has max length validation", () => {
    expect(reviewPage).toContain("reason_too_long");
    expect(reviewPage).toContain("1024");
  });

  it("deny textarea has maxLength and required attributes", () => {
    expect(reviewPage).toContain('maxLength={1024}');
    expect(reviewPage).toContain("required");
    expect(reviewPage).toContain('name="reason"');
  });

  it("approve/deny controls only shown for pending non-expired items", () => {
    expect(reviewPage).toContain("isPending && !isExpired");
  });

  it("non-pending state shows informational message, not action buttons", () => {
    expect(reviewPage).toContain("cannot be reviewed");
    expect(reviewPage).toContain("has expired and can no longer");
  });
});

// ── Review page — ACR/freshness error handling ────────────────────────────────

describe("HITL review page — ACR and freshness errors", () => {
  it("maps 403 ACR insufficient to acr_required error code", () => {
    expect(reviewPage).toContain("Reviewer ACR insufficient");
    expect(reviewPage).toContain("acr_required");
  });

  it("maps 403 auth too old to auth_too_old error code", () => {
    expect(reviewPage).toContain("Reviewer authentication too old");
    expect(reviewPage).toContain("auth_too_old");
  });

  it("shows re-authentication message for ACR/freshness errors", () => {
    expect(reviewPage).toContain("Stronger authentication is required");
    expect(reviewPage).toContain("re-authenticate");
  });

  it("maps 409 conflict to already_decided", () => {
    expect(reviewPage).toContain("already_decided");
    expect(reviewPage).toContain("already been decided");
  });

  it("maps 404 to not_found error code", () => {
    expect(reviewPage).toContain("not_found");
  });

  it("does not expose raw backend error messages to browser", () => {
    // Raw error strings from backend not forwarded to client — only mapped codes via searchParams
    expect(reviewPage).not.toContain("console.error");
    // JSON.stringify is used for request bodies only, not for forwarding backend errors
    // Verify raw backend error text is not inserted into rendered JSX directly
    expect(reviewPage).not.toContain("{backendError}");
    expect(reviewPage).not.toContain("rawError");
  });
});

// ── Review page — success and redirect ───────────────────────────────────────

describe("HITL review page — success states", () => {
  it("approve success redirects to /ag-admin/hitl?reviewed=approved", () => {
    expect(reviewPage).toContain("reviewed=approved");
  });

  it("deny success redirects to /ag-admin/hitl?reviewed=denied", () => {
    expect(reviewPage).toContain("reviewed=denied");
  });

  it("success state shows decision and back link", () => {
    expect(reviewPage).toContain("reviewedDecision");
    // Template string renders to "approved/denied successfully" at runtime
    expect(reviewPage).toContain('successfully.');
    expect(reviewPage).toContain("Back to queue →");
  });
});

// ── Review page — fallback states ────────────────────────────────────────────

describe("HITL review page — fallback states", () => {
  it("not-found shows safe not-found state", () => {
    expect(reviewPage).toContain("not_found");
    expect(reviewPage).toContain("NotFoundState");
    expect(reviewPage).toContain("Intervention not found");
  });

  it("unavailable state renders safely", () => {
    expect(reviewPage).toContain("UnavailableState");
    expect(reviewPage).toContain("Intervention detail unavailable");
  });
});

// ── Review page — security ───────────────────────────────────────────────────

describe("HITL review page — security", () => {
  it("uses agRequest server-side (token never in browser)", () => {
    expect(reviewPage).toContain("agRequest");
    expect(reviewPage).not.toContain("document.cookie");
    expect(reviewPage).not.toContain("localStorage");
  });

  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(reviewPage).not.toContain(forbidden);
    }
  });

  it("server actions use 'use server' directive", () => {
    expect(reviewPage).toContain('"use server"');
  });
});

// ── Login sidebar-free invariant ─────────────────────────────────────────────

describe("login page — sidebar-free invariant", () => {
  it("/ag-admin/login layout has no sidebar", () => {
    const loginLayout = readFile("src/app/ag-admin/login/layout.tsx");
    expect(loginLayout).not.toContain("AgAdminNav");
    expect(loginLayout).not.toContain("<aside");
  });
});
