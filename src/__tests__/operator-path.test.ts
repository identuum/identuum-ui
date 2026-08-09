/**
 * operator-path.test.ts — THE-OPERATOR-PATH.
 *
 * Pins the fixes that make the operator's path from a fresh OSS appliance
 * to a signed-in site_admin actually work:
 *
 *  A. The setup wizard drives setup-time MFA ONLY on CE — released OSS
 *     serves exactly /api/setup/{status,verify-token,complete} and 404s
 *     the CE-only /api/setup/mfa/* pair, which dead-ended every OSS
 *     install at "MFA enrollment could not be started" (measured by hand
 *     on v0.3.3). On OSS the wizard completes directly; the authenticator
 *     is enrolled at first sign-in via the login flow.
 *  A'. OSS's complete REQUIRES organization_name — the wizard renders the
 *     org fields unconditionally there (no CE tenant-org checkbox).
 *  C. The "Site administrator contact email" field states both facts at
 *     the point of action: the field is the CONTACT address
 *     (users.contact_email) and the LOGIN is ALWAYS
 *     site_admin@system.local, shown as a read-only fact.
 *  +  The first-login enrollment form fires /enroll/initiate exactly once
 *     per session handle (the backend refuses re-initiation; React
 *     StrictMode's double effect used to turn that refusal into a bogus
 *     "Setup session expired" — measured live).
 *  D. The org-link console's dead "not configured or" copy half is cut,
 *     and the preset composer derives every URL from a port.
 *
 * Style: source-invariant pins (no React render). Red-proved by running
 * against the pre-fix tree via git stash.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");
const WIZARD = src("app/setup/setup-wizard.tsx");
const ENROLL_FORM = src("components/auth/mfa-enroll-form.tsx");
const ORG_LINK = src("app/site-admin/org-link/page.tsx");
const PRESET = readFileSync(resolve(ROOT, "..", "scripts", "ui-runtime-preset.mjs"), "utf-8");

describe("THE-OPERATOR-PATH — wizard OSS path (order A)", () => {
  it("setup-time MFA is gated on the CE distribution, never assumed", () => {
    expect(WIZARD).toMatch(/const setupTimeMFA = distributionIsCE/);
    // The OSS branch completes directly, before any initiateSetupMFA call.
    expect(WIZARD).toMatch(/if \(!setupTimeMFA\) \{\s*\n\s*await submitComplete\("", ""\)/);
  });

  it("org fields are unconditionally required on OSS (backend requires organization_name)", () => {
    expect(WIZARD).toMatch(/const orgFieldsAlwaysRequired = !distributionIsCE/);
    // The CE tenant-org checkbox renders only when NOT orgFieldsAlwaysRequired.
    expect(WIZARD).toMatch(/\{!orgFieldsAlwaysRequired && \(/);
    // The org-fields block renders for OSS OR the CE checkbox.
    expect(WIZARD).toMatch(/orgFieldsAlwaysRequired \|\| createTenantOrg \?/);
  });

  it("the submit label reads Complete setup on OSS and the success screen names first-login enrollment", () => {
    expect(WIZARD).toMatch(/: "Complete setup"/);
    expect(WIZARD).toContain("You will enroll your authenticator app at first sign-in.");
  });
});

describe("THE-OPERATOR-PATH — the misleading email field (order C)", () => {
  it("the field is labelled as the CONTACT email and the pinned login is a read-only fact", () => {
    expect(WIZARD).toContain("Site administrator contact email");
    expect(WIZARD).toContain('data-testid="setup-pinned-login"');
    expect(WIZARD).toContain("site_admin@system.local");
    expect(WIZARD).toContain("Do not\n              enter the sign-in name here.");
  });

  it("the success screen names the pinned sign-in identity", () => {
    expect(WIZARD).toContain('data-testid="setup-success-signin-hint"');
  });
});

describe("THE-OPERATOR-PATH — single-initiate enrollment (found by the wizard spec's live run)", () => {
  it("the enroll form shares ONE initiate promise per session handle across StrictMode's double effect", () => {
    expect(ENROLL_FORM).toMatch(/const initiateRef = useRef<\{/);
    expect(ENROLL_FORM).toMatch(
      /if \(!initiateRef\.current \|\| initiateRef\.current\.sessionId !== sessionId\)/
    );
    // The old shape — a fresh fetch per effect run — must not return.
    expect(ENROLL_FORM).not.toMatch(/^\s*mfaEnrollInitiate\(sessionId\)\s*$/m);
  });
});

describe("THE-OPERATOR-PATH — ergonomics (order D)", () => {
  it("org-link's dead 'not configured or' copy half is cut on both cards", () => {
    expect(ORG_LINK).toContain("AG is not reachable.");
    expect(ORG_LINK).toContain("IDP is not reachable.");
    expect(ORG_LINK).not.toContain("not configured or not reachable");
  });

  it("the preset composer derives ui_origin and internal_base_url from ports — never hand-typed hosts", () => {
    expect(PRESET).toMatch(/const local = \(p\) => `http:\/\/localhost:\$\{p\}`/);
    expect(PRESET).toMatch(/ui_origin: local\(uiPort\)/);
    expect(PRESET).toMatch(/internal_base_url: local\(idpPort\)/);
    // The recurring trap host never appears as a composed value.
    expect(PRESET).not.toMatch(/internal_base_url:\s*["'`]http:\/\/host\.docker\.internal/);
  });
});
