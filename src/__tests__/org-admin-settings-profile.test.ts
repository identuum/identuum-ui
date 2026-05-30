/**
 * Tests for the /org-admin/settings Organization profile form.
 *
 * Scope discipline (mirrors the MFA-policy test):
 *   - `org-profile-form.tsx` is a `"use client"` React component using
 *     `useActionState`; vitest runs in `environment: "node"` without
 *     `jsdom`/`happy-dom`/`@testing-library/react`. Rendering-layer
 *     assertions are done by reading source files as text and
 *     pattern-matching; end-to-end rendered DOM coverage is left to a
 *     non-destructive Playwright follow-up (the local-demo org_admin
 *     fixture is currently stale, so adding Playwright in this task
 *     would be premature).
 *
 * SECURITY:
 *   - No HTTP call, no organization profile mutation. All checks are
 *     against pure constants and source text.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORG_ADMIN_PROFILE_FORM_COPY,
  ORG_ADMIN_PROFILE_NAME_FIELD,
} from "../app/org-admin/settings/settings-helpers";

// ── Profile form copy ────────────────────────────────────────────────────────

describe("ORG_ADMIN_PROFILE_FORM_COPY — exact form copy pins", () => {
  it("successBanner exactly matches the documented copy", () => {
    expect(ORG_ADMIN_PROFILE_FORM_COPY.successBanner).toBe("Organization name updated.");
  });

  it("saveLabel is 'Save profile' (NOT generic 'Save' / 'Update')", () => {
    // Specific copy is operator-critical — a generic verb wouldn't tell
    // the operator which form is being saved.
    expect(ORG_ADMIN_PROFILE_FORM_COPY.saveLabel).toBe("Save profile");
  });

  it("savingLabel uses the unicode ellipsis (…) not three dots (...)", () => {
    expect(ORG_ADMIN_PROFILE_FORM_COPY.savingLabel).toBe("Saving…");
    expect(ORG_ADMIN_PROFILE_FORM_COPY.savingLabel).toMatch(/…$/);
    expect(ORG_ADMIN_PROFILE_FORM_COPY.savingLabel).not.toMatch(/\.\.\.$/);
  });

  it("nameLabel is exactly 'Organization name'", () => {
    expect(ORG_ADMIN_PROFILE_FORM_COPY.nameLabel).toBe("Organization name");
  });

  it("requiredMarker is exactly '*' (and not '(required)' / '!' / something else)", () => {
    expect(ORG_ADMIN_PROFILE_FORM_COPY.requiredMarker).toBe("*");
  });

  it("domainLabel is exactly 'Primary domain'", () => {
    expect(ORG_ADMIN_PROFILE_FORM_COPY.domainLabel).toBe("Primary domain");
  });

  it("domainHelp explains the read-only constraint and points the operator at the platform administrator", () => {
    expect(ORG_ADMIN_PROFILE_FORM_COPY.domainHelp).toBe(
      "Domain changes affect OIDC discovery and SSO — contact your platform administrator."
    );
    // The "contact your platform administrator" phrasing is the
    // documented self-service escape hatch — a regression that softened
    // it to "talk to support" would leave operators guessing.
    expect(ORG_ADMIN_PROFILE_FORM_COPY.domainHelp).toMatch(/platform administrator/i);
  });

  it("the copy bundle has exactly the seven known keys (allowlist key shape)", () => {
    const keys = Object.keys(ORG_ADMIN_PROFILE_FORM_COPY).sort();
    expect(keys).toEqual([
      "domainHelp",
      "domainLabel",
      "nameLabel",
      "requiredMarker",
      "saveLabel",
      "savingLabel",
      "successBanner",
    ]);
  });
});

// ── Profile name input field metadata ───────────────────────────────────────

describe("ORG_ADMIN_PROFILE_NAME_FIELD — input field metadata pins", () => {
  it("id is 'org-name' so the <label htmlFor> wiring is stable", () => {
    expect(ORG_ADMIN_PROFILE_NAME_FIELD.id).toBe("org-name");
  });

  it("name is 'name' so it matches the FormData key read by updateOrgProfileAction", () => {
    // The server action reads formData.get("name"). If this drifts, the
    // form silently submits an empty name and the user sees "Organization
    // name is required." with no other context.
    expect(ORG_ADMIN_PROFILE_NAME_FIELD.name).toBe("name");
  });

  it("type is 'text' (not 'email' / 'url' / 'password' / etc.)", () => {
    expect(ORG_ADMIN_PROFILE_NAME_FIELD.type).toBe("text");
  });

  it("required is true (the org name is mandatory)", () => {
    expect(ORG_ADMIN_PROFILE_NAME_FIELD.required).toBe(true);
  });

  it("maxLength is 100 — exact mirror of the server-side cap in updateOrgProfileAction", () => {
    // A divergence (e.g. raising the client to 200 while the server
    // stays at 100) would let users type past the cap and surface a
    // confusing server error rather than being client-limited up front.
    expect(ORG_ADMIN_PROFILE_NAME_FIELD.maxLength).toBe(100);
  });

  it("the field-metadata bundle has exactly the five known keys (allowlist key shape)", () => {
    const keys = Object.keys(ORG_ADMIN_PROFILE_NAME_FIELD).sort();
    expect(keys).toEqual(["id", "maxLength", "name", "required", "type"]);
  });
});

// ── Negative invariants — boundary + credential blocklists ──────────────────

describe("Profile-form copy + field metadata — boundary + credential negative invariants", () => {
  const ALL_COPY: string[] = [
    ORG_ADMIN_PROFILE_FORM_COPY.successBanner,
    ORG_ADMIN_PROFILE_FORM_COPY.saveLabel,
    ORG_ADMIN_PROFILE_FORM_COPY.savingLabel,
    ORG_ADMIN_PROFILE_FORM_COPY.nameLabel,
    ORG_ADMIN_PROFILE_FORM_COPY.requiredMarker,
    ORG_ADMIN_PROFILE_FORM_COPY.domainLabel,
    ORG_ADMIN_PROFILE_FORM_COPY.domainHelp,
    ORG_ADMIN_PROFILE_NAME_FIELD.id,
    ORG_ADMIN_PROFILE_NAME_FIELD.name,
    ORG_ADMIN_PROFILE_NAME_FIELD.type,
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
    /\bapi\s+key\b/i,
    /\bsecret\s+key\b/i,
  ];

  it("no profile-form copy or field metadata contains site_admin / cross-org wording", () => {
    for (const s of ALL_COPY) {
      for (const pat of MISLEADING_PHRASES) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });

  it("no profile-form copy or field metadata contains credential-material terms", () => {
    for (const s of ALL_COPY) {
      for (const pat of CREDENTIAL_TERMS) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });
});

// ── Source-text wiring + negative invariants ────────────────────────────────

describe("Profile form source — wiring + no inline literal residue", () => {
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  const FORM_SRC = readFileSync(
    resolve(__dirname, "..", "components", "org-admin", "org-profile-form.tsx"),
    "utf-8"
  );
  const HELPER_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "settings-helpers.ts"),
    "utf-8"
  );

  it("org-profile-form.tsx imports the profile copy + field metadata from settings-helpers", () => {
    expect(FORM_SRC).toMatch(/ORG_ADMIN_PROFILE_FORM_COPY/);
    expect(FORM_SRC).toMatch(/ORG_ADMIN_PROFILE_NAME_FIELD/);
    expect(FORM_SRC).toMatch(/from\s+["']@\/app\/org-admin\/settings\/settings-helpers["']/);
  });

  it("org-profile-form.tsx no longer contains the inline literal strings", () => {
    // After extraction the previous inline literals must NOT survive in
    // the form source. Operator-facing strings come exclusively from
    // the constants.
    const NO_COMMENTS = stripComments(FORM_SRC);
    expect(NO_COMMENTS).not.toMatch(/>\s*Organization name updated\.\s*</);
    expect(NO_COMMENTS).not.toMatch(/"Saving…"/);
    expect(NO_COMMENTS).not.toMatch(/"Save profile"/);
    expect(NO_COMMENTS).not.toMatch(/>\s*Primary domain\s*</);
    expect(NO_COMMENTS).not.toMatch(/Domain changes affect OIDC discovery and SSO/);
  });

  it("org-profile-form.tsx renders the success banner only on `state.phase === \"success\"`", () => {
    // The bounded error envelope: render the green banner exclusively
    // when the server action returned success.
    expect(FORM_SRC).toMatch(/state\.phase\s*===\s*["']success["'][\s\S]*?successBanner/);
  });

  it("org-profile-form.tsx renders the error banner only on `state.phase === \"error\"` and only when state.error is truthy", () => {
    // The bounded error envelope: never render the red banner for the
    // empty-error case (which is reserved for fieldErrors-only flows).
    expect(FORM_SRC).toMatch(
      /state\.phase\s*===\s*["']error["']\s*&&\s*state\.error\s*&&/
    );
    // The error body is whatever the server returned verbatim — render
    // through {state.error}, not a hard-coded copy block.
    expect(FORM_SRC).toMatch(/\{\s*state\.error\s*\}/);
  });

  it("org-profile-form.tsx renders the fieldErrors.name message via {state.fieldErrors.name} (bounded shape)", () => {
    // The field-level error rendering is the only path through which
    // server-derived "name is required" / "name too long" reach the
    // user. The form must not hard-code those strings.
    expect(FORM_SRC).toMatch(/\{\s*state\.fieldErrors\.name\s*\}/);
  });

  it("org-profile-form.tsx wires the form action to updateOrgProfileAction (not a different server action)", () => {
    expect(FORM_SRC).toMatch(
      /useActionState\s*\(\s*updateOrgProfileAction\s*,\s*initialState\s*\)/
    );
    expect(FORM_SRC).toMatch(/<form\s+action=\{\s*action\s*\}/);
  });

  it("Primary domain renders using plain <p> elements (no labeling semantics) — NOT <label>, NOT <dt>/<dd>", () => {
    // Root cause of the Playwright getByLabel(/primary domain/i)
    // count=2 regression: an orphan <label> (no `htmlFor`, not wrapping
    // any control) causes Playwright to associate it with the next
    // sibling form control inside the same <form>. A <dl>/<dt>/<dd>
    // alternative is also wrong because description lists semantically
    // pair <dt> as a label for <dd>. The fix uses plain <p> elements,
    // which carry no labeling semantics, so Playwright never matches.
    const NO_COMMENTS = stripComments(FORM_SRC);
    // There is no <label> element ANYWHERE in the form source whose
    // visible text is the Primary domain label. The Organization-name
    // <label> (which DOES have `htmlFor` linking to the org-name input)
    // is the only legitimate <label> in the form.
    expect(NO_COMMENTS).not.toMatch(
      /<label[^>]*>\s*\{\s*ORG_ADMIN_PROFILE_FORM_COPY\.domainLabel/
    );
    // No <dt>/<dd> pairing — those would associate dt as a label for dd.
    expect(NO_COMMENTS).not.toMatch(/<dt\b/);
    expect(NO_COMMENTS).not.toMatch(/<dd\b/);
    expect(NO_COMMENTS).not.toMatch(/<dl\b/);
    // The Primary-domain copy is rendered through a <p> element.
    expect(NO_COMMENTS).toMatch(
      /<p[^>]*>\s*\{\s*ORG_ADMIN_PROFILE_FORM_COPY\.domainLabel\s*\}\s*<\/p>/
    );
  });

  it("Primary domain section contains no input/select/textarea/combobox/button form controls", () => {
    const NO_COMMENTS = stripComments(FORM_SRC);
    // Locate the Primary-domain block by anchoring on the comment-free
    // marker `{ORG_ADMIN_PROFILE_FORM_COPY.domainLabel}` and capturing
    // the surrounding <div> wrapper.
    const blockStart = NO_COMMENTS.indexOf("ORG_ADMIN_PROFILE_FORM_COPY.domainLabel");
    expect(blockStart).toBeGreaterThan(-1);
    // Walk back to the enclosing `{domain && (` opening JSX expression
    // and forward to its matching `)}` closer.
    const before = NO_COMMENTS.slice(0, blockStart);
    const wrapperOpen = before.lastIndexOf("{domain && (");
    expect(wrapperOpen).toBeGreaterThan(-1);
    const afterStart = NO_COMMENTS.slice(wrapperOpen);
    // The Primary-domain JSX block ends at the next `)}` matching the
    // `{domain && (` opener. A conservative slice is enough to scan
    // for form-control elements.
    const domainBlock = afterStart.slice(0, 800);
    expect(domainBlock).not.toMatch(/<input\b/);
    expect(domainBlock).not.toMatch(/<select\b/);
    expect(domainBlock).not.toMatch(/<textarea\b/);
    expect(domainBlock).not.toMatch(/role=["']combobox["']/);
    expect(domainBlock).not.toMatch(/<button\b/);
    expect(domainBlock).not.toMatch(/<label\b/);
  });

  it("Organization name remains editable (the input is rendered and not disabled)", () => {
    const NO_COMMENTS = stripComments(FORM_SRC);
    // The Organization-name <input> is unchanged and still uses the
    // field metadata constants for name/type/required/maxLength.
    expect(NO_COMMENTS).toMatch(/<input[\s\S]*?name=\{\s*ORG_ADMIN_PROFILE_NAME_FIELD\.name\s*\}/);
    expect(NO_COMMENTS).toMatch(
      /<input[\s\S]*?required=\{\s*ORG_ADMIN_PROFILE_NAME_FIELD\.required\s*\}/
    );
    // No `disabled` attribute on the org-name input.
    expect(NO_COMMENTS).not.toMatch(
      /<input[^>]*name=\{\s*ORG_ADMIN_PROFILE_NAME_FIELD\.name[\s\S]{0,200}?\bdisabled\b/
    );
  });

  it("org-profile-form.tsx contains no href that points at /site-admin or external/protocol-relative URLs", () => {
    const NO_COMMENTS = stripComments(FORM_SRC);
    expect(NO_COMMENTS).not.toMatch(/href="\/site-admin/);
    expect(NO_COMMENTS).not.toMatch(/href="https?:\/\//);
    expect(NO_COMMENTS).not.toMatch(/href="\/\//);
  });

  it("settings-helpers.ts module contains no credential-material literals (post-comment-strip)", () => {
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
      /\bapi_key\b/i,
      /\bsecret_key\b/i,
    ];
    for (const pat of CREDENTIAL_TERMS) {
      expect(NO_COMMENTS, `helper must not match ${pat}`).not.toMatch(pat);
    }
  });

  it("settings-helpers.ts module contains no operator-facing misleading wording (post-comment-strip)", () => {
    // The helper module is the single source of truth for operator
    // copy. Even with comments stripped, no exported string should
    // imply cross-org or site-admin authority.
    const NO_COMMENTS = stripComments(HELPER_SRC);
    // After comment-strip the remaining text is the exported constants
    // and any non-comment punctuation.
    expect(NO_COMMENTS).not.toMatch(/\ball organizations\b/i);
    expect(NO_COMMENTS).not.toMatch(/\bsystem user\b/i);
    expect(NO_COMMENTS).not.toMatch(/\bsovereign bunker override\b/i);
    expect(NO_COMMENTS).not.toMatch(/\barchive organization\b/i);
    expect(NO_COMMENTS).not.toMatch(/\brestore organization\b/i);
    expect(NO_COMMENTS).not.toMatch(/\bhard delete\b/i);
    expect(NO_COMMENTS).not.toMatch(/\bdelete organization\b/i);
  });
});
