/**
 * platform-status-ag-ce-availability-callout.test.ts
 *
 * Pins the 2026-07-05 + 2026-07-06 wiring of the AG CE org-link
 * availability surface into `/platform-status/page.tsx`.
 *
 * As of the 2026-07-06 refactor the page no longer defines a
 * standalone `AGCEOrgLinkAvailabilityCallout` sub-component inline
 * — it imports the shared `AGCEOrgLinkAvailabilityCard` from
 * `@/components/shared` and passes the platform-status-specific
 * props (`actionableTarget`, `copyVariant="operational-health"`).
 *
 * This file now pins the page's WIRING (helper + client imports +
 * Promise.all batching with fetchAgAuthProviders + verdict
 * computation + shared-component call site with the correct props
 * + page-wide no-link/unlink-CTAs invariant). The four-variants +
 * reason-mapping + no-CTA invariants live in
 * `ag-ce-org-link-availability-card-shared.test.ts`.
 *
 * Acceptance criteria covered:
 *   - Page imports the shared component from @/components/shared.
 *   - Page imports the helper + client (lib).
 *   - Readiness fetch batched with fetchAgAuthProviders.
 *   - Verdict computed from BOTH capability and readiness signals.
 *   - Shared-card call site passes actionableTarget.href=
 *     "/site-admin/org-link/readiness" (drill-in NOT console),
 *     actionableTarget.label="Open readiness",
 *     copyVariant="operational-health".
 *   - Page does NOT redefine the variant switch inline.
 *   - Page is read-only — never references link/unlink write
 *     surfaces and the only /site-admin/org-link* href on the page
 *     points to the readiness drill-in.
 *   - No operator-token / Authorization / cookie access in page
 *     source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");
const PAGE_PATH = resolve(SRC_ROOT, "app/platform-status/page.tsx");
const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf-8");

describe("/platform-status — AG CE availability wiring (post-2026-07-08 runtime composition)", () => {
  it("imports the shared AGCEOrgLinkAvailabilityCard from @/components/shared", () => {
    expect(PAGE_SOURCE).toContain(
      'import { AGCEOrgLinkAvailabilityCard } from "@/components/shared/ag-ce-org-link-availability-card"'
    );
  });

  it("no longer imports deriveAGCEOrgLinkAvailability directly (consumed via runtime state)", () => {
    expect(PAGE_SOURCE).not.toContain(
      'import { deriveAGCEOrgLinkAvailability } from "@/lib/ag-ce-org-linking-availability"'
    );
  });

  it("no longer imports fetchAGOrgLinkReadiness directly (consumed via runtime state)", () => {
    expect(PAGE_SOURCE).not.toContain(
      'import { fetchAGOrgLinkReadiness } from "@/lib/ag-org-link-readiness-client"'
    );
  });

  it("page no longer defines an inline AGCEOrgLinkAvailabilityCallout function", () => {
    expect(PAGE_SOURCE).not.toMatch(/^function AGCEOrgLinkAvailabilityCallout\b/m);
  });

  it("page does not duplicate the variant switch in its own body", () => {
    expect(PAGE_SOURCE).not.toContain('case "actionable"');
    expect(PAGE_SOURCE).not.toContain('case "readiness_pending"');
    expect(PAGE_SOURCE).not.toContain('case "capability_missing"');
    expect(PAGE_SOURCE).not.toContain('case "readiness_unknown"');
  });

  it("does NOT batch a direct readiness fetch (delegated to runtime state)", () => {
    // The 2026-07-05 page batched fetchAgAuthProviders +
    // fetchAGOrgLinkReadiness in a single Promise.all. After
    // 2026-07-08 the readiness round-trip lives inside
    // `getServerRuntimeState`; the page makes a plain
    // fetchAgAuthProviders await without batching.
    expect(PAGE_SOURCE).not.toContain("fetchAGOrgLinkReadiness");
  });

  it("reads the AG CE availability verdict from state.agCEOrgLinkAvailability (no direct derive call)", () => {
    expect(PAGE_SOURCE).toContain("state.agCEOrgLinkAvailability");
    expect(PAGE_SOURCE).not.toContain("deriveAGCEOrgLinkAvailability(");
  });
});

describe("/platform-status — shared-card call site props", () => {
  it('passes actionableTarget.href="/site-admin/org-link/readiness" (drill-in, NOT the link/unlink console)', () => {
    expect(PAGE_SOURCE).toContain('href: "/site-admin/org-link/readiness"');
  });

  it('passes actionableTarget.label="Open readiness"', () => {
    expect(PAGE_SOURCE).toContain('label: "Open readiness"');
  });

  it('passes copyVariant="operational-health"', () => {
    expect(PAGE_SOURCE).toContain('copyVariant="operational-health"');
  });

  it("renders the shared <AGCEOrgLinkAvailabilityCard ... /> JSX call", () => {
    expect(PAGE_SOURCE).toContain("<AGCEOrgLinkAvailabilityCard");
    expect(PAGE_SOURCE).toContain("availability={agCEAvailability}");
  });

  it("the shared card is rendered below the existing AG BackendCard cluster", () => {
    const agBackendCardIdx = PAGE_SOURCE.indexOf('expectedComponent="identuum-ag"');
    const cardIdx = PAGE_SOURCE.indexOf("<AGCEOrgLinkAvailabilityCard");
    expect(agBackendCardIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(agBackendCardIdx);
  });

  it("preserves existing platform status rendering (ModeBadge + BackendCard + AgAuthProviderCard)", () => {
    expect(PAGE_SOURCE).toContain("<ModeBadge ");
    expect(PAGE_SOURCE).toContain("<BackendCard");
    expect(PAGE_SOURCE).toContain("<AgAuthProviderCard ");
  });
});

describe("/platform-status — link/unlink CTAs ABSENT page-wide (read-only)", () => {
  it("page never references the org-link write client / link/unlink forms", () => {
    expect(PAGE_SOURCE).not.toContain("ag-org-link-write-client");
    expect(PAGE_SOURCE).not.toContain("OrgLinkActions");
    expect(PAGE_SOURCE).not.toContain("IDPImportSection");
    expect(PAGE_SOURCE).not.toContain("executeOrganizationImport");
  });

  it("does NOT publish the link/unlink console href anywhere (drill-in only)", () => {
    // /platform-status must point operators to /readiness (drill-in)
    // rather than the link/unlink console. The href that opens the
    // console (/site-admin/org-link without a /readiness suffix)
    // MUST NOT appear in the page source.
    expect(PAGE_SOURCE).not.toMatch(/href="\/site-admin\/org-link"(?!\/)/);
  });

  it("the only /site-admin/org-link* hrefs on the page are the drill-in readiness link(s)", () => {
    const matches = PAGE_SOURCE.match(/href="\/site-admin\/org-link[^"]*"/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toMatch(/^href="\/site-admin\/org-link\/readiness/);
    }
  });
});

describe("/platform-status — token safety invariants", () => {
  it("page source does not read or echo operator token / Authorization header / cookie", () => {
    expect(PAGE_SOURCE).not.toContain("getAgOperatorToken");
    expect(PAGE_SOURCE).not.toContain("AG_COOKIE_NAME");
    expect(PAGE_SOURCE).not.toContain("ag_operator_session");
    expect(PAGE_SOURCE).not.toMatch(/Authorization:\s*`Bearer/);
    expect(PAGE_SOURCE).not.toContain("localStorage");
    expect(PAGE_SOURCE).not.toContain("sessionStorage");
    expect(PAGE_SOURCE).not.toContain("document.cookie");
  });
});
