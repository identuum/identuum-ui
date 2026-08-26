/**
 * Tests for the /org-admin/users/[id] recent-activity card:
 *   - `buildOrgAdminUserAuditHref(userID, eventType?)` audit-link
 *     construction
 *   - `RECENT_ACTIVITY_COPY` operator-facing strings
 *   - Page-source wiring (page renders the helpers, not inline literals)
 *   - User-detail page metadata negative invariants (no credential
 *     fields rendered, no cross-org/site-admin operator copy leaks)
 *
 * Scope discipline (mirrors the prior helper-extraction tasks):
 *   - The page is a `"use client"`-adjacent server component; vitest
 *     runs in `environment: "node"` without `jsdom` / `happy-dom` /
 *     `@testing-library/react`. Rendering-layer assertions are done
 *     by reading the page source as text and pattern-matching;
 *     end-to-end rendered DOM coverage lives in `e2e/org-admin-smoke.spec.ts`.
 *
 * SECURITY:
 *   - All test inputs are synthetic UUIDs and event-type strings.
 *   - No real audit row, no real user identifier, no real session id.
 *   - Tests do not submit any action, do not mutate any user, do not
 *     touch any IDP endpoint.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOrgAdminUserAuditHref,
  RECENT_ACTIVITY_COPY,
} from "../app/org-admin/users/[id]/user-detail-actions";

// Synthetic UUID-shaped fixtures. The `0000...0001` shape makes the
// strings unmistakably non-real in failure output.
const FIXTURE_USER_ID = "00000000-0000-0000-0000-000000000001";
const FIXTURE_USER_ID_2 = "00000000-0000-0000-0000-000000000002";

// ── buildOrgAdminUserAuditHref — happy paths ─────────────────────────────────

describe("buildOrgAdminUserAuditHref — basic shape", () => {
  it("builds the no-filter href with subject_id only", () => {
    expect(buildOrgAdminUserAuditHref(FIXTURE_USER_ID)).toBe(
      `/org-admin/audit?subject_id=${FIXTURE_USER_ID}`
    );
  });

  it("URI-encodes the user id (UUID hyphens are not reserved but the call MUST go through encodeURIComponent)", () => {
    // Use a hand-crafted id with a literal `:` (reserved) to confirm the
    // encoding path. A regression that string-templated the id without
    // encoding would render the literal `:` in the URL.
    const out = buildOrgAdminUserAuditHref("with:colon");
    expect(out).toBe("/org-admin/audit?subject_id=with%3Acolon");
  });

  it("URI-encodes other reserved characters that could appear in a path or query", () => {
    // `&` would otherwise terminate the query param early; `=` would
    // break the param's value; `#` would start a fragment. All must be
    // percent-encoded.
    const out = buildOrgAdminUserAuditHref("a&b=c#d");
    expect(out).toBe("/org-admin/audit?subject_id=a%26b%3Dc%23d");
  });

  it("returns different output for different user ids (stable per-input)", () => {
    expect(buildOrgAdminUserAuditHref(FIXTURE_USER_ID)).not.toBe(
      buildOrgAdminUserAuditHref(FIXTURE_USER_ID_2)
    );
  });
});

describe("buildOrgAdminUserAuditHref — optional event_type filter", () => {
  it("appends event_type as a query param when provided", () => {
    expect(buildOrgAdminUserAuditHref(FIXTURE_USER_ID, "user.disabled")).toBe(
      `/org-admin/audit?subject_id=${FIXTURE_USER_ID}&event_type=user.disabled`
    );
  });

  it("omits event_type when undefined or empty string", () => {
    expect(buildOrgAdminUserAuditHref(FIXTURE_USER_ID)).toBe(
      `/org-admin/audit?subject_id=${FIXTURE_USER_ID}`
    );
    expect(buildOrgAdminUserAuditHref(FIXTURE_USER_ID, "")).toBe(
      `/org-admin/audit?subject_id=${FIXTURE_USER_ID}`
    );
    expect(buildOrgAdminUserAuditHref(FIXTURE_USER_ID, undefined)).toBe(
      `/org-admin/audit?subject_id=${FIXTURE_USER_ID}`
    );
  });

  it("URI-encodes the event_type value", () => {
    // An event_type string with a dot (`user.disabled`) is safe; one
    // with a slash or query-reserved character MUST be encoded.
    expect(buildOrgAdminUserAuditHref(FIXTURE_USER_ID, "user/disabled")).toContain(
      "event_type=user%2Fdisabled"
    );
    expect(buildOrgAdminUserAuditHref(FIXTURE_USER_ID, "user disabled")).toContain(
      "event_type=user%20disabled"
    );
  });
});

// ── buildOrgAdminUserAuditHref — invariants ──────────────────────────────────

describe("buildOrgAdminUserAuditHref — invariants", () => {
  // Iterate a small set of synthetic inputs to brute-force the
  // negative invariants.
  const SAMPLE_USERS = [
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "deadbeef-dead-beef-dead-beefdeadbeef",
  ];
  const SAMPLE_EVENT_TYPES: Array<string | undefined> = [
    undefined,
    "",
    "user.disabled",
    "user.enabled",
    "user.invited",
  ];

  it("href is ALWAYS rooted at /org-admin/audit (never /site-admin/audit)", () => {
    // The org-admin authority surface is /org-admin/*. A regression
    // that pointed the audit link at the site-admin shell would (a)
    // 403 in the browser because the org-admin lacks site-admin role
    // AND (b) silently imply org_admin has cross-tenant authority,
    // violating the Blind Sovereign Bunker boundary.
    for (const u of SAMPLE_USERS) {
      for (const e of SAMPLE_EVENT_TYPES) {
        const out = buildOrgAdminUserAuditHref(u, e);
        expect(out.startsWith("/org-admin/audit?")).toBe(true);
        expect(out).not.toMatch(/^\/site-admin\//);
        expect(out).not.toMatch(/site_admin/);
      }
    }
  });

  it("href is ALWAYS relative — no scheme, no protocol-relative leading //", () => {
    for (const u of SAMPLE_USERS) {
      for (const e of SAMPLE_EVENT_TYPES) {
        const out = buildOrgAdminUserAuditHref(u, e);
        expect(out.startsWith("/")).toBe(true);
        expect(out).not.toMatch(/^https?:\/\//);
        expect(out).not.toMatch(/^\/\//);
      }
    }
  });

  it("href ALWAYS contains the subject_id query param exactly once", () => {
    for (const u of SAMPLE_USERS) {
      for (const e of SAMPLE_EVENT_TYPES) {
        const out = buildOrgAdminUserAuditHref(u, e);
        const matches = out.match(/subject_id=/g) ?? [];
        expect(matches.length).toBe(1);
      }
    }
  });

  it("href ALWAYS sets subject_type to the user surface (NOT organization or any cross-tenant type)", () => {
    // Subject-type discipline: the audit-link from a user-detail page
    // MUST scope the audit shell to the user as subject. Today the
    // helper omits the param because the org-admin audit page
    // defaults to subject_type=user when subject_id is a UUID. Pin
    // the negative invariant: the helper must NOT inject a different
    // subject_type that would broaden the operator's view.
    for (const u of SAMPLE_USERS) {
      const out = buildOrgAdminUserAuditHref(u);
      expect(out).not.toMatch(/subject_type=organization/);
      expect(out).not.toMatch(/subject_type=tenant/);
      expect(out).not.toMatch(/subject_type=client/);
      expect(out).not.toMatch(/subject_type=system/);
    }
  });
});

// ── RECENT_ACTIVITY_COPY — exact copy pins ───────────────────────────────────

describe("RECENT_ACTIVITY_COPY — exact copy pin", () => {
  it("title exactly matches the documented card heading", () => {
    expect(RECENT_ACTIVITY_COPY.title).toBe("Recent activity");
  });

  it("subtitle names the user-as-subject scope", () => {
    expect(RECENT_ACTIVITY_COPY.subtitle).toBe(
      "Latest audit events where this user is the subject."
    );
    expect(RECENT_ACTIVITY_COPY.subtitle).toMatch(/where this user is the subject/i);
  });

  it("viewAllLabel uses the → arrow glyph (not a literal '->' typo)", () => {
    expect(RECENT_ACTIVITY_COPY.viewAllLabel).toBe("View all →");
    expect(RECENT_ACTIVITY_COPY.viewAllLabel).toMatch(/→$/);
    // Common regression: someone replaces the unicode arrow with `->`
    expect(RECENT_ACTIVITY_COPY.viewAllLabel).not.toMatch(/->/);
  });

  it("the copy bundle has exactly the three known keys (allowlist key shape)", () => {
    const keys = Object.keys(RECENT_ACTIVITY_COPY).sort();
    expect(keys).toEqual(["subtitle", "title", "viewAllLabel"]);
  });
});

// ── RECENT_ACTIVITY_COPY — boundary + credential negative invariants ──────────

describe("RECENT_ACTIVITY_COPY — negative invariants", () => {
  const ALL_COPY = [
    RECENT_ACTIVITY_COPY.title,
    RECENT_ACTIVITY_COPY.subtitle,
    RECENT_ACTIVITY_COPY.viewAllLabel,
  ];

  // Phrases that would imply org_admin can reach into site_admin or
  // cross-org authority. The recent-activity card is scoped to ONE
  // user in the operator's own org; none of these phrases belong.
  const MISLEADING_PHRASES = [
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

  const CREDENTIAL_TERMS = [
    /password_hash/i,
    /mfa_secret/i,
    /otpauth:\/\//i,
    /Bearer\s+[A-Za-z0-9._-]{8,}/,
    /Set-Cookie/i,
    /session\s+validator/i,
    /reset\s+token/i,
    /claim_token/i,
    /recovery\s+code/i,
    /recovery_codes/i,
  ];

  it("no recent-activity copy string contains site_admin / cross-org / cross-tenant wording", () => {
    for (const s of ALL_COPY) {
      for (const pat of MISLEADING_PHRASES) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });

  it("no recent-activity copy string contains credential-material or recovery-code terms", () => {
    for (const s of ALL_COPY) {
      for (const pat of CREDENTIAL_TERMS) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });
});

// ── Page source wiring + metadata-rendering negative invariants ──────────────

describe("Page source — wiring + metadata negative invariants", () => {
  // Strip JS comments before scanning operator-facing patterns so
  // doc-blocks that legitimately reference boundary terms in code
  // comments do not trip the blocklist.
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  function readSrc(rel: string): string {
    return readFileSync(
      resolve(__dirname, "..", "app", "org-admin", "users", "[id]", rel),
      "utf-8"
    );
  }

  const PAGE_SRC = readSrc("page.tsx");
  const PAGE_SRC_NO_COMMENTS = stripComments(PAGE_SRC);
  const HELPER_SRC = readSrc("user-detail-actions.ts");
  const HELPER_SRC_NO_COMMENTS = stripComments(HELPER_SRC);

  it("page.tsx imports RECENT_ACTIVITY_COPY and buildOrgAdminUserAuditHref from the helper module", () => {
    expect(PAGE_SRC).toMatch(
      /import\s*\{[\s\S]*?RECENT_ACTIVITY_COPY[\s\S]*?\}\s*from\s+["']\.\/user-detail-actions["']/
    );
    expect(PAGE_SRC).toMatch(
      /import\s*\{[\s\S]*?buildOrgAdminUserAuditHref[\s\S]*?\}\s*from\s+["']\.\/user-detail-actions["']/
    );
  });

  it("page.tsx references each RECENT_ACTIVITY_COPY field at least once", () => {
    expect(PAGE_SRC).toMatch(/RECENT_ACTIVITY_COPY\.title/);
    expect(PAGE_SRC).toMatch(/RECENT_ACTIVITY_COPY\.subtitle/);
    expect(PAGE_SRC).toMatch(/RECENT_ACTIVITY_COPY\.viewAllLabel/);
  });

  it("page.tsx calls buildOrgAdminUserAuditHref(id) for the View all link", () => {
    expect(PAGE_SRC).toMatch(/buildOrgAdminUserAuditHref\(\s*id\s*\)/);
  });

  it("page.tsx no longer contains the inline literal Recent-activity strings", () => {
    // After extraction, the previous inline literals must NOT survive
    // in the page source. Operator-facing strings come exclusively
    // from the constants.
    expect(PAGE_SRC).not.toMatch(/"Recent activity"/);
    expect(PAGE_SRC).not.toMatch(/"Latest audit events where this user is the subject\.?"/);
    expect(PAGE_SRC).not.toMatch(/"View all →"/);
  });

  it("page.tsx no longer contains the inline literal audit-href template string", () => {
    // The string `audit?subject_id=` should appear ONLY inside the
    // helper module, never as a template literal in page.tsx. A
    // regression that re-inlined the construction would diverge from
    // the helper's URI-encoding contract.
    expect(PAGE_SRC).not.toMatch(/\/org-admin\/audit\?subject_id=\$\{/);
  });

  it("page.tsx renders NO credential-material field labels in the operator-facing strings (post-comment-strip)", () => {
    // The user-detail metadata table renders Email / Display name /
    // Role / Status / Email verified / MFA / Joined / Last login.
    // None of these should expose credential fields. We scan the
    // post-comment source for the documented field-name terms.
    const CRED_FIELD_NAMES = [
      /password_hash/i,
      /\bmfa_secret\b/i,
      /otpauth:\/\//i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /Set-Cookie/i,
      /session_validator/i,
      /\breset_token\b/i,
      /\bclaim_token\b/i,
      /\brecovery_codes\b/i,
    ];
    for (const pat of CRED_FIELD_NAMES) {
      expect(PAGE_SRC_NO_COMMENTS, `page must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("helper module's recent-activity helpers contain no credential-material literals", () => {
    // Belt-and-suspenders on the helper side. The new RECENT_ACTIVITY_COPY
    // and buildOrgAdminUserAuditHref live in user-detail-actions.ts;
    // confirm no credential string was pasted into the helper file.
    const CREDENTIAL_TERMS = [
      /password_hash/i,
      /mfa_secret/i,
      /otpauth:\/\//i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /Set-Cookie/i,
      /session_validator/i,
      /reset_token/i,
      /claim_token/i,
      /recovery_codes/i,
    ];
    for (const pat of CREDENTIAL_TERMS) {
      expect(HELPER_SRC_NO_COMMENTS, `helper must not match ${pat}`).not.toMatch(pat);
    }
  });
});

// ── User-detail metadata projection — documented fields only ─────────────────

describe("User-detail metadata — documented fields render, credential fields never appear", () => {
  // The page renders a defined set of labels in <DetailRow label="…">
  // calls. Pin the documented set; assert credential fields are NOT
  // in the page source as labels. This catches a regression that
  // added a credential field to the rendered metadata table.

  const PAGE_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "users", "[id]", "page.tsx"),
    "utf-8"
  );

  // Each label string the page renders inside <DetailRow label="…">.
  const EXPECTED_METADATA_LABELS = [
    "Email",
    "Display name",
    "Role",
    "Status",
    "Email verified",
    "MFA",
    "Joined",
    "Last login",
    "Invitation",
  ];

  it("every documented metadata label appears as a DetailRow label in the page source", () => {
    for (const label of EXPECTED_METADATA_LABELS) {
      const pat = new RegExp(`label="${label}"`);
      expect(PAGE_SRC, `expected DetailRow label="${label}" in page source`).toMatch(pat);
    }
  });

  const FORBIDDEN_METADATA_LABELS = [
    "Password",
    "Password hash",
    "MFA secret",
    "TOTP secret",
    "Recovery codes",
    "Session token",
    "Bearer token",
    "Cookie",
    "Set-Cookie",
    "Claim token",
    "Reset token",
    "API key",
  ];

  it("no credential-bearing metadata label appears in the page source", () => {
    for (const forbidden of FORBIDDEN_METADATA_LABELS) {
      const pat = new RegExp(`label="${forbidden}"`);
      expect(PAGE_SRC, `forbidden DetailRow label="${forbidden}" must not appear`).not.toMatch(pat);
    }
  });
});

// ── Per-row clickable behaviour (slice: recent-activity-clickable) ─────────
//
// The bug this regression-guards:
//   - Recent activity rows on /org-admin/users/[id] used to render
//     as static <div> rows. The operator had a "View all →" link in
//     the card header but no per-row navigation to a filtered audit
//     view. Each row now renders as an <a> wrapping the row content
//     and pointing at /org-admin/audit filtered by subject_id +
//     event_type via buildOrgAdminUserAuditHref. The audit page in
//     turn (a separate slice change) now READS subject_id from its
//     query params and passes it to listAuditEvents.

describe("Recent activity card — per-row clickable links", () => {
  const PAGE_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "users", "[id]", "page.tsx"),
    "utf-8"
  );

  it("each recent-activity row is wrapped in an <a> anchor (was: static <div>)", () => {
    // The exact rendering shape: <li><a href={...} aria-label={...}>...</a></li>.
    expect(PAGE_SRC).toMatch(
      /<li[\s\S]*?<a[\s\S]*?href=\{\s*rowHref\s*\}[\s\S]*?aria-label=\{\s*ariaLabel\s*\}/
    );
  });

  it("the row href is built via buildOrgAdminUserAuditHref(id, e.event_type)", () => {
    // Pin both the helper AND the event-type filter argument. A
    // regression that dropped the event_type filter would still
    // navigate to the subject-filtered audit page, but the
    // per-row context would be weaker.
    expect(PAGE_SRC).toMatch(
      /const\s+rowHref\s*=\s*buildOrgAdminUserAuditHref\(\s*id\s*,\s*e\.event_type\s*\)/
    );
  });

  it("the accessible name includes the event_type so screen-reader users know where the click goes", () => {
    expect(PAGE_SRC).toMatch(/const\s+ariaLabel\s*=\s*`View audit event \$\{e\.event_type\}/);
  });

  it("the anchor exposes a visible keyboard-focus indicator (focus-visible:ring)", () => {
    // Find the rowHref anchor block specifically (the page also has
    // a "View all →" anchor; we only need to pin the per-row one).
    const rowAnchorMatch = PAGE_SRC.match(/href=\{\s*rowHref\s*\}[\s\S]*?className="([^"]+)"/);
    expect(rowAnchorMatch).not.toBeNull();
    const cls = rowAnchorMatch?.[1] ?? "";
    expect(cls, "row anchor must carry a focus-visible ring class").toMatch(/focus-visible:ring-2/);
  });

  it("compact rows render ONLY event_type / actor display / formatted timestamp — no raw metadata", () => {
    // Find the per-row JSX block (between the `<li key={i}>` line
    // and the next `</li>` closer at the row level) and assert it
    // does NOT reference any sensitive payload field.
    const liMatch = PAGE_SRC.match(/<li key=\{i\}>[\s\S]*?<\/li>/);
    expect(liMatch).not.toBeNull();
    const block = liMatch?.[0] ?? "";
    // None of these substrings may appear in a compact row.
    const BANNED: RegExp[] = [
      /metadata/i,
      /ip_address/i,
      /user_agent/i,
      /\bsession_token\b/i,
      /\brefresh_token\b/i,
      /\bsession_id\b/i,
      /\bpassword\b/i,
      /\btotp\b/i,
      /\bsecret\b/i,
      /clientDataJSON/i,
      /authenticatorData/i,
      /attestationObject/i,
      /\btoken\b/i,
      /\bcookie\b/i,
      /Set-Cookie/i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
    ];
    for (const pat of BANNED) {
      expect(block, `recent-activity row must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("actor display uses 'Actor:' label (was: ambiguous 'by')", () => {
    // The previous render said "by ~ dbda5d19" — the leading "by"
    // alone was ambiguous (who is the actor vs the subject?). The
    // new render labels the field "Actor:" so the operator knows
    // immediately which side of the event they are looking at.
    expect(PAGE_SRC).toMatch(/<span>Actor:<\/span>/);
    // Negative: the bare lowercase "by" prefix on the actor row
    // is gone. Use a tightly anchored regex so the word "by" in
    // unrelated copy elsewhere on the page does not trip the
    // assertion.
    expect(PAGE_SRC).not.toMatch(/<span>by<\/span>/);
  });

  it("the row anchor does NOT inline any raw audit-event field as a query param other than event_type", () => {
    // The helper's contract is `?subject_id=<userID>&event_type=<eventType>`.
    // A regression that started appending e.g. &actor_email=... or
    // &ip_address=... would broadly leak metadata into the URL — a
    // surveillance risk and a logging risk.
    const liMatch = PAGE_SRC.match(/<li key=\{i\}>[\s\S]*?<\/li>/);
    const block = liMatch?.[0] ?? "";
    expect(block).not.toMatch(/&actor_email=/);
    expect(block).not.toMatch(/&actor_id=/);
    expect(block).not.toMatch(/&subject_email=/);
    expect(block).not.toMatch(/&ip_address=/);
    expect(block).not.toMatch(/&user_agent=/);
    expect(block).not.toMatch(/&session_id=/);
  });
});

// ── Org-admin audit page now reads subject_id (sibling slice change) ──────
//
// The recent-activity card's per-row link is useless unless the
// audit page actually filters by subject_id. Pin the page-source
// contract: subject_id is read, threaded into listAuditEvents, and
// preserved across pagination + filter-form submissions.

describe("/org-admin/audit page — subject_id filter support", () => {
  const AUDIT_PAGE_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "audit", "page.tsx"),
    "utf-8"
  );

  it("parses subject_id from the search params (UUID-length clamp)", () => {
    expect(AUDIT_PAGE_SRC).toMatch(/str\(params,\s*["']subject_id["']\s*,\s*36\)/);
  });

  it("passes subject_id to listAuditEvents", () => {
    // The key is included as a property in the listAuditEvents call.
    expect(AUDIT_PAGE_SRC).toMatch(/listAuditEvents\([\s\S]*?subjectId[\s\S]*?\)/);
  });

  it("preserves subject_id in pagination hrefs", () => {
    // pageHref signature must accept subjectId AND the call sites
    // must thread it.
    expect(AUDIT_PAGE_SRC).toMatch(
      /function pageHref\(page:\s*number,\s*filters:\s*AuditFilterValues,\s*subjectId\?:\s*string \| null\)/
    );
    // Pagination link constructions pass subjectId — at least one
    // hasPrev/hasNext/sortHref site must invoke pageHref with the
    // three-arg form.
    expect(AUDIT_PAGE_SRC).toMatch(/pageHref\([^)]*,[^)]*,\s*subjectId\)/);
  });

  it("threads subjectId into the AuditFilterPanel so filter-form submits preserve it", () => {
    expect(AUDIT_PAGE_SRC).toMatch(/<AuditFilterPanel[\s\S]*?subjectId=\{\s*subjectId\s*\}/);
  });

  it("renders an 'Active subject filter' notice with a Clear-filter affordance", () => {
    // Pin both the banner copy and the clear-filter href so a
    // regression that dropped either would surface here.
    expect(AUDIT_PAGE_SRC).toMatch(/Subject filter active:/);
    expect(AUDIT_PAGE_SRC).toMatch(/Clear subject filter/);
    // The clear link points at the bare audit path (no query
    // string) so clicking it drops EVERY filter, not just
    // subject_id. A future slice could refine to a partial clear.
    expect(AUDIT_PAGE_SRC).toMatch(/href=\{?BASE_PATH\}?[\s\S]*?Clear subject filter/);
  });
});
