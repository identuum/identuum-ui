/**
 * Account Settings Stability Harness — UI side.
 *
 * Landed by agent-a-20260743-account-settings-stability-harness-implementation
 * per the audit + contract plan in
 * wiki/repos/identuum-ui.md §"Account Settings Stability Harness — audit
 * + contract plan (2026-06-24)".
 *
 * Purpose: stop the whack-a-mole regression cycle around /account/settings.
 * The MFA tab, the layout's sidebar, and the Passkeys tab have each broken
 * in sequence over the last few slices; this harness pins each of those
 * invariants at the SOURCE-TEXT layer so future drift fails a test rather
 * than ships to the operator.
 *
 * Layers covered (per the audit's 6-layer contract):
 *   1. UI source-invariant — tab inventory, named-constant endpoint use.
 *   2. UI exclusive-state — MFA tab never co-renders contradictory banners
 *      (this is also pinned at the AccountMFAEnrollForm + EnrollmentCTA
 *      level by account-mfa-enrollment-done-button.test.ts; here we pin
 *      the parent MfaSection's branch-selection invariants).
 *   3. UI layout-shape — account/layout.tsx renders the role-shell aside +
 *      main pattern and reads idpCapabilities the SAME way the role-shell
 *      layouts do.
 *
 * The Passkeys ↔ CE webauthn=false mismatch is documented here as a
 * KNOWN-GAP test that PASSES today: it pins the current observable state
 * (UI offers an unconditional Passkeys tab while CE declares
 * webauthn=false) so that Prompt 3's UI capability gate cleanly flips the
 * pin. Marking it `it.todo` would lose the assertion that the current
 * state is what we documented; marking it `it.skip` would silently allow
 * drift. Instead we assert the current shape AND name a TODO sentinel so
 * Prompt 3 sees a clear migration target.
 *
 * SECURITY:
 *   - This file uses only source-text reflection. NO real secrets, no
 *     cookies, no TOTP codes, no recovery codes, no passwords are
 *     referenced. Placeholder labels only.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── Layer 1 — Tab inventory + named-constant endpoint use ────────────────────

describe("Account Settings — tab inventory invariant", () => {
  const page = source("app/account/settings/page.tsx");

  // THE-PROFILE-CLAIMS (2026-09-02, owner ruled): a fifth tab — Profile —
  // edits the caller's own OIDC §5.1 profile fields via PUT /api/v1/profile.
  // The contract is raised deliberately from four to five tabs; the union,
  // the whitelist and the nav are pinned END-ANCHORED so a sixth tab fires.
  it("page.tsx declares the closed Tab enum 'password' | 'sessions' | 'passkeys' | 'mfa' | 'profile'", () => {
    expect(page).toMatch(
      /type\s+Tab\s*=\s*"password"\s*\|\s*"sessions"\s*\|\s*"passkeys"\s*\|\s*"mfa"\s*\|\s*"profile"\s*;/
    );
  });

  it("parseTab whitelists exactly the five tab values", () => {
    expect(page).toMatch(
      /s\s*===\s*"password"\s*\|\|\s*s\s*===\s*"sessions"\s*\|\|\s*s\s*===\s*"passkeys"\s*\|\|\s*s\s*===\s*"mfa"\s*\|\|\s*s\s*===\s*"profile"\s*\)/
    );
  });

  it("page.tsx renders exactly the five documented tab nav entries", () => {
    // Catch a regression that adds a UI tab without harness coverage.
    for (const value of ["password", "profile", "mfa", "sessions", "passkeys"]) {
      expect(page).toMatch(new RegExp(`value:\\s*"${value}"`));
    }
    // Negative: no sixth tab label sneaks in. We pin only the label
    // literals used in the existing tab nav (`{ label: "...", value: "..." }`),
    // so a literal-string drift in the nav fires here. The Passkeys entry
    // carries an `as Tab` type annotation because it's spread from a
    // conditional after agent-a-20260744's capability gate landed; the
    // regex tolerates the optional annotation.
    const labelLines =
      page.match(/\{\s*label:\s*"[^"]+",\s*value:\s*"[a-z]+"(?:\s+as\s+Tab)?\s*\}/g) ?? [];
    expect(labelLines.length).toBe(5);
  });

  it("default tab when no tab+reason is provided is 'password'", () => {
    expect(page).toMatch(/return\s+"password"\s*;[\s\S]{0,80}\}\s*\n/);
  });
});

// ── Layer 1b — Named-constant endpoint use (no literal-path drift) ──────────

describe("Account Settings — endpoint constants source of truth", () => {
  const paths = source("lib/idp-paths.ts");
  const accountClient = source("lib/idp-account-client.ts");

  it("IDP_PATHS declares the Account-Settings endpoint constants", () => {
    // Pinning each constant by name catches a rename / removal that
    // would silently break a tab's wire path.
    for (const name of [
      "mfaSetupInitiate",
      "mfaSetupComplete",
      "webauthnRegisterBegin",
      "webauthnRegisterFinish",
      "webauthnCredentials",
    ]) {
      expect(paths).toMatch(new RegExp(`${name}:`));
    }
  });

  it("idp-account-client.ts wires the /api/v1/me/mfa/* endpoints", () => {
    // The MFA self-service surface uses literals (not IDP_PATHS) because
    // these endpoints are called server-side via fetch with idpBaseUrl().
    // Pin them at this seam so a future rename of the wire path also
    // requires updating this constant.
    expect(accountClient).toMatch(/\/api\/v1\/me\/mfa\/status/);
    expect(accountClient).toMatch(/\/api\/v1\/me\/mfa\/recovery-codes\/regenerate/);
    expect(accountClient).toMatch(/\/api\/v1\/me\/mfa\/disable/);
  });
});

// ── Layer 2 — MFA tab state-exclusivity (parent MfaSection branch selection) ─

describe("Account Settings — MFA state exclusivity", () => {
  const mfaSection = source("app/account/settings/mfa-section.tsx");

  it("MfaSection branches mfaEnabled === true | === false | === undefined as mutually exclusive surfaces", () => {
    // Mutually exclusive: a value is exactly one of true/false/undefined,
    // so the three `&&`-gated branches can never co-render. Pinning the
    // exact triple here prevents a future refactor from collapsing the
    // gate into an inclusive condition.
    expect(mfaSection).toMatch(/mfaEnabled\s*===\s*true\s*&&\s*<EnrolledStatus/);
    expect(mfaSection).toMatch(/mfaEnabled\s*===\s*false\s*&&\s*<EnrollmentCTA\s*\/>/);
    expect(mfaSection).toMatch(/mfaEnabled\s*===\s*undefined\s*&&\s*<UnknownStatus\s*\/>/);
  });

  it("MfaSection delegates the 'just-enrolled' transition to the Client Component", () => {
    // The contradictory-banner bug from agent-a-20260740 lived in the
    // pre-refactor inline server-side EnrollmentCTA. Pin the new import
    // so a future refactor that re-inlines EnrollmentCTA must update
    // this assertion AND the harness contract together.
    expect(mfaSection).toMatch(/import\s+\{\s*EnrollmentCTA\s*\}\s+from\s+"\.\/enrollment-cta"/);
    expect(mfaSection).not.toMatch(/function\s+EnrollmentCTA\s*\(/);
  });

  it("MfaSection does NOT duplicate the not-enrolled copy alongside the enrolled banner", () => {
    // The literal 'Authenticator app not enrolled' string lives ONLY in
    // enrollment-cta.tsx's NotEnrolledNotice (gated behind the
    // !enrollmentJustCompleted flag). If a future refactor copies the
    // literal back into mfa-section.tsx, this fires.
    expect(mfaSection).not.toMatch(/Authenticator app not enrolled/);
    // EnrolledStatus owns the enrolled banner copy; pinning its presence
    // here doubles as a guard that the file still hosts EnrolledStatus.
    expect(mfaSection).toMatch(/Authenticator app enrolled/);
  });
});

// ── Layer 3 — Layout-shape contract (account/layout.tsx) ────────────────────

describe("Account Settings — role-shell aside + main layout pattern", () => {
  const layout = source("app/account/layout.tsx");

  it("account/layout.tsx renders an <aside> as the sidebar container", () => {
    // Pinning the <aside> token guards against a future refactor that
    // converts the layout back to the pre-agent-a-20260738 'minimal top
    // bar' shape (no sidebar) which is the original regression class.
    expect(layout).toMatch(/<aside\b/);
  });

  it("account/layout.tsx renders the SiteAdminNav + OrgAdminNav role-aware Nav components", () => {
    // The role-shell pattern reuses the EXACT Nav components used by
    // /site-admin/layout.tsx + /org-admin/layout.tsx. A refactor that
    // re-rolls a separate Nav inside /account/layout.tsx is a divergence
    // and a regression trap; pin the imports here.
    expect(layout).toMatch(
      /import\s+\{\s*SiteAdminNav\s*\}\s+from\s+"@\/components\/site-admin\/site-admin-nav"/
    );
    expect(layout).toMatch(
      /import\s+\{\s*OrgAdminNav\s*\}\s+from\s+"@\/components\/org-admin\/org-admin-nav"/
    );
  });

  it("account/layout.tsx reads idpCapabilities via components.idp.capabilities", () => {
    // This is the EXACT same access path the role-shell layouts use.
    // The original agent-a-20260738 implementation accidentally tried
    // `runtimeState?.idpCapabilities` (the wrong shape) and fired a
    // TS2339; pin the correct path so a future refactor cannot
    // re-introduce the wrong shape.
    expect(layout).toMatch(/runtimeState\?\.components\?\.idp\?\.capabilities/);
  });

  it("account/layout.tsx redirects unauthenticated visitors to /login?reason=session_expired through the tri-state guard, never on an outage", () => {
    // THE-UNAVAILABLE-IS-NOT-EXPIRED: decideSessionGuard → a VERDICT redirects
    // (LOGIN_SESSION_EXPIRED in lib/session-guard.ts), an OUTAGE renders in place.
    expect(layout).toMatch(/decideSessionGuard\(\s*await getServerSessionState\(\)\s*\)/);
    expect(layout).toMatch(/redirect\(\s*guard\.to\s*\)/);
    expect(layout).toMatch(/render-unavailable/);
  });

  it("account/layout.tsx uses 'force-dynamic' so the SSR'd page reflects fresh server state per request", () => {
    expect(layout).toMatch(/export\s+const\s+dynamic\s*=\s*"force-dynamic"/);
  });
});

// ── Layer 1c — Passkeys ↔ webauthn capability active-state pin ──────────────

describe("Account Settings — Passkeys / webauthn capability gate", () => {
  const page = source("app/account/settings/page.tsx");
  const passkeySection = source("components/ui/passkey-section.tsx");

  // Post-Phase-B history: CE landed real WebAuthn backend in
  // agent-a-20260787, flipping the component capability map to
  // `"webauthn": true` + mounting the 4 authenticated routes via
  // MountAPIV1WebAuthn. At runtime the Passkeys tab is now SHOWN +
  // the active `<PasskeySection />` mounts. The earlier "documented-
  // gap" history (agent-a-20260742..20260744) remains valid as the
  // structural fallback should CE ever un-mount WebAuthn: the
  // capability gate is structural code that returns to the closed
  // state automatically when `webauthnAvailable === false`.
  //
  // Contract pins below remain structural — they describe the gate
  // mechanism. The gate's RUNTIME polarity is now positive (active)
  // because CE publishes `"webauthn": true`; but the conditional
  // spread + ternary + PasskeysUnavailableNotice helper still live
  // in page.tsx as the fallback for any future capability flip.

  it("page.tsx reads idpCapabilities via the same path account/layout.tsx uses", () => {
    // The audit explicitly named this access path as the SAME shape the
    // role-shell layouts use. Pinning the exact path catches an
    // accidental return to the wrong shape (TS2339 regression class).
    expect(page).toMatch(
      /import\s+\{\s*getServerRuntimeState\s*\}\s+from\s+"@\/lib\/server-runtime-state"/
    );
    expect(page).toMatch(/runtimeState\?\.components\?\.idp\?\.capabilities\?\.webauthn/);
  });

  it("page.tsx hides the Passkeys nav entry from the tab list when webauthnAvailable is false", () => {
    // Pin the spread/conditional that adds the Passkeys nav entry only
    // when webauthnAvailable is true. The tab nav array still references
    // the literal value "passkeys", but ONLY inside a conditional that
    // disappears when the gate is closed.
    expect(page).toMatch(/webauthnAvailable\s*\?\s*\[\s*\{\s*label:\s*"Passkeys"/);
  });

  it("page.tsx renders PasskeysUnavailableNotice instead of PasskeySection when the gate is closed", () => {
    // Pin the ternary that selects between the active PasskeySection
    // and the unavailable notice. PasskeySection MUST NOT mount when
    // the gate is closed — that's the structural guarantee preventing
    // the /api/v1/webauthn/* fetch calls.
    expect(page).toMatch(
      /webauthnAvailable\s*\?\s*<PasskeySection\s*\/>\s*:\s*<PasskeysUnavailableNotice\s*\/>/
    );
  });

  it("page.tsx declares the PasskeysUnavailableNotice helper with the documented copy", () => {
    expect(page).toMatch(/function\s+PasskeysUnavailableNotice\s*\(/);
    expect(page).toMatch(/Passkeys are not available on this backend/);
    // The notice should NOT itself reference the active webauthn endpoint
    // constants — that's the structural guarantee the broken fetch
    // never fires while the gate is closed.
    expect(page).not.toMatch(/webauthnRegisterBegin/);
  });

  it("PasskeySection still uses the documented webauthn endpoint constants (active path unchanged)", () => {
    // When the gate is open (webauthn=true), PasskeySection must still
    // use the named constants. Pinning these here catches a rename that
    // would otherwise break the active path silently.
    expect(passkeySection).toMatch(/IDP_PATHS\.webauthnRegisterBegin/);
    expect(passkeySection).toMatch(/IDP_PATHS\.webauthnRegisterFinish/);
  });

  it("the user-facing error copy contract is preserved (active-path safety net)", () => {
    // When the gate is open and CE later mounts WebAuthn, the error
    // classification must still surface the documented copy on begin
    // failure. Pinning this here keeps the contract testable without
    // re-importing the classifier in this file.
    const copy = source("components/ui/passkey-enrollment-errors.ts");
    expect(copy).toMatch(
      /Could not start passkey registration\. Please try again, or contact your administrator if the problem persists\./
    );
  });
});

// ── Layer 2b — Recovery-code sensitivity invariant (cross-cutting) ──────────

describe("Account Settings — no secret material in non-secret components", () => {
  // The MFA + Passkey + Sessions components handle TOTP secrets,
  // recovery codes, WebAuthn challenges, and session_ids. None of those
  // should reach localStorage, sessionStorage, or console.* in any
  // /account/settings component. This is a cross-cutting invariant the
  // existing per-component tests pin individually; bundling it here
  // gives Account Settings a single tripwire when a future component is
  // added.
  const files = [
    "app/account/settings/page.tsx",
    "app/account/settings/mfa-section.tsx",
    "app/account/settings/enrollment-cta.tsx",
    "app/account/settings/account-mfa-enroll-form.tsx",
    "app/account/settings/mfa-self-service-forms.tsx",
    "app/account/settings/change-password-form.tsx",
    "app/account/settings/sessions-section.tsx",
    "components/ui/passkey-section.tsx",
  ];

  for (const rel of files) {
    it(`${rel} does not write to localStorage/sessionStorage`, () => {
      const src = source(rel);
      expect(src).not.toMatch(/localStorage\s*\.\s*(set|get|remove)Item/);
      expect(src).not.toMatch(/sessionStorage\s*\.\s*(set|get|remove)Item/);
      expect(src).not.toMatch(/window\s*\.\s*localStorage/);
      expect(src).not.toMatch(/window\s*\.\s*sessionStorage/);
    });

    it(`${rel} does not console.log secret material`, () => {
      const src = source(rel);
      expect(src).not.toMatch(/console\s*\.\s*(log|warn|error|debug|info)\s*\(/);
    });
  }
});
