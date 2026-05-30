/**
 * Tests for the /org-admin/settings Invite policy card (read-only).
 *
 * Scope discipline (mirrors the prior helper-extraction tasks):
 *   - `invite-policy-card.tsx` is a Next server component; vitest runs in
 *     `environment: "node"` without `jsdom`/`happy-dom`/`@testing-library/react`.
 *     Rendering-layer assertions are done by reading source files as text and
 *     pattern-matching. End-to-end rendered DOM coverage is left to a future
 *     non-destructive Playwright spec once the org_admin fixture is restored
 *     (see identuum-ui/docs/LOCAL_ORG_ADMIN_PLAYWRIGHT_FIXTURE.md).
 *
 * SECURITY:
 *   - No HTTP call, no organization mutation. All checks are against pure
 *     helpers (the mode derivation + copy bundles) and source text.
 *   - Examples use neutral identifiers only (no real customer / company /
 *     fixture names or domains).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORG_ADMIN_INVITE_POLICY_CARD_COPY,
  ORG_ADMIN_INVITE_POLICY_FORM_COPY,
  ORG_ADMIN_INVITE_POLICY_MODE_COPY,
  type OrgAdminInvitePolicyInput,
  type OrgAdminInvitePolicyMode,
  deriveOrgAdminInvitePolicyMode,
  getOrgAdminInvitePolicyModeCopy,
  invitePolicyFlagsFromMode,
  invitePolicyModeFromFlags,
  invitePolicyModeLabel,
  isValidInvitePolicyFlags,
} from "../app/org-admin/settings/settings-helpers";

// ── Mode derivation ──────────────────────────────────────────────────────────

describe("deriveOrgAdminInvitePolicyMode — three-mode collapse over the two booleans", () => {
  it("returns 'invite-only' when allow_public_registration is false (approval flag is irrelevant)", () => {
    // Brute-force the truth-table: when self-registration is OFF, the
    // approval flag has no product behavior, so it MUST NOT affect the
    // derived mode.
    const cases: OrgAdminInvitePolicyInput[] = [
      { allow_public_registration: false, require_registration_approval: false },
      { allow_public_registration: false, require_registration_approval: true },
    ];
    for (const c of cases) {
      expect(deriveOrgAdminInvitePolicyMode(c)).toBe("invite-only");
    }
  });

  it("returns 'public-with-approval' when allow=true AND approval=true", () => {
    expect(
      deriveOrgAdminInvitePolicyMode({
        allow_public_registration: true,
        require_registration_approval: true,
      })
    ).toBe("public-with-approval");
  });

  it("returns 'public-immediate' when allow=true AND approval=false", () => {
    expect(
      deriveOrgAdminInvitePolicyMode({
        allow_public_registration: true,
        require_registration_approval: false,
      })
    ).toBe("public-immediate");
  });

  it("never returns a mode outside the documented three-element allowlist (brute force 2 × 2)", () => {
    const allowed: OrgAdminInvitePolicyMode[] = [
      "invite-only",
      "public-with-approval",
      "public-immediate",
    ];
    for (const allow_public_registration of [true, false]) {
      for (const require_registration_approval of [true, false]) {
        const mode = deriveOrgAdminInvitePolicyMode({
          allow_public_registration,
          require_registration_approval,
        });
        expect(allowed).toContain(mode);
      }
    }
  });
});

// ── Mode copy bundles ────────────────────────────────────────────────────────

describe("ORG_ADMIN_INVITE_POLICY_MODE_COPY — exact label + description pins", () => {
  it("'invite-only' label and description scope to administrator-driven invitations", () => {
    const copy = ORG_ADMIN_INVITE_POLICY_MODE_COPY["invite-only"];
    expect(copy.label).toBe("Invite-only");
    expect(copy.description).toBe(
      "New members join your organization only when an organization administrator sends them an invitation."
    );
    expect(copy.description).toMatch(/your organization/i);
    // Restriction language — operator must see "only when".
    expect(copy.description).toMatch(/\bonly\b/i);
  });

  it("'public-with-approval' label and description name both halves of the two-step flow", () => {
    const copy = ORG_ADMIN_INVITE_POLICY_MODE_COPY["public-with-approval"];
    expect(copy.label).toBe("Public self-registration with approval");
    expect(copy.description).toBe(
      "Anyone whose email matches your organization's verified domain may request access. Each request stays pending until an organization administrator approves it."
    );
    expect(copy.description).toMatch(/your organization/i);
    // Approval framing — operator must see "pending" + "approves".
    expect(copy.description).toMatch(/\bpending\b/i);
    expect(copy.description).toMatch(/\bapproves\b/i);
  });

  it("'public-immediate' label and description make the no-approval semantics explicit", () => {
    const copy = ORG_ADMIN_INVITE_POLICY_MODE_COPY["public-immediate"];
    expect(copy.label).toBe("Public self-registration");
    expect(copy.description).toBe(
      "Anyone whose email matches your organization's verified domain may self-register. New accounts become active immediately without administrator approval."
    );
    expect(copy.description).toMatch(/your organization/i);
    expect(copy.description).toMatch(/\bimmediately\b/i);
    expect(copy.description).toMatch(/without administrator approval/i);
  });

  it("the mode-copy table has exactly the three documented keys (allowlist key shape)", () => {
    const keys = Object.keys(ORG_ADMIN_INVITE_POLICY_MODE_COPY).sort();
    expect(keys).toEqual(["invite-only", "public-immediate", "public-with-approval"]);
  });

  it("every mode's copy bundle has shape exactly { label, description } with non-empty strings", () => {
    for (const mode of Object.keys(
      ORG_ADMIN_INVITE_POLICY_MODE_COPY
    ) as OrgAdminInvitePolicyMode[]) {
      const copy = ORG_ADMIN_INVITE_POLICY_MODE_COPY[mode];
      expect(Object.keys(copy).sort()).toEqual(["description", "label"]);
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });
});

// ── getOrgAdminInvitePolicyModeCopy — lookup parity ─────────────────────────

describe("getOrgAdminInvitePolicyModeCopy — table lookup is byte-identical to the constant", () => {
  it("returns the same object reference as the constant table for every mode", () => {
    for (const mode of Object.keys(
      ORG_ADMIN_INVITE_POLICY_MODE_COPY
    ) as OrgAdminInvitePolicyMode[]) {
      expect(getOrgAdminInvitePolicyModeCopy(mode)).toBe(ORG_ADMIN_INVITE_POLICY_MODE_COPY[mode]);
    }
  });
});

// ── Write-path helpers (invitePolicyFlagsFromMode + isValidInvitePolicyFlags) ──

describe("invitePolicyFlagsFromMode — canonical mode → flag pair mapping", () => {
  it("'invite-only' maps to (false, false)", () => {
    expect(invitePolicyFlagsFromMode("invite-only")).toEqual({
      allow_public_registration: false,
      require_registration_approval: false,
    });
  });

  it("'public-with-approval' maps to (true, true)", () => {
    expect(invitePolicyFlagsFromMode("public-with-approval")).toEqual({
      allow_public_registration: true,
      require_registration_approval: true,
    });
  });

  it("'public-immediate' maps to (true, false)", () => {
    expect(invitePolicyFlagsFromMode("public-immediate")).toEqual({
      allow_public_registration: true,
      require_registration_approval: false,
    });
  });

  it("round-trips losslessly with deriveOrgAdminInvitePolicyMode for every mode", () => {
    for (const mode of ["invite-only", "public-with-approval", "public-immediate"] as const) {
      const flags = invitePolicyFlagsFromMode(mode);
      expect(deriveOrgAdminInvitePolicyMode(flags)).toBe(mode);
    }
  });

  it("never produces the documented invalid combination (false, true)", () => {
    // Brute force every mode; assert that no mapping produces the
    // invalid flag pair under any input.
    for (const mode of ["invite-only", "public-with-approval", "public-immediate"] as const) {
      const flags = invitePolicyFlagsFromMode(mode);
      expect(
        flags.allow_public_registration === false && flags.require_registration_approval === true
      ).toBe(false);
    }
  });
});

describe("isValidInvitePolicyFlags — refuses only the (false, true) combination", () => {
  it("accepts (false, false) — invite-only", () => {
    expect(isValidInvitePolicyFlags(false, false)).toBe(true);
  });

  it("accepts (true, true) — public-with-approval", () => {
    expect(isValidInvitePolicyFlags(true, true)).toBe(true);
  });

  it("accepts (true, false) — public-immediate", () => {
    expect(isValidInvitePolicyFlags(true, false)).toBe(true);
  });

  it("REJECTS (false, true) — the invalid documented combination", () => {
    expect(isValidInvitePolicyFlags(false, true)).toBe(false);
  });
});

describe("invitePolicyModeLabel — operator-facing label for each mode", () => {
  it("returns 'Invite-only' for the invite-only mode", () => {
    expect(invitePolicyModeLabel("invite-only")).toBe("Invite-only");
  });

  it("returns 'Public self-registration with approval' for the public-with-approval mode", () => {
    expect(invitePolicyModeLabel("public-with-approval")).toBe(
      "Public self-registration with approval"
    );
  });

  it("returns 'Public self-registration' for the public-immediate mode", () => {
    expect(invitePolicyModeLabel("public-immediate")).toBe("Public self-registration");
  });
});

describe("invitePolicyModeFromFlags — alias of deriveOrgAdminInvitePolicyMode", () => {
  it("is the same function reference as deriveOrgAdminInvitePolicyMode", () => {
    expect(invitePolicyModeFromFlags).toBe(deriveOrgAdminInvitePolicyMode);
  });
});

describe("ORG_ADMIN_INVITE_POLICY_FORM_COPY — write-path operator copy pins", () => {
  it("successBanner exactly matches the documented copy", () => {
    expect(ORG_ADMIN_INVITE_POLICY_FORM_COPY.successBanner).toBe(
      "Invite policy updated successfully."
    );
  });

  it("saveLabel is 'Save invite policy' (specific verb naming the card)", () => {
    expect(ORG_ADMIN_INVITE_POLICY_FORM_COPY.saveLabel).toBe("Save invite policy");
  });

  it("savingLabel uses the unicode ellipsis (Saving…)", () => {
    expect(ORG_ADMIN_INVITE_POLICY_FORM_COPY.savingLabel).toBe("Saving…");
    expect(ORG_ADMIN_INVITE_POLICY_FORM_COPY.savingLabel).toMatch(/…$/);
  });

  it("legend names the policy MODE (sr-only legend, distinct from the card title)", () => {
    // The legend MUST NOT equal the card title text — they would collide on
    // Playwright's `getByText("Invite policy", exact: true)` selector. The
    // "mode" suffix preserves screen-reader semantics while remaining
    // disambiguable from the card title.
    expect(ORG_ADMIN_INVITE_POLICY_FORM_COPY.legend).toBe("Invite policy mode");
    expect(ORG_ADMIN_INVITE_POLICY_FORM_COPY.legend).not.toBe(
      ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardTitle
    );
  });

  it("invalidStateBanner asks the operator to repair the row (no jargon, no auth-boundary language)", () => {
    const banner = ORG_ADMIN_INVITE_POLICY_FORM_COPY.invalidStateBanner;
    expect(banner).toMatch(/not a valid product mode/i);
    expect(banner).toMatch(/repair this row/i);
    expect(banner).not.toMatch(/\bsite[- ]admin\b/i);
    expect(banner).not.toMatch(/\bcross[- ]org\b/i);
  });

  it("the form-copy bundle has exactly the five known keys (allowlist key shape)", () => {
    const keys = Object.keys(ORG_ADMIN_INVITE_POLICY_FORM_COPY).sort();
    expect(keys).toEqual([
      "invalidStateBanner",
      "legend",
      "saveLabel",
      "savingLabel",
      "successBanner",
    ]);
  });
});

// ── Card-level copy ──────────────────────────────────────────────────────────

describe("ORG_ADMIN_INVITE_POLICY_CARD_COPY — card chrome copy pins", () => {
  it("cardTitle is exactly 'Invite policy'", () => {
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardTitle).toBe("Invite policy");
  });

  it("cardSubtitle scopes to 'your organization' and mentions the Users page escape hatch", () => {
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardSubtitle).toBe(
      "How new members can join your organization. Direct invitations sent from the Users page are always available."
    );
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardSubtitle).toMatch(/your organization/i);
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardSubtitle).toMatch(/Users page/i);
  });

  it("currentModeLabel, legend, directInviteHint, directInviteLinkLabel are the documented strings", () => {
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.currentModeLabel).toBe("Current mode");
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.legend).toBe("Invite policy summary");
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHint).toBe(
      "Send a direct invitation from the Users page."
    );
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteLinkLabel).toBe("Open Users page →");
  });

  it("directInviteHref points at /org-admin/users (relative, no scheme, no protocol-relative leading '//')", () => {
    // The link must stay an internal org-admin route. A regression that
    // pointed it at /site-admin/users or an external URL would breach
    // the org-admin authority boundary.
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHref).toBe("/org-admin/users");
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHref).toMatch(/^\/org-admin\//);
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHref).not.toMatch(/^https?:\/\//);
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHref).not.toMatch(/^\/\//);
    expect(ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHref).not.toMatch(/\/site-admin/);
  });

  it("the card-copy bundle has exactly the seven known keys (allowlist key shape)", () => {
    const keys = Object.keys(ORG_ADMIN_INVITE_POLICY_CARD_COPY).sort();
    expect(keys).toEqual([
      "cardSubtitle",
      "cardTitle",
      "currentModeLabel",
      "directInviteHint",
      "directInviteHref",
      "directInviteLinkLabel",
      "legend",
    ]);
  });
});

// ── Negative invariants — boundary + credential blocklists ──────────────────

describe("All invite-policy operator-facing copy — boundary + credential negative invariants", () => {
  const ALL_COPY: string[] = [
    ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardTitle,
    ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardSubtitle,
    ORG_ADMIN_INVITE_POLICY_CARD_COPY.currentModeLabel,
    ORG_ADMIN_INVITE_POLICY_CARD_COPY.legend,
    ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHint,
    ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHref,
    ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteLinkLabel,
    ...(Object.values(ORG_ADMIN_INVITE_POLICY_MODE_COPY).flatMap((c) => [c.label, c.description])),
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

  // Neutral identifier sentry: the public test fixture must use only the
  // documented neutral placeholders. A regression that hard-coded a real
  // customer/company name into operator copy would fail here.
  const FORBIDDEN_REAL_FIXTURE_PATTERNS = [/audi/i, /admin@audi/i];

  it("no operator-facing invite-policy string contains site_admin / cross-org wording", () => {
    for (const s of ALL_COPY) {
      for (const pat of MISLEADING_PHRASES) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });

  it("no operator-facing invite-policy string contains credential-material terms", () => {
    for (const s of ALL_COPY) {
      for (const pat of CREDENTIAL_TERMS) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });

  it("no operator-facing invite-policy string mentions real customer/fixture identifiers", () => {
    for (const s of ALL_COPY) {
      for (const pat of FORBIDDEN_REAL_FIXTURE_PATTERNS) {
        expect(s, `copy "${s}" must not match ${pat}`).not.toMatch(pat);
      }
    }
  });
});

// ── Source-text wiring + invariants ──────────────────────────────────────────

describe("Page + InvitePolicyForm source — wiring and negative invariants", () => {
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  const PAGE_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "page.tsx"),
    "utf-8"
  );
  const FORM_SRC = readFileSync(
    resolve(__dirname, "..", "components", "org-admin", "invite-policy-form.tsx"),
    "utf-8"
  );
  const HELPER_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "settings-helpers.ts"),
    "utf-8"
  );
  const ACTIONS_SRC = readFileSync(
    resolve(__dirname, "..", "app", "org-admin", "settings", "actions.ts"),
    "utf-8"
  );

  it("page.tsx imports InvitePolicyForm and renders it with the projected booleans", () => {
    expect(PAGE_SRC).toMatch(
      /import\s*\{\s*InvitePolicyForm\s*\}\s*from\s+["']@\/components\/org-admin\/invite-policy-form["']/
    );
    expect(PAGE_SRC).toMatch(/<InvitePolicyForm\s+policy=\{\s*invitePolicy\s*\}\s*\/>/);
    expect(PAGE_SRC).toMatch(/allow_public_registration/);
    expect(PAGE_SRC).toMatch(/require_registration_approval/);
  });

  it("InvitePolicyForm imports the mode helpers, the form copy, and the server action", () => {
    expect(FORM_SRC).toMatch(/ORG_ADMIN_INVITE_POLICY_FORM_COPY/);
    expect(FORM_SRC).toMatch(/ORG_ADMIN_INVITE_POLICY_MODE_COPY/);
    expect(FORM_SRC).toMatch(/deriveOrgAdminInvitePolicyMode/);
    expect(FORM_SRC).toMatch(/isValidInvitePolicyFlags/);
    expect(FORM_SRC).toMatch(/updateInvitePolicyAction/);
    expect(FORM_SRC).toMatch(
      /from\s+["']@\/app\/org-admin\/settings\/settings-helpers["']/
    );
    expect(FORM_SRC).toMatch(/from\s+["']@\/app\/org-admin\/settings\/actions["']/);
  });

  it("InvitePolicyForm is a controlled write form: useActionState + <form action> + radio inputs", () => {
    const FORM_NO_COMMENTS = stripComments(FORM_SRC);
    expect(FORM_NO_COMMENTS).toMatch(/useActionState/);
    expect(FORM_NO_COMMENTS).toMatch(/<form\s+action=\{\s*action\s*\}/);
    expect(FORM_NO_COMMENTS).toMatch(/type=["']radio["']/);
    expect(FORM_NO_COMMENTS).toMatch(/name=["']invite_policy_mode["']/);
    // Submit button + accessible save copy.
    expect(FORM_NO_COMMENTS).toMatch(/type=["']submit["']/);
  });

  it("InvitePolicyForm's outbound href points at /org-admin/users (matching the helper)", () => {
    const FORM_NO_COMMENTS = stripComments(FORM_SRC);
    expect(FORM_NO_COMMENTS).not.toMatch(/href="\/site-admin/);
    expect(FORM_NO_COMMENTS).not.toMatch(/href="https?:\/\//);
    expect(FORM_NO_COMMENTS).not.toMatch(/href="\/\//);
    expect(FORM_NO_COMMENTS).not.toMatch(/href="\/org-admin\/users"/);
    expect(FORM_NO_COMMENTS).toMatch(
      /href=\{\s*ORG_ADMIN_INVITE_POLICY_CARD_COPY\.directInviteHref\s*\}/
    );
  });

  it("InvitePolicyForm source contains no real customer/fixture identifiers", () => {
    const FORM_NO_COMMENTS = stripComments(FORM_SRC);
    expect(FORM_NO_COMMENTS).not.toMatch(/\baudi\b/i);
    expect(FORM_NO_COMMENTS).not.toMatch(/admin@audi/i);
  });

  it("updateInvitePolicyAction validates the mode enum and never submits the booleans from form data", () => {
    // The server action MUST derive the booleans locally from the mode
    // enum, never read them from form data. This is the load-bearing
    // safety property that prevents a malicious client from submitting
    // the invalid (false, true) combination.
    expect(ACTIONS_SRC).toMatch(/VALID_INVITE_POLICY_MODES/);
    expect(ACTIONS_SRC).toMatch(
      /allow_public_registration\s*=\s*mode\s*!==\s*["']invite-only["']/
    );
    expect(ACTIONS_SRC).toMatch(
      /require_registration_approval\s*=\s*mode\s*===\s*["']public-with-approval["']/
    );
    // Negative: the action MUST NOT read either boolean directly from
    // FormData. A regression that did `formData.get("allow_public_registration")`
    // would bypass the mode-only safety contract.
    expect(ACTIONS_SRC).not.toMatch(
      /formData\.get\(\s*["']allow_public_registration["']\s*\)/
    );
    expect(ACTIONS_SRC).not.toMatch(
      /formData\.get\(\s*["']require_registration_approval["']\s*\)/
    );
  });

  it("settings-helpers.ts invite-policy section contains no credential-material literals (post-comment-strip)", () => {
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

  it("settings-helpers.ts invite-policy section contains no real fixture identifiers (post-comment-strip)", () => {
    const NO_COMMENTS = stripComments(HELPER_SRC);
    expect(NO_COMMENTS).not.toMatch(/\baudi\b/i);
    expect(NO_COMMENTS).not.toMatch(/admin@audi/i);
  });
});
