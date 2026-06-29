/**
 * site-admin-org-link-ag-ce-availability-render.test.ts
 *
 * Pins the 2026-07-03 + 2026-07-06 wiring of the AG CE org-link
 * availability surface into `/site-admin/org-link/readiness/page.tsx`.
 *
 * Source-invariant style mirroring
 * `site-admin-org-link-ag-plan-discoverability.test.ts`. As of the
 * 2026-07-06 refactor the page no longer defines the four-variant
 * card inline — it imports the shared
 * `AGCEOrgLinkAvailabilityCard` from `@/components/shared`. This
 * test now pins the page's WIRING (helper + client imports +
 * Promise.all batching + verdict computation + shared-component
 * call site with the correct props) rather than the inline card
 * body. The four-variants + reason-mapping + no-CTA invariants live
 * in `ag-ce-org-link-availability-card-shared.test.ts`.
 *
 * Acceptance criteria covered:
 *   - Page imports the shared component from @/components/shared.
 *   - Page imports the helper + client (lib).
 *   - Page batches the readiness fetch with the existing IDP / AG
 *     candidate fetches in a single Promise.all.
 *   - Page computes the verdict and passes it to the shared card.
 *   - The shared-card call site passes the canonical readiness-page
 *     props: actionableTarget.href="/site-admin/org-link",
 *     actionableTarget.label="Open the org-link console",
 *     copyVariant="action-planning".
 *   - The shared-card call site is rendered between the existing
 *     ReadinessBadge and the BackendReadinessCard grid.
 *   - Existing IDP↔AG bilateral readiness derivation preserved.
 *   - No operator-token / Authorization / cookie access in page source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const PAGE_SOURCE = readFileSync(
  resolve(ROOT, "app/site-admin/org-link/readiness/page.tsx"),
  "utf-8"
);

describe("/site-admin/org-link/readiness — AG CE availability wiring (post-2026-07-08 runtime composition)", () => {
  it("imports the shared AGCEOrgLinkAvailabilityCard from @/components/shared", () => {
    expect(PAGE_SOURCE).toContain(
      'import { AGCEOrgLinkAvailabilityCard } from "@/components/shared/ag-ce-org-link-availability-card"'
    );
  });

  it("no longer imports deriveAGCEOrgLinkAvailability directly (consumed via runtime state)", () => {
    // The 2026-07-08 runtime-composition slice moved the derive call
    // into `getServerRuntimeState`. The page must NOT re-import the
    // helper.
    expect(PAGE_SOURCE).not.toContain(
      'import { deriveAGCEOrgLinkAvailability } from "@/lib/ag-ce-org-linking-availability"'
    );
  });

  it("no longer imports fetchAGOrgLinkReadiness directly (consumed via runtime state)", () => {
    // Same rationale — the readiness probe is now fetched server-
    // side inside `getServerRuntimeState`.
    expect(PAGE_SOURCE).not.toContain(
      'import { fetchAGOrgLinkReadiness } from "@/lib/ag-org-link-readiness-client"'
    );
  });

  it("page no longer defines its own AGCEOrgLinkAvailabilityCard function (inline body removed)", () => {
    expect(PAGE_SOURCE).not.toMatch(/^function AGCEOrgLinkAvailabilityCard\b/m);
  });

  it("page does not duplicate the variant switch in its own body", () => {
    expect(PAGE_SOURCE).not.toContain('case "actionable"');
    expect(PAGE_SOURCE).not.toContain('case "readiness_pending"');
    expect(PAGE_SOURCE).not.toContain('case "capability_missing"');
    expect(PAGE_SOURCE).not.toContain('case "readiness_unknown"');
  });

  it("does NOT batch a direct readiness fetch with the candidate fetches (delegated to runtime state)", () => {
    // The pre-2026-07-08 page used to call fetchAGOrgLinkReadiness
    // inside its Promise.all. After 2026-07-08 the readiness round-
    // trip is amortised inside `getServerRuntimeState` and the page
    // batches ONLY the two candidate fetches.
    expect(PAGE_SOURCE).not.toContain("fetchAGOrgLinkReadiness");
    expect(PAGE_SOURCE).toMatch(
      /await Promise\.all\(\[\s*fetchIDPOrganizationExportCandidates\(\),\s*fetchAGOrganizationExportCandidates\(\),\s*\]\)/
    );
  });

  it("reads the AG CE availability verdict from state.agCEOrgLinkAvailability (no direct derive call)", () => {
    expect(PAGE_SOURCE).toContain("state.agCEOrgLinkAvailability");
    expect(PAGE_SOURCE).not.toContain("deriveAGCEOrgLinkAvailability(");
  });
});

describe("/site-admin/org-link/readiness — shared-card call site props", () => {
  it('passes actionableTarget.href="/site-admin/org-link" (the link/unlink console)', () => {
    expect(PAGE_SOURCE).toContain('href: "/site-admin/org-link"');
  });

  it('passes actionableTarget.label="Open the org-link console"', () => {
    expect(PAGE_SOURCE).toContain('label: "Open the org-link console"');
  });

  it('passes copyVariant="action-planning"', () => {
    expect(PAGE_SOURCE).toContain('copyVariant="action-planning"');
  });

  it("renders the shared <AGCEOrgLinkAvailabilityCard ... /> JSX call", () => {
    expect(PAGE_SOURCE).toContain("<AGCEOrgLinkAvailabilityCard");
    expect(PAGE_SOURCE).toContain("availability={agCEAvailability}");
  });

  it("the shared card is rendered between the overall ReadinessBadge and the BackendReadinessCard grid", () => {
    const badgeIdx = PAGE_SOURCE.indexOf("<ReadinessBadge ");
    const cardIdx = PAGE_SOURCE.indexOf("<AGCEOrgLinkAvailabilityCard");
    const backendGridIdx = PAGE_SOURCE.indexOf("Backend readiness cards");
    expect(badgeIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(-1);
    expect(backendGridIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(badgeIdx);
    expect(cardIdx).toBeLessThan(backendGridIdx);
  });
});

describe("/site-admin/org-link/readiness — existing IDP↔AG bilateral derivation preserved", () => {
  it("page still consumes deriveOrganizationLinkingReadiness (no regression)", () => {
    expect(PAGE_SOURCE).toContain("deriveOrganizationLinkingReadiness(state)");
    expect(PAGE_SOURCE).toContain("BackendReadinessCard");
    expect(PAGE_SOURCE).toContain("PrerequisitesList");
  });
});

describe("/site-admin/org-link/readiness — token safety invariants", () => {
  it("page source does not read or echo operator token / Authorization header / cookie", () => {
    expect(PAGE_SOURCE).not.toContain("getAgOperatorToken");
    expect(PAGE_SOURCE).not.toContain("AG_COOKIE_NAME");
    expect(PAGE_SOURCE).not.toMatch(/Authorization:\s*`Bearer/);
    expect(PAGE_SOURCE).not.toContain("ag_operator_session");
  });
});
