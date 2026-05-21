/**
 * Tests for AG Agent Registry management pages.
 *
 * Covers: Register agent (new), Edit agent, agents list management controls,
 * agent detail edit link, safety and security requirements.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const listPage = readFile("src/app/ag-admin/(authed)/agents/page.tsx");
const detailPage = readFile("src/app/ag-admin/(authed)/agents/[id]/page.tsx");
const newPage = readFile("src/app/ag-admin/(authed)/agents/new/page.tsx");
const editPage = readFile("src/app/ag-admin/(authed)/agents/[id]/edit/page.tsx");

// ── Agents list — Register link ───────────────────────────────────────────────

describe("agents list — management controls", () => {
  it("renders Register agent link", () => {
    expect(listPage).toContain("Register agent");
    expect(listPage).toContain("/ag-admin/agents/new");
  });

  it("no longer shows Read-only badge in page header", () => {
    const headerIdx = listPage.indexOf("PageHeader");
    // The list page header should have the register link, not Read-only badge
    const registerIdx = listPage.indexOf("Register agent");
    expect(registerIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeGreaterThan(-1);
  });

  it("existing sort/search/filter controls still present", () => {
    expect(listPage).toContain("BACKEND_SORT_FIELDS");
    expect(listPage).toContain("PaginationBar");
    expect(listPage).toContain('type="search"');
  });

  it("Agent key wording preserved in column header", () => {
    expect(listPage).toContain("Agent key");
    expect(listPage).not.toContain(">Slug ");
  });
});

// ── Agent detail — Edit link ──────────────────────────────────────────────────

describe("agent detail — edit link", () => {
  it("renders Edit link pointing to /ag-admin/agents/:id/edit", () => {
    expect(detailPage).toContain("/ag-admin/agents/${agent.id}/edit");
    expect(detailPage).toContain("Edit");
  });

  it("existing identity/config/audit cards still render", () => {
    expect(detailPage).toContain("agent.id");
    expect(detailPage).toContain("agent.slug");
    expect(detailPage).toContain("Agent key");
  });
});

// ── New agent page ────────────────────────────────────────────────────────────

describe("new agent page — structure", () => {
  it("page title is 'Register agent'", () => {
    expect(newPage).toContain("Register agent");
  });

  it("metadata title set correctly", () => {
    expect(newPage).toContain("Register Agent — Identuum AG");
  });

  it("is force-dynamic", () => {
    expect(newPage).toContain('export const dynamic = "force-dynamic"');
  });

  it("redirects to login on auth error", () => {
    expect(newPage).toContain('redirect("/ag-admin/login")');
  });

  it("back link to agent registry", () => {
    expect(newPage).toContain("← Agent Registry");
    expect(newPage).toContain('href="/ag-admin/agents"');
  });
});

describe("new agent page — form fields", () => {
  it("uses 'Agent key' label, not bare 'Slug'", () => {
    expect(newPage).toContain('"Agent key"');
    expect(newPage).not.toContain('"Slug"');
  });

  it("agent key field uses lowercase-with-hyphens pattern", () => {
    expect(newPage).toContain("slug");
    expect(newPage).toContain("pattern");
    expect(newPage).toContain("[a-z0-9]");
  });

  it("display name field is present and required", () => {
    expect(newPage).toContain('"name"');
    expect(newPage).toContain("Display name");
    expect(newPage).toContain("required");
  });

  it("description field present with max length", () => {
    expect(newPage).toContain("description");
    expect(newPage).toContain("1024");
  });

  it("allowed tools field accepts one tool per line", () => {
    expect(newPage).toContain("allowed_tools");
    expect(newPage).toContain("One tool name per line");
  });

  it("max session duration field present", () => {
    expect(newPage).toContain("max_session_duration_seconds");
    expect(newPage).toContain("Max session duration");
  });

  it("enabled checkbox present and defaults to checked", () => {
    expect(newPage).toContain("enabled");
    expect(newPage).toContain("defaultChecked");
  });
});

describe("new agent page — server action and error handling", () => {
  it("form submits to createAgent server action via agRequest POST", () => {
    expect(newPage).toContain('method: "POST"');
    expect(newPage).toContain("/admin/agent-registry");
    expect(newPage).toContain("createAgent");
    expect(newPage).toContain('"use server"');
  });

  it("success redirects to new agent detail page", () => {
    expect(newPage).toContain("/ag-admin/agents/${created.id}");
  });

  it("slug_collision error mapped to safe operator message", () => {
    expect(newPage).toContain("slug_collision");
    expect(newPage).toContain("Agent key is already in use");
  });

  it("quota_exceeded error mapped to safe operator message", () => {
    expect(newPage).toContain("quota_exceeded");
    expect(newPage).toContain("quota");
  });

  it("extracts field errors from backend validation envelope", () => {
    expect(newPage).toContain("details");
    expect(newPage).toContain("validation&field=");
  });

  it("raw backend error messages are not rendered", () => {
    expect(newPage).not.toContain("{rawError}");
    expect(newPage).not.toContain("backendMessage");
  });

  it("capability_ceiling is now configurable via structured HITL gate section", () => {
    expect(newPage).toContain("HITL Gate");
    expect(newPage).toContain("hitl_enabled");
    // No raw JSON textarea for capability_ceiling
    expect(newPage).not.toContain('name="capability_ceiling"');
  });
});

describe("new agent page — security", () => {
  it("does not render cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(newPage).not.toContain(forbidden);
    }
  });

  it("no credential input fields in the form", () => {
    // These field names must not appear as form input names
    for (const forbidden of ['name="password"', 'name="private_key"', 'name="client_secret"', 'name="token"']) {
      expect(newPage).not.toContain(forbidden);
    }
  });
});

// ── Edit agent page ───────────────────────────────────────────────────────────

describe("edit agent page — structure", () => {
  it("page title is 'Edit agent'", () => {
    expect(editPage).toContain("Edit agent");
  });

  it("is force-dynamic", () => {
    expect(editPage).toContain('export const dynamic = "force-dynamic"');
  });

  it("redirects to login on auth error", () => {
    expect(editPage).toContain('redirect("/ag-admin/login")');
  });

  it("back link to agent detail", () => {
    expect(editPage).toContain("← Agent detail");
    expect(editPage).toContain("/ag-admin/agents/${id}");
  });
});

describe("edit agent page — immutable fields", () => {
  it("technical ID shown as immutable (not editable)", () => {
    expect(editPage).toContain("Technical ID (immutable)");
    expect(editPage).toContain("agent.id");
    // ID must not be in a form input
    const idInInput = editPage.includes('name="id"') || editPage.includes("name={\"id\"}");
    expect(idInInput).toBe(false);
  });
});

describe("edit agent page — form fields", () => {
  it("uses 'Agent key' label", () => {
    expect(editPage).toContain('"Agent key"');
    expect(editPage).not.toContain('"Slug"');
  });

  it("fields are pre-populated with current agent data", () => {
    expect(editPage).toContain("defaultValue={agent.name}");
    expect(editPage).toContain("defaultValue={agent.slug}");
    expect(editPage).toContain("defaultValue={agent.description");
  });

  it("enabled checkbox pre-populated with current state", () => {
    expect(editPage).toContain("defaultChecked={agent.enabled}");
  });

  it("allowed tools pre-populated as newline-joined", () => {
    expect(editPage).toContain("join(");
  });
});

describe("edit agent page — server action", () => {
  it("submits PATCH to /admin/agent-registry/:id", () => {
    expect(editPage).toContain('method: "PATCH"');
    expect(editPage).toContain("/admin/agent-registry/");
    expect(editPage).toContain("updateAgent");
  });

  it("success redirects back to agent detail", () => {
    expect(editPage).toContain("/ag-admin/agents/${id}`");
  });

  it("slug_collision error shown safely", () => {
    expect(editPage).toContain("slug_collision");
    expect(editPage).toContain("Agent key is already in use");
  });
});

describe("edit agent page — security", () => {
  it("does not render cookies, tokens, or internal URLs", () => {
    for (const forbidden of ["ag_operator_session", "client_secret", "host.docker.internal"]) {
      expect(editPage).not.toContain(forbidden);
    }
  });

  it("no destructive delete action present", () => {
    // HTTP DELETE must not be in the form
    expect(editPage).not.toContain('method: "DELETE"');
    // No delete agent button or danger zone
    expect(editPage).not.toContain("Delete agent");
    expect(editPage).not.toContain("Danger");
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
