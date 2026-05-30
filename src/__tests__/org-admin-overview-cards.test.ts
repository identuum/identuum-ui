/**
 * Tests for the org-admin Overview page Sections grid.
 *
 * The bug this regression-guards:
 *   - The Overview page previously rendered Settings and Audit as
 *     PlaceholderCards with a "coming soon" badge, even though both
 *     routes exist and are reachable from the sidebar. Users had to
 *     navigate via the sidebar; the Overview cards were operator-
 *     misleading.
 *   - The fix promotes Settings and Audit to active link cards
 *     (consistent with the Users card), keeps Applications as the
 *     only remaining placeholder (its route is not implemented), and
 *     centralises the matrix in an exported constant so this test
 *     can pin it without scraping JSX.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_ADMIN_OVERVIEW_CARDS } from "../app/org-admin/page";

// ── Card matrix — behavioural pins ─────────────────────────────────────────

describe("ORG_ADMIN_OVERVIEW_CARDS — section grid", () => {
  it("declares exactly the four documented cards in the documented order", () => {
    // Order matters: it mirrors the sidebar order so the operator
    // sees the same shape in both surfaces.
    expect(ORG_ADMIN_OVERVIEW_CARDS.map((c) => c.title)).toEqual([
      "Users",
      "Settings",
      "Audit",
      "Applications",
    ]);
  });

  it("Users card is active and links to /org-admin/users", () => {
    const card = ORG_ADMIN_OVERVIEW_CARDS.find((c) => c.title === "Users");
    expect(card).toBeDefined();
    expect(card?.href).toBe("/org-admin/users");
  });

  it("Settings card is active and links to /org-admin/settings (was: Coming soon)", () => {
    // Load-bearing regression sentry: this is the exact bug the
    // slice fixes. A regression that demoted Settings back to a
    // placeholder would surface here.
    const card = ORG_ADMIN_OVERVIEW_CARDS.find((c) => c.title === "Settings");
    expect(card).toBeDefined();
    expect(card?.href).toBe("/org-admin/settings");
  });

  it("Audit card is active and links to /org-admin/audit (was: Coming soon)", () => {
    // Same regression sentry shape as the Settings test above.
    const card = ORG_ADMIN_OVERVIEW_CARDS.find((c) => c.title === "Audit");
    expect(card).toBeDefined();
    expect(card?.href).toBe("/org-admin/audit");
  });

  it("Applications card is active and links to /org-admin/applications (was: placeholder)", () => {
    // Promoted from placeholder to active in
    // identuum-20260530-org-admin-applications-surface-discovery-and-foundation
    // once the backend was confirmed to expose GET /api/v1/clients
    // with RoleOrgAdmin tenant scoping.
    const card = ORG_ADMIN_OVERVIEW_CARDS.find((c) => c.title === "Applications");
    expect(card).toBeDefined();
    expect(card?.href).toBe("/org-admin/applications");
  });

  it("every card has a non-empty operator description", () => {
    for (const card of ORG_ADMIN_OVERVIEW_CARDS) {
      expect(card.description.length, `card "${card.title}" must have a description`).toBeGreaterThan(0);
    }
  });

  it("every card title is unique (no copy-paste duplication)", () => {
    const titles = ORG_ADMIN_OVERVIEW_CARDS.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("active card hrefs all point inside /org-admin/", () => {
    // Authority-boundary sentry: an Overview card MUST NOT link
    // out to /site-admin/* or /account/settings/* — the page is
    // scoped to the current organization.
    for (const card of ORG_ADMIN_OVERVIEW_CARDS) {
      if (card.href) {
        expect(card.href, `${card.title} href`).toMatch(/^\/org-admin\//);
        expect(card.href).not.toMatch(/^\/site-admin\//);
        expect(card.href).not.toMatch(/^\/account\//);
        expect(card.href).not.toMatch(/^https?:\/\//);
        expect(card.href).not.toMatch(/^\/\//);
      }
    }
  });

  it("descriptions are scoped to within-org context — no cross-org or site-admin authority language", () => {
    // Authority-boundary regression sentry. Mirrors the brute-
    // force misleading-phrase blocklist used by the existing
    // org-admin-settings tests.
    const BANNED: RegExp[] = [
      /\bsite[- ]admin\b/i,
      /\bcross[- ]org\b/i,
      /all organizations/i,
      /system user/i,
      /sovereign bunker override/i,
      /archive organization/i,
      /restore organization/i,
      /hard delete/i,
      /delete organization/i,
    ];
    for (const card of ORG_ADMIN_OVERVIEW_CARDS) {
      for (const pat of BANNED) {
        expect(
          card.description,
          `card "${card.title}" description must not match ${pat}`
        ).not.toMatch(pat);
      }
    }
  });

  it("descriptions never include credential or secret material", () => {
    const BANNED: RegExp[] = [
      /password_hash/i,
      /mfa_secret/i,
      /otpauth:\/\//i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /Set-Cookie/i,
      /\bclaim_token\b/i,
      /recovery code/i,
      /\bapi key\b/i,
      /\bsecret key\b/i,
    ];
    for (const card of ORG_ADMIN_OVERVIEW_CARDS) {
      for (const pat of BANNED) {
        expect(card.description).not.toMatch(pat);
      }
    }
  });
});

// ── Page source contract ───────────────────────────────────────────────────

describe("org-admin/page.tsx — Overview source contract", () => {
  const PAGE_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "page.tsx"),
    "utf-8"
  );
  // Strip comments before badge-count assertions so doc-blocks that
  // legitimately mention the badge strings (as documented behaviour
  // pointers) don't trip the assertions. Real renderable strings
  // survive the strip.
  const PAGE_SRC_NO_COMMENTS = PAGE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    ""
  );

  it("renders ActiveCard for entries with href and PlaceholderCard for entries without", () => {
    // The two branches are gated by `card.href ? <a><ActiveCard …/></a> : <PlaceholderCard …/>`.
    expect(PAGE_SRC).toMatch(
      /card\.href\s*\?\s*\(\s*<a[\s\S]*?<ActiveCard[\s\S]*?\)\s*:\s*\(\s*<PlaceholderCard/
    );
  });

  it("the active link wrapper sets an accessible name via aria-label", () => {
    // Accessibility regression sentry: a screen-reader user must
    // get a non-ambiguous name like "Open Settings", not just the
    // visual card chrome.
    expect(PAGE_SRC).toMatch(/aria-label=\{`Open \$\{card\.title\}`\}/);
  });

  it("the active link wrapper carries a keyboard-visible focus ring (focus-visible:ring)", () => {
    // The link is the focus target; without a visible focus ring,
    // keyboard users cannot see where focus is. We pin the
    // Tailwind class so a future restyle cannot silently drop it.
    expect(PAGE_SRC).toMatch(/focus-visible:ring-2/);
  });

  it("the 'coming soon' badge is rendered ONLY by PlaceholderCard", () => {
    // The string MUST appear exactly once — inside the
    // PlaceholderCard component. A regression that re-introduced
    // it into the ActiveCard or a map literal would surface here.
    const occurrences = (PAGE_SRC_NO_COMMENTS.match(/coming soon/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("the 'open →' badge is rendered ONLY by ActiveCard", () => {
    // Same shape as the above pin — exactly one occurrence,
    // inside the ActiveCard component. A regression that
    // re-introduced the badge into the placeholder would surface
    // here. The "→" glyph means the active/placeholder
    // distinction does not rely on color alone.
    const occurrences = (PAGE_SRC_NO_COMMENTS.match(/open →/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("the page imports the constant the matrix tests pin", () => {
    // If the export name ever changes, the constant tests above
    // would fail at import time. Pin the export name in the page
    // source so the failure mode is "renamed export" not
    // "matrix shape changed".
    expect(PAGE_SRC).toMatch(/export const ORG_ADMIN_OVERVIEW_CARDS/);
  });
});
