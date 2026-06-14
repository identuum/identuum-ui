/**
 * Source invariants for the IDP OSS account self-service completion slice.
 *
 * These tests stay source-level because the repo's vitest environment is
 * node-only and the server actions depend on Next request cookies. They pin
 * the hand-coupled endpoint paths and no-sensitive-storage rules.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const ACCOUNT_CLIENT_SRC = readFileSync(resolve(ROOT, "lib", "idp-account-client.ts"), "utf-8");
const SESSION_ACTIONS_SRC = readFileSync(
  resolve(ROOT, "app", "account", "settings", "session-actions.ts"),
  "utf-8"
);
const SESSION_SECTION_SRC = readFileSync(
  resolve(ROOT, "app", "account", "settings", "sessions-section.tsx"),
  "utf-8"
);
const MFA_ACTIONS_SRC = readFileSync(
  resolve(ROOT, "app", "account", "settings", "mfa-actions.ts"),
  "utf-8"
);
const MFA_FORMS_SRC = readFileSync(
  resolve(ROOT, "app", "account", "settings", "mfa-self-service-forms.tsx"),
  "utf-8"
);

describe("IDP OSS account self-service endpoint wiring", () => {
  it("uses the OSS /me session endpoints, not legacy session-id revoke endpoints", () => {
    expect(ACCOUNT_CLIENT_SRC).toContain("/api/v1/me/sessions");
    expect(ACCOUNT_CLIENT_SRC).toContain("/api/v1/me/sessions/revoke-current");
    expect(ACCOUNT_CLIENT_SRC).toContain("/api/v1/me/sessions/revoke-others");
    expect(ACCOUNT_CLIENT_SRC).toContain("/api/v1/me/sessions/revoke-all");
    expect(ACCOUNT_CLIENT_SRC).not.toContain("/api/v1/revoke");
    expect(ACCOUNT_CLIENT_SRC).not.toContain('/api/v1/sessions"');
  });

  it("uses the OSS /me MFA status, recovery-code regeneration, and disable endpoints", () => {
    expect(ACCOUNT_CLIENT_SRC).toContain("/api/v1/me/mfa/status");
    expect(ACCOUNT_CLIENT_SRC).toContain("/api/v1/me/mfa/recovery-codes/regenerate");
    expect(ACCOUNT_CLIENT_SRC).toContain("/api/v1/me/mfa/disable");
  });

  it("degrades missing split-runtime endpoints as unavailable instead of throwing", () => {
    expect(ACCOUNT_CLIENT_SRC).toContain("status === 404 || status === 501 || status === 503");
    expect(SESSION_SECTION_SRC).toContain(
      "Session management is not available from this IDP runtime"
    );
    expect(MFA_ACTIONS_SRC).toContain("not available from this IDP runtime");
  });
});

describe("IDP OSS destructive action confirmation gates", () => {
  it("session revoke-current, revoke-others, and revoke-all require type-to-confirm literals", () => {
    expect(SESSION_ACTIONS_SRC).toContain('revoke_current: "CURRENT"');
    expect(SESSION_ACTIONS_SRC).toContain('revoke_others: "OTHERS"');
    expect(SESSION_ACTIONS_SRC).toContain('revoke_all: "ALL"');
    expect(SESSION_SECTION_SRC).toContain("Type {confirmLiteral} to confirm");
  });

  it("MFA recovery-code regeneration and disable require type-to-confirm literals", () => {
    expect(MFA_ACTIONS_SRC).toContain('parsed.data.confirm !== "REGENERATE"');
    expect(MFA_ACTIONS_SRC).toContain('parsed.data.confirm !== "DISABLE"');
    expect(MFA_FORMS_SRC).toContain("Type REGENERATE to confirm");
    expect(MFA_FORMS_SRC).toContain("Type DISABLE to confirm");
  });
});

describe("IDP OSS account self-service sensitive data invariants", () => {
  const ALL_SRC = [
    ACCOUNT_CLIENT_SRC,
    SESSION_ACTIONS_SRC,
    SESSION_SECTION_SRC,
    MFA_ACTIONS_SRC,
    MFA_FORMS_SRC,
  ].join("\n");

  it("does not use browser persistent storage for sessions, MFA status, or recovery codes", () => {
    expect(ALL_SRC).not.toMatch(/localStorage/);
    expect(ALL_SRC).not.toMatch(/sessionStorage/);
  });

  it("never accepts or submits user_id/session_id for the new self-service actions", () => {
    expect(SESSION_ACTIONS_SRC).not.toMatch(/user_id|session_id/);
    expect(SESSION_SECTION_SRC).not.toMatch(/user_id|session_id/);
  });

  it("MFA status only renders recovery-code count, not stored code values", () => {
    expect(ACCOUNT_CLIENT_SRC).toContain("recovery_codes_remaining_count");
    expect(MFA_FORMS_SRC).toContain("state.recoveryCodes.map");
    expect(MFA_FORMS_SRC).not.toMatch(/localStorage|sessionStorage/);
  });
});
