/**
 * Behavior-contract tests for the MFA surface on /account/settings.
 *
 * Pins the tab routing rules and the per-state copy of the MFA section
 * (see UI-FEATURES.md Section 8). The page is an async Server Component;
 * we exercise it as a plain async function with mocked dependencies and
 * assert on the rendered React tree structure rather than driving a DOM.
 *
 * Invariants under test:
 *   - Default tab is `password` for a bare /account/settings.
 *   - `?tab=mfa` opens the MFA surface.
 *   - `?reason=mfa_required` opens the MFA surface even when `tab` is absent
 *     or unrecognised.
 *   - Explicit `?tab=…` wins over `?reason=mfa_required` when both are set
 *     (operator's most-recent stated intent).
 *   - `mfa_enabled === true` shows enrolled status.
 *   - `mfa_enabled === false` shows enrollment CTA distinct from password copy.
 *   - `mfa_enabled === undefined` shows the unknown-status surface (NOT the
 *     enrollment CTA) — rolling-upgrade safety.
 *   - No TOTP secret, otpauth URI, or QR payload appears in any state of
 *     this surface.
 */

import { describe, expect, it, vi } from "vitest";

// Minimal mocks for the page's transitive dependencies. The page imports
// ChangePasswordForm, SessionsSection, PasskeySection, and the IDP admin
// client. We do not exercise their behavior in this spec — only the MFA
// tab routing and rendering — so cheap stubs are enough.
vi.mock("../app/account/settings/change-password-form", () => ({
  ChangePasswordForm: () => null,
}));
vi.mock("../app/account/settings/sessions-section", () => ({
  SessionsSection: () => null,
}));
vi.mock("../components/ui/passkey-section", () => ({
  PasskeySection: () => null,
}));
// AccountMFAEnrollForm is a "use client" component that pulls in qrcode.react,
// react-hook-form, and the authenticated fetch calls. None of that is needed
// to assert the surrounding page surface — replace it with a sentinel marker
// so we can verify it is rendered in the enrollment branch without driving
// the full ceremony.
vi.mock("../app/account/settings/account-mfa-enroll-form", () => ({
  AccountMFAEnrollForm: () => "[[ACCOUNT_MFA_ENROLL_FORM]]",
}));
// EnrollmentCTA is a "use client" wrapper that calls useState + useRouter;
// invoking it from this server-component walker would throw. It is stubbed
// to emit the same observable surface (the not-enrolled warning copy + the
// AccountMFAEnrollForm sentinel) the previous server-side EnrollmentCTA
// emitted, so all pre-existing assertions in this file remain valid. The
// CLIENT-side state-machine + Done-button contract is pinned separately by
// src/__tests__/account-mfa-enrollment-done-button.test.ts.
vi.mock("../app/account/settings/enrollment-cta", () => ({
  EnrollmentCTA: () =>
    "Authenticator app not enrolled — Your account requires two-factor authentication. [[ACCOUNT_MFA_ENROLL_FORM]]",
}));
vi.mock("../app/account/settings/mfa-self-service-forms", () => ({
  RecoveryCodesRegenerateForm: () => "[[RECOVERY_CODES_REGENERATE_FORM]]",
  DisableMfaForm: () => "[[DISABLE_MFA_FORM]]",
}));
const mockGetOwnMfaStatus = vi.hoisted(() => vi.fn());

vi.mock("../lib/idp-account-client", () => ({
  listOwnSessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
  getOwnMfaStatus: () => mockGetOwnMfaStatus(),
}));

// getServerSession is the only dependency that actually feeds MFA state
// into the page. Each test stubs the return value before invoking the
// page function.
const mockGetServerSession = vi.fn();
vi.mock("../lib/server-session", () => ({
  getServerSession: () => mockGetServerSession(),
}));

// getServerRuntimeState gates the Passkeys tab visibility per
// agent-a-20260744. This test file asserts MFA-tab behaviour only, so a
// stable null return (capability map absent → webauthn falsy → tab
// hidden) keeps the existing assertions byte-identical. Tests focused
// on the Passkeys capability gate live in account-settings-stability-
// harness.test.ts.
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: vi.fn().mockResolvedValue(null),
}));

import AccountSettingsPage from "../app/account/settings/page";

// Helper: render the page with the given search params and pretty-print
// the resulting React tree's text content so we can assert against it
// without setting up a DOM. JSX returned by an async Server Component is
// a tree of React elements; we walk it.
async function renderText(
  searchParams: Record<string, string | string[] | undefined>,
  sessionUser: { mfa_enabled?: boolean } | null = { mfa_enabled: true }
): Promise<string> {
  if (sessionUser === null) {
    mockGetServerSession.mockResolvedValue(null);
  } else {
    mockGetServerSession.mockResolvedValue({
      role: "org_admin",
      user: {
        id: "00000000-0000-0000-0000-000000000001",
        email: "a@example.com",
        role: "org_admin",
        ...sessionUser,
      },
    });
  }
  if (sessionUser && "mfa_enabled" in sessionUser) {
    mockGetOwnMfaStatus.mockResolvedValue({
      ok: true,
      status: {
        mfa_enabled: Boolean(sessionUser.mfa_enabled),
        totp_enrolled: Boolean(sessionUser.mfa_enabled),
        recovery_codes_remaining_count: sessionUser.mfa_enabled ? 4 : 0,
      },
    });
  } else {
    mockGetOwnMfaStatus.mockResolvedValue({
      ok: false,
      statusCode: 404,
      unavailable: true,
      unauthorized: false,
    });
  }
  const element = await AccountSettingsPage({
    searchParams: Promise.resolve(searchParams),
  });
  return reactTreeToText(element);
}

