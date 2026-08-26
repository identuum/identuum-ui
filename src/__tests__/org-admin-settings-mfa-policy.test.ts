/**
 * Tests for the /org-admin/settings MFA policy form + page-level
 * operator copy + Domains/Invite-policy placeholder cards.
 *
 * Scope discipline (mirrors the prior helper-extraction tasks):
 *   - `mfa-policy-form.tsx` is a `"use client"` React component using
 *     `useActionState`; vitest runs in `environment: "node"` without
 *     `jsdom`/`happy-dom`/`@testing-library/react`. Rendering-layer
 *     assertions are done by reading source files as text and
 *     pattern-matching; end-to-end rendered DOM coverage is left to a
 *     non-destructive Playwright follow-up (the local-demo org_admin
 *     fixture is currently stale, so adding Playwright in this task
 *     would be premature).
 *
 * SECURITY:
 *   - All test inputs are synthetic policy strings (`optional`,
 *     `required`, and obviously-invalid sentinels for negative cases).
 *   - No HTTP call, no MFA policy mutation, no organization settings
 *     update.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MFAPolicy } from "../app/org-admin/settings/actions";
import {
  getOrgAdminMfaPolicyLabel,
  ORG_ADMIN_MFA_FORM_COPY,
  ORG_ADMIN_MFA_POLICY_OPTIONS,
  ORG_ADMIN_SETTINGS_PAGE_COPY,
  ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE,
  ORG_ADMIN_SETTINGS_PLACEHOLDERS,
} from "../app/org-admin/settings/settings-helpers";

// ── MFA policy options ───────────────────────────────────────────────────────

describe("ORG_ADMIN_MFA_POLICY_OPTIONS — option allowlist", () => {
  it("contains exactly two options in the documented order (optional, required)", () => {
    expect(ORG_ADMIN_MFA_POLICY_OPTIONS.map((o) => o.value)).toEqual(["optional", "required"]);
  });

  it("every option has the documented three-field shape", () => {
    for (const opt of ORG_ADMIN_MFA_POLICY_OPTIONS) {
      expect(Object.keys(opt).sort()).toEqual(["description", "label", "value"]);
      expect(typeof opt.value).toBe("string");
      expect(typeof opt.label).toBe("string");
      expect(typeof opt.description).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.description.length).toBeGreaterThan(0);
    }
  });

  it("optional option uses the documented label and description", () => {
    const opt = ORG_ADMIN_MFA_POLICY_OPTIONS.find((o) => o.value === "optional");
    expect(opt).toBeDefined();
    expect(opt?.label).toBe("Optional");
    expect(opt?.description).toBe(
      "Users may enroll MFA at any time, but are not required to do so before signing in."
    );
  });

  it("required option uses the documented label and description, and explicitly mentions the session-revoke side effect", () => {
    const opt = ORG_ADMIN_MFA_POLICY_OPTIONS.find((o) => o.value === "required");
    expect(opt).toBeDefined();
    expect(opt?.label).toBe("Required");
    expect(opt?.description).toBe(
      "Users must enroll and complete MFA before login can finish. Existing sessions without MFA are revoked at next sign-in."
    );
    // The side-effect copy is operator-critical — a regression that
    // softened "revoked at next sign-in" to a generic "may be affected"
    // would leave operators surprised when sessions terminate.
    expect(opt?.description).toMatch(/revoked at next sign-in/);
  });
});

describe("getOrgAdminMfaPolicyLabel — label lookup", () => {
  it("returns 'Optional' for 'optional'", () => {
    expect(getOrgAdminMfaPolicyLabel("optional")).toBe("Optional");
  });

  it("returns 'Required' for 'required'", () => {
    expect(getOrgAdminMfaPolicyLabel("required")).toBe("Required");
  });

  it("returns the input verbatim for an unknown policy value (safe fallback)", () => {
    // The function gracefully falls through to the raw string when the
    // input is not in the allowlist. A regression that crashed or
    // returned `undefined` here would break the page if the IDP ever
    // returned a future policy value the UI didn't know about.
    expect(getOrgAdminMfaPolicyLabel("future-policy" as MFAPolicy)).toBe("future-policy");
  });
});

// ── MFA-form copy ────────────────────────────────────────────────────────────

describe("ORG_ADMIN_MFA_FORM_COPY — exact form copy pins", () => {
  it("successBanner exactly matches the documented copy", () => {
    expect(ORG_ADMIN_MFA_FORM_COPY.successBanner).toBe("MFA policy updated successfully.");
  });

  it("saveLabel is 'Save policy' (NOT 'Save changes' or 'Update')", () => {
    // Specific copy is operator-critical — generic verbs would not
    // tell the operator which policy they're saving.
    expect(ORG_ADMIN_MFA_FORM_COPY.saveLabel).toBe("Save policy");
  });

  it("savingLabel uses the unicode ellipsis (…) not three dots (...)", () => {
    expect(ORG_ADMIN_MFA_FORM_COPY.savingLabel).toBe("Saving…");
    expect(ORG_ADMIN_MFA_FORM_COPY.savingLabel).toMatch(/…$/);
    expect(ORG_ADMIN_MFA_FORM_COPY.savingLabel).not.toMatch(/\.\.\.$/);
  });

  it("legend names the policy (sr-only legend for the radio group)", () => {
    expect(ORG_ADMIN_MFA_FORM_COPY.legend).toBe("MFA policy");
  });

  it("the copy bundle has exactly the four known keys (allowlist key shape)", () => {
    const keys = Object.keys(ORG_ADMIN_MFA_FORM_COPY).sort();
    expect(keys).toEqual(["legend", "saveLabel", "savingLabel", "successBanner"]);
  });
});

// ── Page-level copy ──────────────────────────────────────────────────────────

describe("ORG_ADMIN_SETTINGS_PAGE_COPY — page-level operator copy", () => {
  it("pageHeading is exactly 'Organization settings'", () => {
    expect(ORG_ADMIN_SETTINGS_PAGE_COPY.pageHeading).toBe("Organization settings");
  });

  it("pageSubtitle scopes to 'your organization' (NOT 'all organizations' or 'the system')", () => {
    expect(ORG_ADMIN_SETTINGS_PAGE_COPY.pageSubtitle).toBe(
      "Configuration and policies for your organization."
    );
    expect(ORG_ADMIN_SETTINGS_PAGE_COPY.pageSubtitle).toMatch(/your organization/i);
  });

  it("profileCardTitle and profileCardSubtitle describe the Organization profile card", () => {
    expect(ORG_ADMIN_SETTINGS_PAGE_COPY.profileCardTitle).toBe("Organization profile");
    expect(ORG_ADMIN_SETTINGS_PAGE_COPY.profileCardSubtitle).toBe(
      "Update your organization's display name."
    );
  });

  it("securityCardTitle and securityCardSubtitle describe the MFA policy card", () => {
    expect(ORG_ADMIN_SETTINGS_PAGE_COPY.securityCardTitle).toBe("Security policy");
    expect(ORG_ADMIN_SETTINGS_PAGE_COPY.securityCardSubtitle).toBe(
      "Control whether multi-factor authentication is required for members of your organization."
    );
    // Scoping pin: subtitle MUST name "your organization", not "the
    // system" or "all organizations".
    expect(ORG_ADMIN_SETTINGS_PAGE_COPY.securityCardSubtitle).toMatch(/your organization/i);
  });

  it("the copy bundle has exactly the six known keys (allowlist key shape)", () => {
    const keys = Object.keys(ORG_ADMIN_SETTINGS_PAGE_COPY).sort();
    expect(keys).toEqual([
      "pageHeading",
      "pageSubtitle",
      "profileCardSubtitle",
      "profileCardTitle",
      "securityCardSubtitle",
      "securityCardTitle",
    ]);
  });
});

// ── Placeholder cards ────────────────────────────────────────────────────────

describe("ORG_ADMIN_SETTINGS_PLACEHOLDERS — Domains is no longer a placeholder", () => {
  it("is empty after slice-1 of the org-admin Domains UI (Domains was promoted to a real card)", () => {
    // Slice 1 of the org-admin Domains UI replaced the previous Domains
    // placeholder with the DomainsCard component backed by the IDP's
    // organization_domains endpoints. The placeholder list is now empty;
    // the type + badge constant remain so a future placeholder can be
    // added without re-introducing a different rendering path.
    expect(ORG_ADMIN_SETTINGS_PLACEHOLDERS).toEqual([]);
  });

  it("ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE remains 'Coming soon' (kept for future placeholders)", () => {
    expect(ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE).toBe("Coming soon");
  });
});

// ── Negative invariants — boundary + credential blocklists ──────────────────

describe("All operator-facing copy — boundary + credential negative invariants", () => {
  // Combine every operator-facing string the helpers expose into a
  // single brute-force list. None may match the misleading-phrase or
  // credential-material blocklists.
  const ALL_COPY: string[] = [
    ...ORG_ADMIN_MFA_POLICY_OPTIONS.flatMap((o) => [o.label, o.description]),
    ORG_ADMIN_MFA_FORM_COPY.successBanner,
    ORG_ADMIN_MFA_FORM_COPY.saveLabel,
    ORG_ADMIN_MFA_FORM_COPY.savingLabel,
    ORG_ADMIN_MFA_FORM_COPY.legend,
    ...Object.values(ORG_ADMIN_SETTINGS_PAGE_COPY),
    ...ORG_ADMIN_SETTINGS_PLACEHOLDERS.flatMap((p) => [p.title, p.description]),
    ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE,
  ];

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

  it("no operator-facing string contains site_admin / cross-org / cross-tenant wording", () => {
    for (const s of ALL_COPY) {
      for (const pat of MISLEADING_PHRASES) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });

  it("no operator-facing string contains credential-material or recovery-code terms", () => {
    for (const s of ALL_COPY) {
      for (const pat of CREDENTIAL_TERMS) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });
});

// ── Page-source wiring ───────────────────────────────────────────────────────

describe("Page source — wiring + no inline literal residue", () => {
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  const PAGE_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "page.tsx"),
    "utf-8"
  );
  const FORM_SRC = readFileSync(
    resolve(__dirname, "..", "components", "org-admin", "mfa-policy-form.tsx"),
    "utf-8"
  );
  const HELPER_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "settings-helpers.ts"),
    "utf-8"
  );

  it("page.tsx imports the page copy + placeholders from settings-helpers", () => {
    expect(PAGE_SRC).toMatch(
      /import\s*\{[\s\S]*?ORG_ADMIN_SETTINGS_PAGE_COPY[\s\S]*?\}\s*from\s+["']\.\/settings-helpers["']/
    );
    expect(PAGE_SRC).toMatch(/ORG_ADMIN_SETTINGS_PLACEHOLDERS/);
    expect(PAGE_SRC).toMatch(/ORG_ADMIN_SETTINGS_PLACEHOLDER_BADGE/);
  });

  it("mfa-policy-form.tsx imports the policy options + form copy from settings-helpers", () => {
    expect(FORM_SRC).toMatch(/ORG_ADMIN_MFA_POLICY_OPTIONS/);
    expect(FORM_SRC).toMatch(/ORG_ADMIN_MFA_FORM_COPY/);
    expect(FORM_SRC).toMatch(/from\s+["']@\/app\/org-admin\/settings\/settings-helpers["']/);
  });

  it("page.tsx no longer contains the inline placeholder literal strings", () => {
    // After extraction the previous inline literals must NOT survive
    // in the page source. Operator-facing strings come exclusively
    // from the constants.
    expect(PAGE_SRC).not.toMatch(/title="Domains"/);
    expect(PAGE_SRC).not.toMatch(/title="Invite policy"/);
    expect(PAGE_SRC).not.toMatch(/"Manage verified domains/);
    expect(PAGE_SRC).not.toMatch(/"Control how new members are invited/);
    expect(PAGE_SRC).not.toMatch(/"Coming soon"/);
  });

  it("mfa-policy-form.tsx no longer contains the inline POLICIES literal", () => {
    // The local `const POLICIES = [...]` array was extracted into
    // ORG_ADMIN_MFA_POLICY_OPTIONS. A regression that re-inlined the
    // array would surface here.
    expect(FORM_SRC).not.toMatch(/const\s+POLICIES\s*[:=]/);
    expect(FORM_SRC).not.toMatch(/"Users may enroll MFA at any time/);
    expect(FORM_SRC).not.toMatch(/"Save policy"/);
    expect(FORM_SRC).not.toMatch(/"Saving…"/);
  });

  it("page.tsx + mfa-policy-form.tsx contain no inline href that points at /site-admin or tenant-external surfaces", () => {
    // The org-admin shell must never link to /site-admin. The helpers
    // are pure data and contain no URLs, so we only need to scan the
    // page + form source. Comment-strip first so doc-blocks that
    // legitimately reference the boundary don't trip the assertion.
    const PAGE_NO_COMMENTS = stripComments(PAGE_SRC);
    const FORM_NO_COMMENTS = stripComments(FORM_SRC);
    expect(PAGE_NO_COMMENTS).not.toMatch(/href="\/site-admin/);
    expect(FORM_NO_COMMENTS).not.toMatch(/href="\/site-admin/);
    // Belt-and-suspenders: no protocol-relative or absolute external
    // URLs in either file's operator-facing code.
    expect(PAGE_NO_COMMENTS).not.toMatch(/href="https?:\/\//);
    expect(FORM_NO_COMMENTS).not.toMatch(/href="https?:\/\//);
    expect(PAGE_NO_COMMENTS).not.toMatch(/href="\/\//);
    expect(FORM_NO_COMMENTS).not.toMatch(/href="\/\//);
  });

  it("helper module contains no credential-material literals (post-comment-strip)", () => {
    const NO_COMMENTS = stripComments(HELPER_SRC);
    const CREDENTIAL_TERMS = [
      /password_hash/i,
      /mfa_secret/i,
      /otpauth:\/\//i,
      /Bearer\s+[A-Za-z0-9._-]{8,}/,
      /Set-Cookie/i,
      /session_validator/i,
      /\breset_token\b/i,
      /\bclaim_token\b/i,
      /\brecovery_codes\b/i,
    ];
    for (const pat of CREDENTIAL_TERMS) {
      expect(NO_COMMENTS, `helper must not match ${pat}`).not.toMatch(pat);
    }
  });
});
