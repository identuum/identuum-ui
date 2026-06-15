/**
 * Tests for capability ceiling / governance posture editor.
 *
 * The capability ceiling schema is:
 *   {"hitl": {"posture": "required|optional|not_required", ...}}
 *
 * Covers: agent detail governance card, edit page HITL form, create HITL section.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const uiRoot = path.resolve(import.meta.dirname, "../../");
function readFile(relPath: string): string {
  return fs.readFileSync(path.join(uiRoot, relPath), "utf-8");
}

const detailPage = readFile("src/app/ag-admin/(authed)/agents/[id]/page.tsx");
const editPage = readFile("src/app/ag-admin/(authed)/agents/[id]/edit/page.tsx");
const newPage = readFile("src/app/ag-admin/(authed)/agents/new/page.tsx");

// ── Agent detail — Governance card ───────────────────────────────────────────

describe("agent detail — governance card", () => {
  it("renders Governance / Capability ceiling section", () => {
    expect(detailPage).toContain("GovernanceCard");
    expect(detailPage).toContain("Governance / Capability ceiling");
  });

  it("typed CapabilityCeiling and HITLPolicy interfaces defined", () => {
    expect(detailPage).toContain("interface CapabilityCeiling");
    expect(detailPage).toContain("interface HITLPolicy");
    expect(detailPage).toContain("posture: string");
    expect(detailPage).toContain("review_acr_floor");
    expect(detailPage).toContain("review_auth_max_age_seconds");
  });

  it("empty/null ceiling shows 'No capability ceiling configured'", () => {
    expect(detailPage).toContain("No capability ceiling configured");
    expect(detailPage).toContain("bearer-only issuance");
  });

  it("existing ceiling shows HITL posture", () => {
    expect(detailPage).toContain("HITL posture");
    expect(detailPage).toContain("hitl.posture");
    expect(detailPage).toContain("POSTURE_LABELS");
  });

  it("existing ceiling shows reviewer ACR floor when set", () => {
    expect(detailPage).toContain("Reviewer ACR floor");
    expect(detailPage).toContain("ACR_LABELS");
    expect(detailPage).toContain("review_acr_floor");
  });

  it("existing ceiling shows reviewer freshness when non-zero", () => {
    expect(detailPage).toContain("Reviewer freshness");
    expect(detailPage).toContain("review_auth_max_age_seconds");
  });

  it("governance card has Edit link to agent edit page", () => {
    expect(detailPage).toContain("Edit →");
    expect(detailPage).toContain("/ag-admin/agents/${agentId}/edit");
  });

  it("known posture values mapped to human-readable labels", () => {
    expect(detailPage).toContain("required");
    expect(detailPage).toContain("optional");
    expect(detailPage).toContain("not_required");
    expect(detailPage).toContain("POSTURE_LABELS");
  });

  it("known ACR values mapped to human-readable labels", () => {
    expect(detailPage).toContain("urn:identuum:loa:password");
    expect(detailPage).toContain("urn:identuum:loa:mfa");
    expect(detailPage).toContain("urn:identuum:loa:phishing-resistant");
    expect(detailPage).toContain("ACR_LABELS");
  });

  it("does not render raw JSON or backend internal fields in JSX output", () => {
    // JSON.stringify is allowed in server-side action bodies but not in JSX renders
    expect(detailPage).not.toContain("dangerouslySetInnerHTML");
    expect(detailPage).not.toContain("ag_operator_session");
  });
});

// ── Edit page — structured HITL gate form ─────────────────────────────────────

describe("edit page — governance HITL form", () => {
  it("renders GovernanceFormCard component", () => {
    expect(editPage).toContain("GovernanceFormCard");
    expect(editPage).toContain("Governance / Capability ceiling");
  });

  it("four distinct ceiling actions present with clear labels", () => {
    expect(editPage).toContain("ceiling_action");
    expect(editPage).toContain("Keep existing capability ceiling");
    expect(editPage).toContain("Set or update HITL gate");
    expect(editPage).toContain("Clear HITL gate only");
    expect(editPage).toContain("Clear all capability bounds");
  });

  it("ambiguous bare 'Clear' label not used", () => {
    // 'clear' as option value is allowed, but the visible label must not be just 'Clear'
    expect(editPage).not.toContain(">Clear<");
    expect(editPage).not.toContain(">Clear (remove");
  });

  it("HITL posture select has all three valid values", () => {
    expect(editPage).toContain("hitl_posture");
    expect(editPage).toContain('"required"');
    expect(editPage).toContain('"optional"');
    expect(editPage).toContain('"not_required"');
  });

  it("reviewer ACR floor select has all valid ladder values", () => {
    expect(editPage).toContain("hitl_review_acr_floor");
    expect(editPage).toContain("urn:identuum:loa:password");
    expect(editPage).toContain("urn:identuum:loa:mfa");
    expect(editPage).toContain("urn:identuum:loa:phishing-resistant");
  });

  it("reviewer freshness field present", () => {
    expect(editPage).toContain("hitl_review_auth_max_age_seconds");
  });

  it("set_hitl action merges with existing ceiling (spread operator preserves unknown keys)", () => {
    expect(editPage).toContain("set_hitl");
    expect(editPage).toContain("existingCeiling");
    // Spread preserves unknown keys
    expect(editPage).toContain("{ ...existingCeiling, hitl }");
  });

  it("clear_hitl action removes only hitl key, preserves unknown keys", () => {
    expect(editPage).toContain("clear_hitl");
    expect(editPage).toContain('key !== "hitl"');
  });

  it("clear_all action sends empty object to backend", () => {
    expect(editPage).toContain("clear_all");
    expect(editPage).toContain("body.capability_ceiling = {}");
  });

  it("clear_all has explicit warning text in UI", () => {
    expect(editPage).toContain("Clear all capability bounds");
    expect(editPage).toContain("fully reset");
  });

  it("keep action omits capability_ceiling from PATCH body", () => {
    expect(editPage).toContain("keep");
    expect(editPage).toContain("PATCH leaves unchanged");
  });

  it("null/absent/invalid ceiling treated as empty object for merge", () => {
    expect(editPage).toContain("existingCeiling");
    expect(editPage).toContain('typeof agent.capability_ceiling === "object"');
    expect(editPage).toContain("!Array.isArray");
  });

  it("invalid posture shows safe validation error", () => {
    expect(editPage).toContain("validPostures");
    expect(editPage).toContain("Invalid+HITL+posture");
  });

  it("form sends PATCH to /admin/agent-registry/:id", () => {
    expect(editPage).toContain('method: "PATCH"');
    expect(editPage).toContain("/admin/agent-registry/");
  });

  it("pre-populates HITL fields from current agent data", () => {
    expect(editPage).toContain("existingHITL?.posture");
    expect(editPage).toContain("existingHITL?.review_acr_floor");
    expect(editPage).toContain("existingHITL?.review_auth_max_age_seconds");
  });

  it("does not expose raw backend errors", () => {
    expect(editPage).not.toContain("ag_operator_session");
    expect(editPage).not.toContain("client_secret");
  });

  it("no delete action present", () => {
    expect(editPage).not.toContain("DELETE");
    expect(editPage).not.toContain("danger");
  });
});

// ── New agent page — optional HITL section ───────────────────────────────────

describe("new agent page — optional HITL section", () => {
  it("has optional HITL gate section", () => {
    expect(newPage).toContain("Governance / HITL Gate");
    expect(newPage).toContain("hitl_enabled");
  });

  it("HITL posture select present", () => {
    expect(newPage).toContain("hitl_posture");
    expect(newPage).toContain('"required"');
    expect(newPage).toContain('"optional"');
    expect(newPage).toContain('"not_required"');
  });

  it("reviewer ACR floor select present", () => {
    expect(newPage).toContain("hitl_review_acr_floor");
    expect(newPage).toContain("urn:identuum:loa:password");
  });

  it("server action only includes capability_ceiling when hitl_enabled is checked", () => {
    expect(newPage).toContain("hitl_enabled");
    expect(newPage).toContain("hitlEnabled");
    expect(newPage).toContain("body.capability_ceiling = { hitl }");
  });

  it("form sends POST to /admin/agent-registry", () => {
    expect(newPage).toContain('method: "POST"');
    expect(newPage).toContain("/admin/agent-registry");
  });
});

// ── Existing behavior preserved ───────────────────────────────────────────────

describe("existing agent management behavior preserved", () => {
  it("agent key wording preserved in edit page", () => {
    expect(editPage).toContain('"Agent key"');
    expect(editPage).not.toContain('"Slug"');
  });

  it("agent key wording preserved in new page", () => {
    expect(newPage).toContain('"Agent key"');
    expect(newPage).not.toContain('"Slug"');
  });

  it("no delete action in edit page", () => {
    expect(editPage).not.toContain('"DELETE"');
    expect(editPage).not.toContain("delete agent");
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
