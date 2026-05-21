/**
 * Tests for session revocation actions.
 *
 * Backend: POST /admin/revocations with kind=session, agent_session_id, reason (required).
 * Active sessions can be revoked; expired/revoked sessions cannot.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const page = readFile("src/app/ag-admin/(authed)/sessions/[id]/page.tsx");

// ── Page structure ────────────────────────────────────────────────────────────

describe("session detail — revocation structure", () => {
  it("page accepts searchParams for confirm_revoke and revoke_error", () => {
    expect(page).toContain("searchParams");
    expect(page).toContain("confirm_revoke");
    expect(page).toContain("revoke_error");
  });

  it("revokeSession server action defined with 'use server'", () => {
    expect(page).toContain("revokeSession");
    expect(page).toContain('"use server"');
  });

  it("revocation calls POST /admin/revocations with kind=session", () => {
    expect(page).toContain('method: "POST"');
    expect(page).toContain("/admin/revocations");
    expect(page).toContain('kind: "session"');
    expect(page).toContain("agent_session_id: id");
  });

  it("revocation sends reason from form data", () => {
    expect(page).toContain('formData.get("reason")');
    expect(page).toContain("reason");
  });

  it("success redirects back to session detail", () => {
    expect(page).toContain("/ag-admin/sessions/${id}`");
  });

  it("auth failure redirects to login", () => {
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("backend failures redirect with revoke_error param", () => {
    expect(page).toContain("revoke_error=failed");
    expect(page).toContain("revoke_error=unavailable");
    expect(page).toContain("revoke_error=already_revoked");
    expect(page).toContain("revoke_error=not_found");
  });
});

// ── Revoke button ─────────────────────────────────────────────────────────────

describe("session detail — revoke button", () => {
  it("active session renders Revoke session link to confirm URL", () => {
    expect(page).toContain("Revoke session");
    expect(page).toContain("confirm_revoke=1");
  });

  it("revoke button only shown when session is revocable (active status)", () => {
    expect(page).toContain("isRevocable");
    expect(page).toContain('status === "active"');
  });

  it("non-active sessions show read-only or revoked badge, not revoke button", () => {
    // Revoked/expired sessions show a status badge, not the Revoke link
    expect(page).toContain('status === "revoked" ? "Revoked" : "Read-only"');
  });

  it("no bulk revoke action exists", () => {
    expect(page).not.toContain("bulk");
    expect(page).not.toContain("Revoke all");
    expect(page).not.toContain("revoke_all");
  });
});

// ── Confirmation card ─────────────────────────────────────────────────────────

describe("session detail — revocation confirmation card", () => {
  it("confirmation card appears when confirm_revoke=1 and session is revocable", () => {
    expect(page).toContain("confirmRevoke && isRevocable");
    expect(page).toContain("Confirm: Revoke session");
  });

  it("confirmation explains invalidation of agent token", () => {
    expect(page).toContain("immediately invalidates the agent token");
    expect(page).toContain("governed requests");
  });

  it("confirmation mentions HITL items not automatically resolved", () => {
    expect(page).toContain("HITL");
    expect(page).toContain("not automatically resolved");
  });

  it("reason textarea is present and required", () => {
    expect(page).toContain('name="reason"');
    expect(page).toContain("required");
    expect(page).toContain("maxLength={1024}");
  });

  it("confirmation has Confirm revocation submit button", () => {
    expect(page).toContain("action={revokeSession}");
    expect(page).toContain("Confirm revocation");
  });

  it("confirmation has Cancel link back to detail without confirm param", () => {
    expect(page).toContain("Cancel");
    expect(page).toContain("/ag-admin/sessions/${s.id}`");
  });
});

// ── Error display ─────────────────────────────────────────────────────────────

describe("session detail — revocation error display", () => {
  it("error notice renders when revoke_error param is set", () => {
    expect(page).toContain("revokeError");
    expect(page).toContain("Revocation failed");
    expect(page).toContain("REVOKE_ERROR_MESSAGES");
  });

  it("already_revoked error mapped to safe message", () => {
    expect(page).toContain("already_revoked");
    expect(page).toContain("already been revoked");
  });

  it("reason_required error shown inline in confirmation form", () => {
    expect(page).toContain("reason_required");
    expect(page).toContain("A reason is required");
  });

  it("raw backend error bodies not rendered", () => {
    expect(page).not.toContain("{rawError}");
    expect(page).not.toContain("backendMessage");
  });
});

// ── Existing sections preserved ───────────────────────────────────────────────

describe("session detail — existing sections preserved", () => {
  it("session identity section remains", () => {
    expect(page).toContain("Session Identity");
    expect(page).toContain("s.id");
    expect(page).toContain("s.agent_id");
  });

  it("task and capabilities section remains", () => {
    expect(page).toContain("Task & Capabilities");
    expect(page).toContain("s.intent");
    expect(page).toContain("s.allowed_tools");
  });

  it("lifecycle section remains", () => {
    expect(page).toContain("Lifecycle");
    expect(page).toContain("s.expires_at");
    expect(page).toContain("s.revoked_at");
  });

  it("long intent protection remains (line-clamp)", () => {
    expect(page).toContain("line-clamp-3");
  });
});

// ── Security ──────────────────────────────────────────────────────────────────

describe("session detail — security", () => {
  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("bearer token handled server-side by agRequest", () => {
    expect(page).toContain("agRequest");
    expect(page).not.toContain("document.cookie");
  });

  it("request_payload/tool inputs not rendered", () => {
    expect(page).not.toContain("request_payload");
    expect(page).not.toContain("tool_input");
  });
});

// ── Login sidebar-free ────────────────────────────────────────────────────────

describe("login page — sidebar-free invariant", () => {
  it("/ag-admin/login layout has no sidebar", () => {
    const loginLayout = readFile("src/app/ag-admin/login/layout.tsx");
    expect(loginLayout).not.toContain("AgAdminNav");
    expect(loginLayout).not.toContain("<aside");
  });
});
