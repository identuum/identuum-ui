/**
 * Tests for Agent Registry lifecycle actions (enable/disable).
 *
 * The PATCH /admin/agent-registry/:id endpoint supports enabled *bool.
 * Enable: no confirmation needed (non-destructive).
 * Disable: requires explicit confirmation UI (prevents new sessions).
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const page = readFile("src/app/ag-admin/(authed)/agents/[id]/page.tsx");

// ── Page structure ────────────────────────────────────────────────────────────

describe("agent detail — lifecycle actions structure", () => {
  it("page accepts searchParams for confirm_disable and lifecycle_error", () => {
    expect(page).toContain("searchParams");
    expect(page).toContain("confirm_disable");
    expect(page).toContain("lifecycle_error");
  });

  it("enableAgent and disableAgent server actions defined", () => {
    expect(page).toContain("enableAgent");
    expect(page).toContain("disableAgent");
    expect(page).toContain('"use server"');
  });

  it("both actions call PATCH on /admin/agent-registry/:id", () => {
    expect(page).toContain('method: "PATCH"');
    expect(page).toContain("/admin/agent-registry/");
  });

  it("enableAgent sends enabled: true", () => {
    expect(page).toContain("enabled: true");
  });

  it("disableAgent sends enabled: false", () => {
    expect(page).toContain("enabled: false");
  });

  it("success redirects back to agent detail page", () => {
    expect(page).toContain("/ag-admin/agents/${id}`");
  });

  it("auth failure redirects to login", () => {
    expect(page).toContain('redirect("/ag-admin/login")');
  });

  it("backend failure redirects with lifecycle_error param", () => {
    expect(page).toContain("lifecycle_error=failed");
    expect(page).toContain("lifecycle_error=unavailable");
  });
});

// ── Enable action ────────────────────────────────────────────────────────────

describe("agent detail — enable action", () => {
  it("disabled agent shows Enable button", () => {
    // Ternary renders Enable form when agent is not enabled
    expect(page).toContain("agent.enabled ?");
    expect(page).toContain("Enable");
  });

  it("enable button submits form with enableAgent action", () => {
    expect(page).toContain("action={enableAgent}");
    // Button label
    expect(page).toContain("Enable\n");
  });

  it("enable does not require confirmation (non-destructive)", () => {
    // Enable does not link to confirm_disable URL
    const enableSection = page.indexOf("action={enableAgent}");
    const confirmCheck = page.indexOf("confirm_enable", enableSection);
    expect(confirmCheck).toBe(-1);
  });
});

// ── Disable action ───────────────────────────────────────────────────────────

describe("agent detail — disable action", () => {
  it("enabled agent shows Disable button", () => {
    expect(page).toContain("agent.enabled");
    expect(page).toContain("Disable");
  });

  it("disable links to confirm_disable=1 URL first", () => {
    expect(page).toContain("confirm_disable=1");
    expect(page).toContain("Disable");
  });

  it("confirmation card appears when confirm_disable=1 and agent is enabled", () => {
    expect(page).toContain("confirmDisable && agent.enabled");
    expect(page).toContain("Confirm: Disable agent");
  });

  it("confirmation card explains impact: prevents new sessions", () => {
    expect(page).toContain("prevents");
    expect(page).toContain("new governed agent sessions");
  });

  it("confirmation card explains active sessions are not affected", () => {
    expect(page).toContain("Active sessions already in progress");
    expect(page).toContain("not affected");
  });

  it("confirmation card has Confirm disable submit button", () => {
    expect(page).toContain("action={disableAgent}");
    expect(page).toContain("Confirm disable");
  });

  it("confirmation card has Cancel link back to detail without confirm param", () => {
    expect(page).toContain("Cancel");
    expect(page).toContain("/ag-admin/agents/${agent.id}`");
  });

  it("only shows confirmation card when agent is enabled (not for already-disabled)", () => {
    expect(page).toContain("confirmDisable && agent.enabled");
  });
});

// ── Error display ────────────────────────────────────────────────────────────

describe("agent detail — lifecycle error display", () => {
  it("lifecycle error notice renders when lifecycle_error param is set", () => {
    expect(page).toContain("lifecycleError");
    expect(page).toContain("Lifecycle action failed");
    expect(page).toContain("LIFECYCLE_ERROR_MESSAGES");
  });

  it("raw backend error body not rendered", () => {
    expect(page).not.toContain("{rawError}");
    expect(page).not.toContain("backendMessage");
  });
});

// ── Header layout ────────────────────────────────────────────────────────────

describe("agent detail — header layout", () => {
  it("Edit link remains alongside lifecycle buttons", () => {
    expect(page).toContain("/ag-admin/agents/${agent.id}/edit");
    expect(page).toContain("Edit");
  });

  it("no Delete button or destructive delete action", () => {
    expect(page).not.toContain('method: "DELETE"');
    expect(page).not.toContain("Delete agent");
    expect(page).not.toContain("Danger");
  });

  it("Governance / Capability ceiling section still present", () => {
    expect(page).toContain("GovernanceCard");
    expect(page).toContain("Governance / Capability ceiling");
  });

  it("Agent key wording preserved", () => {
    expect(page).toContain("Agent key");
    expect(page).not.toContain('"Slug"');
  });
});

// ── Security ──────────────────────────────────────────────────────────────────

describe("agent detail — security", () => {
  it("does not expose cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("bearer token handled server-side by agRequest", () => {
    expect(page).toContain("agRequest");
    expect(page).not.toContain("document.cookie");
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
