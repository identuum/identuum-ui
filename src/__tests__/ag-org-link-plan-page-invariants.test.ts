/**
 * ag-org-link-plan-page-invariants.test.ts
 *
 * Source-invariant pins for the new /site-admin/org-link/ag-plan page
 * (AG-31 UI consumption slice). Mirrors the source-only style of
 * platform-status-ag-capability-display.test.ts — no React render,
 * no Playwright. Pins only the strings and structural decisions a
 * future regression must NOT silently break.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const PAGE_SOURCE = readFileSync(
  resolve(ROOT, "app/site-admin/org-link/ag-plan/page.tsx"),
  "utf-8"
);

describe("/site-admin/org-link/ag-plan — source invariants", () => {
  it("page invokes the AG OSS plan client, not the monolith-shape plan client", () => {
    expect(PAGE_SOURCE).toContain("fetchAGOrgLinkPlanOSS");
    expect(PAGE_SOURCE).toContain("ag-org-link-plan-oss-client");
    // The monolith-shape client must NOT be wired here.
    expect(PAGE_SOURCE).not.toContain("fetchAGOrgLinkPlan(");
    expect(PAGE_SOURCE).not.toContain('from "@/lib/ag-org-client"');
  });

  it("page surfaces every classified result variant from the client", () => {
    expect(PAGE_SOURCE).toContain('case "ok"');
    expect(PAGE_SOURCE).toContain('case "not_configured"');
    expect(PAGE_SOURCE).toContain('case "ag_auth_required"');
    expect(PAGE_SOURCE).toContain('case "ag_forbidden"');
    expect(PAGE_SOURCE).toContain('case "ag_unavailable"');
    expect(PAGE_SOURCE).toContain('case "error"');
  });

  it("page renders the three summary counts (Total / Linked / Unlinked)", () => {
    expect(PAGE_SOURCE).toContain("Total");
    expect(PAGE_SOURCE).toContain("Linked");
    expect(PAGE_SOURCE).toContain("Unlinked");
    expect(PAGE_SOURCE).toContain("plan.total");
    expect(PAGE_SOURCE).toContain("plan.linked_count");
    expect(PAGE_SOURCE).toContain("plan.unlinked_count");
  });

  it("page renders the org table with link_status and linked_idp_org_id columns", () => {
    expect(PAGE_SOURCE).toContain("Display name");
    expect(PAGE_SOURCE).toContain("Link status");
    expect(PAGE_SOURCE).toContain("Linked IDP org id");
    expect(PAGE_SOURCE).toContain("o.linked_idp_org_id");
    expect(PAGE_SOURCE).toContain('o.link_status === "linked"');
  });

  it("page renders an empty-state when total === 0", () => {
    expect(PAGE_SOURCE).toContain("plan.total === 0");
    expect(PAGE_SOURCE).toContain("No AG organizations");
  });

  it("page does NOT add link / unlink / import buttons in this slice", () => {
    // Read-only slice. None of these write affordances may appear.
    expect(PAGE_SOURCE).not.toMatch(/link.*to.*idp/i);
    expect(PAGE_SOURCE).not.toMatch(/<button[^>]*>.*unlink/i);
    expect(PAGE_SOURCE).not.toMatch(/<button[^>]*>.*import/i);
    expect(PAGE_SOURCE).not.toContain("onClick");
    expect(PAGE_SOURCE).not.toContain('method="POST"');
    expect(PAGE_SOURCE).not.toContain("useFormState");
  });

  it("page does NOT render sensitive-looking field names", () => {
    // None of these field names exist on the AG OSS post-AG-31 row
    // projection. A regression that pulls them from the wire body
    // must not silently surface here either.
    expect(PAGE_SOURCE).not.toMatch(/\bdescription\b/);
    expect(PAGE_SOURCE).not.toMatch(/\bcreated_at\b/);
    expect(PAGE_SOURCE).not.toMatch(/\bupdated_at\b/);
    expect(PAGE_SOURCE).not.toMatch(/\bpassword\b/);
    expect(PAGE_SOURCE).not.toMatch(/\bclient_secret\b/);
    expect(PAGE_SOURCE).not.toMatch(/\bprivate_key\b/);
  });

  it("page is force-dynamic (session state must not be cached)", () => {
    expect(PAGE_SOURCE).toContain('export const dynamic = "force-dynamic"');
  });

  it("page metadata is present", () => {
    expect(PAGE_SOURCE).toContain("AG Org-Link Plan");
  });
});
