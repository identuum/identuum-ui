/**
 * site-admin-org-link-ag-plan-discoverability.test.ts
 *
 * Pins the cdx1-20260611-ui-ag-org-link-plan-discoverability change:
 * the existing /site-admin/org-link landing page surfaces a clearly
 * labelled READ-ONLY link to /site-admin/org-link/ag-plan, and the
 * discoverability block itself does not introduce write affordances.
 *
 * Style: source-invariant (same pattern as
 * platform-status-ag-capability-display.test.ts and
 * ag-org-link-plan-page-invariants.test.ts). No React render, no
 * Playwright — works without secrets, runs in vitest.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const ORG_LINK_SOURCE = readFileSync(resolve(ROOT, "app/site-admin/org-link/page.tsx"), "utf-8");
const AG_PLAN_SOURCE = readFileSync(
  resolve(ROOT, "app/site-admin/org-link/ag-plan/page.tsx"),
  "utf-8"
);

describe("/site-admin/org-link — AG OSS plan discoverability", () => {
  it("page contains an <a> link to /site-admin/org-link/ag-plan", () => {
    expect(ORG_LINK_SOURCE).toContain('href="/site-admin/org-link/ag-plan"');
  });

  it("the link label clearly communicates read-only semantics", () => {
    // Title and helper copy should both mention read-only without
    // implying any link/unlink/import action.
    expect(ORG_LINK_SOURCE).toContain("AG OSS org-link plan (read-only)");
    expect(ORG_LINK_SOURCE).toMatch(/no write actions/i);
  });

  it("discoverability block is grouped under a clear 'Related read-only views' label", () => {
    expect(ORG_LINK_SOURCE).toContain("Related read-only views");
  });

  it("discoverability block uses anchor navigation only — no button / onClick / form / action", () => {
    // Capture the block source (RelatedReadOnlyViews body) for focused
    // assertions. We rely on the named component boundary added by the
    // discoverability slice.
    const start = ORG_LINK_SOURCE.indexOf("function RelatedReadOnlyViews");
    expect(start, "RelatedReadOnlyViews component must be defined").toBeGreaterThan(-1);
    const after = ORG_LINK_SOURCE.slice(start);
    const end = after.indexOf("\nfunction ");
    const block = end > -1 ? after.slice(0, end) : after;

    // Hard pins: no write-style elements introduced anywhere in the block.
    expect(block).not.toMatch(/<button[\s>]/i);
    expect(block).not.toContain("onClick");
    expect(block).not.toMatch(/<form[\s>]/i);
    expect(block).not.toMatch(/method=["']POST["']/i);
    expect(block).not.toContain("useFormState");
    expect(block).not.toContain("formAction");
  });

  it("the linked target page is still strictly read-only (no regression on /ag-plan)", () => {
    // Defense-in-depth: the discoverability slice must not have leaked
    // write affordances onto the target page either.
    expect(AG_PLAN_SOURCE).not.toMatch(/<button[\s>]/i);
    expect(AG_PLAN_SOURCE).not.toContain("onClick");
    expect(AG_PLAN_SOURCE).not.toMatch(/<form[\s>]/i);
    expect(AG_PLAN_SOURCE).not.toMatch(/method=["']POST["']/i);
    expect(AG_PLAN_SOURCE).not.toContain("useFormState");
    expect(AG_PLAN_SOURCE).not.toContain("formAction");
  });

  it("existing org-link/import controls on the landing page are still wired (no regression)", () => {
    // These names are the existing link/import flow on /site-admin/org-link.
    // The discoverability slice must NOT have removed them.
    expect(ORG_LINK_SOURCE).toContain("OrgLinkActions");
    expect(ORG_LINK_SOURCE).toContain("IDPImportSection");
    // ScopeWarning still rendered.
    expect(ORG_LINK_SOURCE).toContain("ScopeWarning");
  });
});
