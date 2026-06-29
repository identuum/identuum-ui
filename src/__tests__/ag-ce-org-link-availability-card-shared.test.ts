/**
 * ag-ce-org-link-availability-card-shared.test.ts
 *
 * Pins the 2026-07-06 shared `AGCEOrgLinkAvailabilityCard` component
 * extracted from the inline sub-components on
 * `/site-admin/org-link/readiness/page.tsx` (2026-07-03) and
 * `/platform-status/page.tsx` (2026-07-05). Source-invariant style
 * mirroring the existing AG CE org-link tests.
 *
 * Acceptance criteria covered:
 *   - Shared component file lives at the documented path.
 *   - Renders exactly four variant branches (actionable,
 *     readiness_pending, capability_missing, readiness_unknown).
 *   - Both copy variants ("action-planning" + "operational-health")
 *     are reachable in the source.
 *   - The actionable variant renders the caller-supplied
 *     `actionableTarget.href` and `actionableTarget.label` —
 *     component must NEVER bake in either /site-admin/org-link OR
 *     /site-admin/org-link/readiness as a literal href.
 *   - `readiness_pending` renders AG CE editorial notes verbatim via
 *     `availability.reasons.map(...)`.
 *   - `readiness_unknown` maps each `reason` discriminator
 *     (not_configured / ag_unavailable / error) to operator-readable
 *     copy.
 *   - The shared component never renders link/unlink CTAs
 *     (`<button>`, `formAction`, `onClick`).
 *   - The shared component does NOT touch operator tokens / cookies /
 *     Authorization headers / browser-visible credential storage.
 *   - The shared component does NOT import server-only modules,
 *     server actions, AG CE fetch clients, or React Server Component
 *     internals — it is purely presentational.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");
const COMPONENT_PATH = resolve(SRC_ROOT, "components/shared/ag-ce-org-link-availability-card.tsx");

const COMPONENT_SOURCE = readFileSync(COMPONENT_PATH, "utf-8");

describe("shared AGCEOrgLinkAvailabilityCard — file + export shape", () => {
  it("the shared component file exists at @/components/shared", () => {
    expect(existsSync(COMPONENT_PATH)).toBe(true);
  });

  it("exports the AGCEOrgLinkAvailabilityCard function", () => {
    expect(COMPONENT_SOURCE).toContain("export function AGCEOrgLinkAvailabilityCard");
  });

  it("exports the AGCEOrgLinkAvailabilityCardProps type", () => {
    expect(COMPONENT_SOURCE).toContain("export interface AGCEOrgLinkAvailabilityCardProps");
  });

  it("imports the availability type from the canonical lib helper (no duplicate type)", () => {
    expect(COMPONENT_SOURCE).toContain(
      'import type { AGCEOrgLinkAvailability } from "@/lib/ag-ce-org-linking-availability"'
    );
  });
});

describe("shared AGCEOrgLinkAvailabilityCard — four variants + copy variants", () => {
  it("the switch covers all four canonical variant literals", () => {
    expect(COMPONENT_SOURCE).toContain('case "actionable"');
    expect(COMPONENT_SOURCE).toContain('case "readiness_pending"');
    expect(COMPONENT_SOURCE).toContain('case "capability_missing"');
    expect(COMPONENT_SOURCE).toContain('case "readiness_unknown"');
  });

  it("both copy variants are reachable in the source", () => {
    expect(COMPONENT_SOURCE).toContain('"operational-health"');
    expect(COMPONENT_SOURCE).toContain('"action-planning"');
  });

  it("action-planning copy strings (preserved BYTE-IDENTICAL from the prior inline sub-component) are present", () => {
    expect(COMPONENT_SOURCE).toContain("AG organization linking available");
    expect(COMPONENT_SOURCE).toContain("AG organization linking not yet ready");
    expect(COMPONENT_SOURCE).toContain("AG organization linking capability not advertised");
    expect(COMPONENT_SOURCE).toContain("AG organization linking status unavailable");
  });

  it("operational-health copy strings (preserved BYTE-IDENTICAL from the prior inline sub-component) are present", () => {
    expect(COMPONENT_SOURCE).toContain("AG org-link surface ready");
    expect(COMPONENT_SOURCE).toContain("AG org-link surface pending");
    expect(COMPONENT_SOURCE).toContain("AG org-link capability not advertised");
    expect(COMPONENT_SOURCE).toContain("AG org-link status unavailable");
  });

  it("readiness_pending renders AG CE editorial notes verbatim via availability.reasons.map", () => {
    expect(COMPONENT_SOURCE).toContain("availability.reasons");
    expect(COMPONENT_SOURCE).toContain(".map(");
  });

  it("readiness_unknown maps each reason discriminator to operator-readable copy", () => {
    expect(COMPONENT_SOURCE).toContain('availability.reason === "not_configured"');
    expect(COMPONENT_SOURCE).toContain('availability.reason === "ag_unavailable"');
    expect(COMPONENT_SOURCE).toContain(
      "Agent Governance returned an unexpected readiness response"
    );
  });
});

describe("shared AGCEOrgLinkAvailabilityCard — actionable href + label come from props", () => {
  it("renders actionableTarget.href dynamically (no baked-in href literal in JSX)", () => {
    // The component MUST NOT bake in either of the two call-site
    // targets as a literal JSX href — that's the whole point of the
    // refactor. We strip the leading JSDoc + line comments first so
    // we only inspect runtime source.
    const code = stripCommentsAndJSDoc(COMPONENT_SOURCE);
    expect(code).not.toMatch(/href=["']\/site-admin\/org-link["']/);
    expect(code).not.toMatch(/href=["']\/site-admin\/org-link\/readiness["']/);
    // Instead the component interpolates `actionableTarget.href`.
    expect(COMPONENT_SOURCE).toContain("href={actionableTarget.href}");
  });

  it("renders actionableTarget.label dynamically (no baked-in CTA copy in JSX)", () => {
    // The visible link label is caller-provided. We strip comments
    // before asserting so JSDoc examples don't trigger a false fail.
    const code = stripCommentsAndJSDoc(COMPONENT_SOURCE);
    expect(code).not.toContain("Open the org-link console");
    expect(code).not.toContain("Open readiness");
    expect(COMPONENT_SOURCE).toContain("{actionableTarget.label}");
  });
});

describe("shared AGCEOrgLinkAvailabilityCard — no link/unlink CTAs ever", () => {
  it("contains no <button> element anywhere", () => {
    expect(COMPONENT_SOURCE).not.toMatch(/<button[\s>]/i);
  });

  it("contains no formAction / onClick / form attributes", () => {
    expect(COMPONENT_SOURCE).not.toContain("formAction");
    expect(COMPONENT_SOURCE).not.toContain("onClick");
    expect(COMPONENT_SOURCE).not.toMatch(/<form[\s>]/i);
    expect(COMPONENT_SOURCE).not.toMatch(/method=["']POST["']/i);
  });

  it("contains no server-action / write-client imports", () => {
    expect(COMPONENT_SOURCE).not.toContain('"use server"');
    expect(COMPONENT_SOURCE).not.toContain("ag-org-link-write-client");
    expect(COMPONENT_SOURCE).not.toContain("executeOrganizationImport");
    expect(COMPONENT_SOURCE).not.toContain("OrgLinkActions");
    expect(COMPONENT_SOURCE).not.toContain("IDPImportSection");
  });
});

describe("shared AGCEOrgLinkAvailabilityCard — token safety + presentation-only scope", () => {
  it("does NOT touch operator-token / cookie / Authorization symbols", () => {
    expect(COMPONENT_SOURCE).not.toContain("getAgOperatorToken");
    expect(COMPONENT_SOURCE).not.toContain("AG_COOKIE_NAME");
    expect(COMPONENT_SOURCE).not.toContain("ag_operator_session");
    expect(COMPONENT_SOURCE).not.toMatch(/Authorization:\s*`Bearer/);
    expect(COMPONENT_SOURCE).not.toContain("Bearer ");
  });

  it("does NOT reach into browser-visible storage / URL params", () => {
    expect(COMPONENT_SOURCE).not.toContain("localStorage");
    expect(COMPONENT_SOURCE).not.toContain("sessionStorage");
    expect(COMPONENT_SOURCE).not.toContain("document.cookie");
    expect(COMPONENT_SOURCE).not.toContain("window.location");
    expect(COMPONENT_SOURCE).not.toContain("searchParams");
  });

  it("does NOT import server-only modules / AG CE fetch clients", () => {
    // Restrict the check to ACTUAL import statements (not JSDoc
    // descriptions that may name these modules as examples).
    const importLines = COMPONENT_SOURCE.split("\n").filter((line) => /^\s*import\s/.test(line));
    const importsBlob = importLines.join("\n");
    expect(importsBlob).not.toContain('"server-only"');
    expect(importsBlob).not.toContain("ag-org-link-readiness-client");
    expect(importsBlob).not.toContain("ag-org-link-plan-oss-client");
    expect(importsBlob).not.toContain("ag-org-client");
    expect(importsBlob).not.toMatch(/from\s+"[^"]*\/ag-client"/);
    expect(importsBlob).not.toContain("runtime-config");
    expect(importsBlob).not.toContain("server-runtime-state");
  });

  it("does NOT redrive the availability derivation (only imports the TYPE)", () => {
    // The shared component is purely presentational. It imports the
    // AGCEOrgLinkAvailability TYPE but must never re-implement the
    // derivation itself. JSDoc descriptions that mention these
    // symbols as references are fine; we restrict the check to the
    // CODE block (stripping comments).
    const code = stripCommentsAndJSDoc(COMPONENT_SOURCE);
    expect(code).not.toContain("deriveAGCEOrgLinkAvailability");
    expect(code).not.toContain("fetchAGOrgLinkReadiness");
    expect(code).not.toContain("organization_linking");
  });
});

/**
 * stripCommentsAndJSDoc removes /* ... *​/ JSDoc blocks and // line
 * comments from the source before substring assertions. Used by
 * tests that want to assert against the CODE only, not the doc
 * comments (which may legitimately name forbidden symbols as
 * descriptive references).
 */
function stripCommentsAndJSDoc(src: string): string {
  // Strip block comments (greedy multi-line).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip line comments.
  out = out.replace(/(^|\s)\/\/[^\n]*/g, "$1");
  return out;
}
