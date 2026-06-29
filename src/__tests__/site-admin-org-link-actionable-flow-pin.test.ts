/**
 * site-admin-org-link-actionable-flow-pin.test.ts
 *
 * 2026-07-04 cross-reference pin between the AG CE actionable
 * availability card landed in 2026-07-03 and the existing
 * `/site-admin/org-link` console it links to. Updated 2026-07-06 to
 * pin the readiness page's PROPS to the shared
 * `AGCEOrgLinkAvailabilityCard` component (the card body itself
 * lives in `src/components/shared/ag-ce-org-link-availability-card.tsx`
 * post-refactor).
 *
 * Acceptance criteria covered:
 *   - The readiness page passes
 *     `actionableTarget.href="/site-admin/org-link"` to the shared
 *     card so the actionable variant resolves to the canonical
 *     console.
 *   - The actionable target on disk (`/site-admin/org-link/page.tsx`)
 *     still exists and still owns the operator-cookie-authenticated
 *     link/unlink + IDP-import affordances (`OrgLinkActions`,
 *     `IDPImportSection`).
 *   - The console reaches AG via the canonical server-side cookie
 *     path (`ag-client.ts` → `agRequest` + `getAgOperatorToken`) —
 *     no browser-visible token storage.
 *   - The readiness page passes `copyVariant="action-planning"` so
 *     the verbose action-planning copy is rendered (vs the briefer
 *     operational-health copy used by /platform-status).
 *
 * No new UI pages, no new operator-token UI, no AG CE source/runtime
 * changes are introduced or required by this pin.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");

const READINESS_PAGE_PATH = resolve(SRC_ROOT, "app/site-admin/org-link/readiness/page.tsx");
const CONSOLE_PAGE_PATH = resolve(SRC_ROOT, "app/site-admin/org-link/page.tsx");
const CONSOLE_ACTIONS_PATH = resolve(SRC_ROOT, "app/site-admin/org-link/org-link-actions.tsx");
const AG_CLIENT_PATH = resolve(SRC_ROOT, "lib/ag-client.ts");
const WRITE_CLIENT_PATH = resolve(SRC_ROOT, "lib/ag-org-link-write-client.ts");

const READINESS_SOURCE = readFileSync(READINESS_PAGE_PATH, "utf-8");
const CONSOLE_SOURCE = readFileSync(CONSOLE_PAGE_PATH, "utf-8");
const ACTIONS_SOURCE = readFileSync(CONSOLE_ACTIONS_PATH, "utf-8");
const AG_CLIENT_SOURCE = readFileSync(AG_CLIENT_PATH, "utf-8");
const WRITE_CLIENT_SOURCE = readFileSync(WRITE_CLIENT_PATH, "utf-8");

describe("AG CE actionable link cross-reference — 2026-07-04 pin (post-2026-07-06 refactor)", () => {
  it('the readiness page passes actionableTarget.href="/site-admin/org-link" to the shared card', () => {
    expect(READINESS_SOURCE).toContain('href: "/site-admin/org-link"');
  });

  it('the readiness page passes actionableTarget.label="Open the org-link console"', () => {
    expect(READINESS_SOURCE).toContain('label: "Open the org-link console"');
  });

  it('the readiness page passes copyVariant="action-planning" (verbose action-planning copy)', () => {
    expect(READINESS_SOURCE).toContain('copyVariant="action-planning"');
  });

  it("the canonical console route exists on disk at the asserted path", () => {
    expect(existsSync(CONSOLE_PAGE_PATH)).toBe(true);
  });

  it("the console page is the App Router server component that owns the link/unlink + import affordances", () => {
    expect(CONSOLE_SOURCE).toMatch(/export default async function OrgLinkPlanPage\(/);
    expect(CONSOLE_SOURCE).toContain("OrgLinkActions");
    expect(CONSOLE_SOURCE).toContain("IDPImportSection");
    expect(CONSOLE_SOURCE).toContain('from "./org-link-actions"');
  });

  it("the org-link console reaches AG via the authenticated cookie path (hasAgSession + ag-org-client)", () => {
    expect(CONSOLE_SOURCE).toContain('from "@/lib/ag-client"');
    expect(CONSOLE_SOURCE).toContain("hasAgSession");
    expect(CONSOLE_SOURCE).toContain("fetchAGOrgLinkPlan");
  });
});

describe("/site-admin/org-link console — operator-cookie authenticated path still owned by ag-client.ts", () => {
  it("ag-client.ts reads the operator session via HttpOnly cookie (never browser-visible)", () => {
    expect(AG_CLIENT_SOURCE).toContain('import "server-only"');
    expect(AG_CLIENT_SOURCE).toContain('export const AG_COOKIE_NAME = "ag_operator_session"');
    expect(AG_CLIENT_SOURCE).toContain("getAgOperatorToken");
    expect(AG_CLIENT_SOURCE).toContain("agRequest");
    expect(AG_CLIENT_SOURCE).toMatch(/Authorization:\s*`Bearer\s+\$\{token\}`/);
  });

  it("the org-link write client uses the same authenticated agRequest path (no new credential channel)", () => {
    expect(WRITE_CLIENT_SOURCE).toContain('import "server-only"');
    expect(WRITE_CLIENT_SOURCE).toContain('from "./ag-client"');
    expect(WRITE_CLIENT_SOURCE).toContain("agRequest");
    expect(WRITE_CLIENT_SOURCE).toContain("getAgOperatorToken");
  });

  it("the console page does not introduce browser-visible operator-token storage", () => {
    expect(CONSOLE_SOURCE).not.toContain("getAgOperatorToken");
    expect(CONSOLE_SOURCE).not.toContain("AG_COOKIE_NAME");
    expect(CONSOLE_SOURCE).not.toContain("ag_operator_session");
    expect(CONSOLE_SOURCE).not.toMatch(/Authorization:\s*`Bearer/);
    expect(CONSOLE_SOURCE).not.toContain("localStorage");
    expect(CONSOLE_SOURCE).not.toContain("sessionStorage");
    expect(CONSOLE_SOURCE).not.toContain("document.cookie");
  });

  it("the org-link-actions component does not introduce browser-visible operator-token storage", () => {
    expect(ACTIONS_SOURCE).not.toContain("getAgOperatorToken");
    expect(ACTIONS_SOURCE).not.toContain("AG_COOKIE_NAME");
    expect(ACTIONS_SOURCE).not.toContain("ag_operator_session");
    expect(ACTIONS_SOURCE).not.toMatch(/Authorization:\s*`Bearer/);
    expect(ACTIONS_SOURCE).not.toContain("localStorage");
    expect(ACTIONS_SOURCE).not.toContain("sessionStorage");
    expect(ACTIONS_SOURCE).not.toContain("document.cookie");
  });
});

describe("Readiness page — shared-card import + no inline-card regression", () => {
  it("imports the shared AGCEOrgLinkAvailabilityCard component", () => {
    expect(READINESS_SOURCE).toContain(
      'import { AGCEOrgLinkAvailabilityCard } from "@/components/shared/ag-ce-org-link-availability-card"'
    );
  });

  it("does NOT re-define an inline AGCEOrgLinkAvailabilityCard function in the page", () => {
    expect(READINESS_SOURCE).not.toMatch(/^function AGCEOrgLinkAvailabilityCard\b/m);
  });

  it("does NOT inline the variant switch in the page (it lives in the shared component)", () => {
    expect(READINESS_SOURCE).not.toContain('case "actionable"');
    expect(READINESS_SOURCE).not.toContain('case "readiness_pending"');
    expect(READINESS_SOURCE).not.toContain('case "capability_missing"');
    expect(READINESS_SOURCE).not.toContain('case "readiness_unknown"');
  });
});
