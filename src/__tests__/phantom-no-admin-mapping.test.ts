/**
 * PHANTOM-NO-ADMIN source pins — ABSENT ≠ NEGATIVE at the mapping sites.
 *
 * Root cause fenced here: `has_admin: Boolean(o.is_claimed)` in
 * src/lib/idp-admin-client.ts coerced an ABSENT backend field
 * (Boolean(undefined) → false) into a hard "no administrator" claim, so
 * every org rendered "No active administrator" with an Assign
 * affordance. These pins hold the mapping sites to the preserving form
 * (`typeof … === "boolean" ? … : undefined`) and the consuming surfaces
 * to strict-negative gates, so the coercion cannot silently return.
 *
 * Source-invariant style (see setup-wizard-source-invariants.test.ts):
 * reads the files as text; no React rendering.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("idp-admin-client — admin state is never Boolean()-coerced", () => {
  const client = src("lib/idp-admin-client.ts");

  it("the Boolean(o.is_claimed) coercion is gone from every mapping site", () => {
    expect(client).not.toContain("Boolean(o.is_claimed)");
    expect(client).not.toContain("Boolean(o.can_assign_admin)");
  });

  it("all three org mappers preserve absence with a typeof guard", () => {
    const guards = client.match(/typeof o\.is_claimed === "boolean" \? o\.is_claimed : undefined/g);
    // listOrganizations, getOrganization, getOwnOrganization
    expect(guards?.length).toBe(3);
    const canAssignGuards = client.match(
      /typeof o\.can_assign_admin === "boolean" \? o\.can_assign_admin : undefined/g
    );
    // listOrganizations, getOrganization (getOwnOrganization pins false by design)
    expect(canAssignGuards?.length).toBe(2);
  });
});

describe("consuming surfaces gate on provable negatives, not absent state", () => {
  it("assign-admin page blocks undefined admin state before the canAssign gate", () => {
    const page = src("app/site-admin/organizations/[id]/assign-admin/page.tsx");
    expect(page).toContain("org.has_admin === undefined");
    expect(page).toContain("Administrator status unavailable");
  });

  it("organizations list gates the Assign affordance on strict negatives", () => {
    const list = src("app/site-admin/organizations/client.tsx");
    expect(list).toContain("org.has_admin === false || org.can_assign_admin === true");
    // The badge has an explicit unknown branch.
    expect(list).toContain('"Status unknown"');
  });

  it("org detail page has an explicit unavailable branch, never a phantom No admin", () => {
    const detail = src("app/site-admin/organizations/[id]/page.tsx");
    expect(detail).toContain("org.has_admin === undefined");
    expect(detail).toContain("Administrator status unavailable");
    expect(detail).toContain("Admin status unknown");
  });

  it("org-link page renders no-admin only on a provable false", () => {
    const orgLink = src("app/site-admin/org-link/page.tsx");
    expect(orgLink).toContain("o.has_admin === false");
    expect(orgLink).not.toContain("{!o.has_admin &&");
  });
});