// biome-ignore lint/suspicious/noExplicitAny: walking React element tree
function reactTreeToText(node: any): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactTreeToText).join(" ");
  if (typeof node === "object" && node.props) {
    if (typeof node.type === "function") {
      // Invoke the function component to walk its output. For our stub
      // components (ChangePasswordForm, SessionsSection, PasskeySection)
      // this returns null. For real components like MfaSection, this
      // renders the actual subtree.
      const out = node.type(node.props);
      return reactTreeToText(out);
    }
    return reactTreeToText(node.props.children);
  }
  return "";
}

describe("/account/settings — MFA tab routing", () => {
  it("defaults to password tab when no tab or reason is present", async () => {
    const text = await renderText({});
    expect(text).toMatch(/Change your password/);
    // MFA-specific operator copy must not appear on the password default.
    expect(text).not.toMatch(/Authenticator app/);
    expect(text).not.toMatch(/Two-factor authentication is required/);
  });

  it("?tab=mfa opens the MFA surface", async () => {
    const text = await renderText({ tab: "mfa" });
    expect(text).toMatch(/Two-factor authentication/);
    expect(text).not.toMatch(/Change your password/);
  });

  it("?reason=mfa_required opens the MFA surface even without an explicit tab", async () => {
    const text = await renderText({ reason: "mfa_required" }, { mfa_enabled: false });
    expect(text).toMatch(/Two-factor authentication is required for your role/);
    expect(text).toMatch(/Authenticator app not enrolled/);
    expect(text).not.toMatch(/Change your password/);
  });

  it("explicit ?tab=password wins over ?reason=mfa_required", async () => {
    // The operator's most-recent stated intent (explicit tab) takes
    // precedence over the redirect reason. This lets an operator who
    // arrived via mfa_required navigate back to the password tab without
    // having the reason param keep pulling them back.
    const text = await renderText({ tab: "password", reason: "mfa_required" });
    expect(text).toMatch(/Change your password/);
    expect(text).not.toMatch(/Authenticator app/);
  });

  it("unrecognised ?tab=… falls back to mfa when reason=mfa_required is also set", async () => {
    const text = await renderText(
      { tab: "garbage", reason: "mfa_required" },
      { mfa_enabled: false }
    );
    expect(text).toMatch(/Authenticator app not enrolled/);
  });

  it("unrecognised ?tab=… falls back to password when no reason is set", async () => {
    const text = await renderText({ tab: "garbage" });
    expect(text).toMatch(/Change your password/);
  });
});

describe("/account/settings — MFA section per-state copy", () => {
  it("renders enrolled-status copy when mfa_enabled is true", async () => {
    const text = await renderText({ tab: "mfa" }, { mfa_enabled: true });
    expect(text).toMatch(/Authenticator app enrolled/);
    expect(text).toMatch(/Sign-in requires a code/);
    expect(text).toMatch(/Recovery codes remaining:\s+4/);
    expect(text).not.toMatch(/not enrolled/i);
  });

  it("renders enrollment form (in-place) distinct from password copy when mfa_enabled is false", async () => {
    const text = await renderText({ tab: "mfa" }, { mfa_enabled: false });
    expect(text).toMatch(/Authenticator app not enrolled/);
    // The CTA must mount the in-place enrollment form, NOT a sign-out CTA.
    expect(text).toMatch(/\[\[ACCOUNT_MFA_ENROLL_FORM\]\]/);
    // The previous sign-out workaround must no longer appear.
    expect(text).not.toMatch(/Sign out to enroll authenticator/);
    // Must not mislead the operator toward the password tab.
    expect(text).not.toMatch(/Change your password/i);
  });

  it("renders neutral status surface (NOT the enrollment form) when mfa_enabled is undefined", async () => {
    const text = await renderText({ tab: "mfa" }, {});
    expect(text).toMatch(/Authenticator status unavailable/);
    // Critical rolling-upgrade safety: do not present the operator as
    // unenrolled merely because the IDP build does not report the flag.
    expect(text).not.toMatch(/Authenticator app not enrolled/);
    expect(text).not.toMatch(/\[\[ACCOUNT_MFA_ENROLL_FORM\]\]/);
  });

  it("does NOT mount the in-place enrollment form when mfa_enabled is true", async () => {
    // The enrolled-status branch must not render the form. The form's
    // initiate call would receive HTTP 409 from the server, but rendering
    // it at all is a leakage / UX bug.
    const text = await renderText({ tab: "mfa" }, { mfa_enabled: true });
    expect(text).toMatch(/Authenticator app enrolled/);
    expect(text).not.toMatch(/\[\[ACCOUNT_MFA_ENROLL_FORM\]\]/);
  });

  it("the page-level MFA section never renders secret material directly", async () => {
    // The MfaSection itself never renders secret/otpauth/QR strings — those
    // appear only inside the AccountMFAEnrollForm client component (mocked
    // out in this spec). This pins the boundary: a regression that moved
    // credential rendering up into the server component would surface here.
    for (const mfa of [true, false, undefined]) {
      const text = await renderText({ tab: "mfa" }, mfa === undefined ? {} : { mfa_enabled: mfa });
      expect(text).not.toMatch(/otpauth:\/\//);
      expect(text).not.toMatch(/Secret key/);
      expect(text).not.toMatch(/Show provisioning URL/);
    }
  });
});
