/**
 * UI ↔ AG CE capability-gate harness — workspace stability slice.
 *
 * Landed by agent-a-20260748-identuum-workspace-stability-highest-risk-contracts
 * per the audit + 4-prompt plan in
 *   wiki/platform/workspace-stability-harness.md §"What's missing relative to the Account Settings pilot"
 * which classified UI ↔ AG-CE capability drift as the #1 highest-risk
 * uncovered cross-repo contract.
 *
 * Purpose: pin the wire path the UI uses to consume AG CE's
 * `/api/v1/component` capability map AND the gating decision that
 * collapses to `capability_missing` when AG declares a feature off.
 * Catches the same regression class as agent-a-20260744's Account
 * Settings capability gate, but for the AG side.
 *
 * Today's authoritative AG-CE capability-gated surface (verified
 * 2026-06-25 by source inspection): organization_linking →
 * deriveAGCEOrgLinkAvailability → site-admin/org-link/* and
 * platform-status/* pages. Other CE-only AG capabilities (HITL, MCP,
 * TrustedOIDC, etc.) are all declared `false` in AG-CE
 * internal/server/component.go and are NOT consumed by any UI surface
 * yet — they are documented in the audit but harness pins for them
 * are not yet useful (drift fires the iff-invariant in AG-CE's own Go
 * contract test once that lands in a future slice).
 *
 * SECURITY: source-text reflection only. No real secrets, cookies,
 * tokens, or sessions are referenced. Placeholder labels only.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── UI consumer side ────────────────────────────────────────────────────────

describe("UI consumes AG capabilities via the documented state path", () => {
  const helper = source("lib/ag-ce-org-linking-availability.ts");
  const runtime = source("lib/server-runtime-state.ts");

  it("deriveAGCEOrgLinkAvailability reads organization_linking off ComponentCapabilities", () => {
    // Pinning the EXACT field name catches an AG-side rename that
    // would otherwise silently flip the capability gate.
    expect(helper).toMatch(/agCapabilities\?\.organization_linking\s*===\s*true/);
  });

  it("deriveAGCEOrgLinkAvailability short-circuits to capability_missing when the flag is false", () => {
    // The capability gate fires FIRST so a deployment that has not
    // flipped the flag sees capability_missing regardless of probe
    // readiness. This is the AG analog of the Account Settings
    // PasskeysUnavailableNotice (the structural guarantee that the
    // broken active path is unreachable while the gate is closed).
    expect(helper).toMatch(
      /if\s*\(\s*!cap\s*\)\s*return\s*\{\s*state:\s*"capability_missing"\s*\}/
    );
  });

  it("getServerRuntimeState composes the AG availability via the runtime cache (not a per-page probe)", () => {
    // Pin the runtime-state composition so a future refactor that
    // re-introduces per-page readiness probes does not regress the
    // 2026-07-08 closure (cf. wiki/repos/identuum-ui.md §"AG CE → UI
    // runtime composition refactor"). This avoids a per-page
    // round-trip that would also be the wrong layer to enforce the
    // capability gate.
    expect(runtime).toMatch(
      /deriveAGCEOrgLinkAvailability\(\s*state\.components\.ag\.capabilities,\s*agCEReadinessResult\s*\)/
    );
  });
});

// ── AG-CE backend declaration side (cross-repo source-text pin) ─────────────
//
// Reads ../identuum-ag-ce/internal/server/component.go and asserts the
// AG-CE component handler still declares the field name + the
// capability literal the UI consumes. SKIPs gracefully when the sibling
// repo is absent (mirrors the customer-smoke quick suite's cross-repo
// SKIP discipline from agent-a-20260743).

import { existsSync } from "node:fs";

const AG_CE_COMPONENT_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "identuum-ag-ce",
  "internal",
  "server",
  "component.go"
);

describe("UI ↔ AG-CE wire-shape contract (cross-repo source-text pin)", () => {
  if (!existsSync(AG_CE_COMPONENT_PATH)) {
    it.skip("sibling identuum-ag-ce repo not present — skipping cross-repo wire-shape check", () => {
      // no-op
    });
    return;
  }

  const agCeComponent = readFileSync(AG_CE_COMPONENT_PATH, "utf8");

  it("AG-CE component.go declares the capability_map_schema_version the UI's helper assumes", () => {
    // The UI helper at lib/ag-ce-org-linking-availability.ts predates
    // the schema versioning convention but the runtime composition
    // layer reads the AG capability map shape that the schema versions.
    // Pin the schema version literal so a future bump fires this test
    // AND the AG-side contract test together.
    expect(agCeComponent).toMatch(/ComponentSchemaVersion\s*=\s*"ag-capabilities\.v1"/);
  });

  it("AG-CE component.go declares an OrganizationLinking field (snake-case wire: organization_linking)", () => {
    // Catches a Go-side field rename that would invalidate the UI's
    // `agCapabilities?.organization_linking === true` gate.
    expect(agCeComponent).toMatch(/OrganizationLinking:\s*(true|false)/);
  });

  it("AG-CE component.go family + product identifiers stay stable", () => {
    // The UI's runtime composition reads
    //   state.components.ag === { capabilities: ..., ... }
    // where the AG component is identified by family="identuum-ag" +
    // product="identuum-ag-ce" today. Pin both so a future rename
    // fires here.
    expect(agCeComponent).toMatch(/ComponentFamily\s*=\s*"identuum-ag"/);
    expect(agCeComponent).toMatch(/ProductIdentifier\s*=\s*"identuum-ag-ce"/);
  });
});
