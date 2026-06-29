/**
 * Source-invariant pins for the Account Settings MFA enrollment
 * state-machine + Done button contract landed by
 * agent-a-20260740-idp-ui-mfa-enrollment-state-done-button.
 *
 * Why source-invariant rather than runtime DOM tests: the EnrollmentCTA
 * component is a "use client" wrapper that depends on Next.js App Router
 * hooks (useRouter from next/navigation) which require a Next.js test
 * harness to render at runtime. The repo's existing UI test conventions
 * (cf. src/__tests__/idp-client-mfa-enrollment.test.ts) pin behaviour at
 * the source-text layer for components whose runtime requires the full
 * App Router. We follow that convention here.
 *
 * Invariants under test:
 *   1. EnrollmentCTA suppresses the not-enrolled warning once enrollment
 *      succeeds — i.e. the JSX gate keys off the just-enrolled flag.
 *   2. EnrollmentCTA wires onSuccess + onDone into AccountMFAEnrollForm.
 *   3. EnrollmentCTA's onDone calls router.refresh() so the server tree
 *      re-fetches mfa_enabled=true and the parent flips to EnrolledStatus.
 *   4. AccountMFAEnrollForm accepts an onDone prop in its signature.
 *   5. AccountMFAEnrollForm renders a Done button in the success phase.
 *   6. The Done button's handler clears recoveryCodes from component
 *      state BEFORE invoking onDone — so a synchronous re-render
 *      triggered by the callback never sees the codes again.
 *   7. mfa-section.tsx no longer defines its own inline EnrollmentCTA;
 *      it imports the Client Component from ./enrollment-cta.tsx.
 *   8. The "Authenticator app not enrolled" warning copy lives in
 *      enrollment-cta.tsx, NOT in mfa-section.tsx.
 *   9. Recovery codes are never persisted to browser storage.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("EnrollmentCTA — state-machine contract", () => {
  const src = source("app/account/settings/enrollment-cta.tsx");

  it("declares 'use client'", () => {
    expect(src.startsWith('"use client";')).toBe(true);
  });

  it("tracks a boolean enrollmentJustCompleted via useState", () => {
    // Pin both the flag name (so a refactor renaming it without
    // rewiring the gate would surface here) and the boolean shape.
    expect(src).toMatch(/useState\(\s*false\s*\)/);
    expect(src).toMatch(/enrollmentJustCompleted/);
    expect(src).toMatch(/setEnrollmentJustCompleted/);
  });

  it("gates the not-enrolled notice on !enrollmentJustCompleted", () => {
    // The gate is JSX expression {!enrollmentJustCompleted && <NotEnrolledNotice />}
    expect(src).toMatch(/!enrollmentJustCompleted\s*&&\s*<NotEnrolledNotice\s*\/>/);
  });

  it("imports useRouter from next/navigation", () => {
    expect(src).toMatch(/from\s+"next\/navigation"/);
    expect(src).toMatch(/useRouter/);
  });

  it("wires onSuccess + onDone into AccountMFAEnrollForm", () => {
    expect(src).toMatch(/onSuccess=\{[^}]*setEnrollmentJustCompleted\(true\)/);
    expect(src).toMatch(/onDone=\{[^}]*router\.refresh\(\)/);
  });

  it("contains the canonical not-enrolled warning copy", () => {
    expect(src).toMatch(/Authenticator app not enrolled/);
    expect(src).toMatch(/Your account requires two-factor authentication/);
  });

  it("does not persist enrollment state to localStorage or sessionStorage", () => {
    expect(src).not.toMatch(/localStorage/);
    expect(src).not.toMatch(/sessionStorage/);
  });
});

describe("AccountMFAEnrollForm — Done button contract", () => {
  const src = source("app/account/settings/account-mfa-enroll-form.tsx");

  it("accepts an onDone prop in its signature", () => {
    expect(src).toMatch(/onDone\?\s*:\s*\(\)\s*=>\s*void/);
  });

  it("renders a Done button in the success phase", () => {
    expect(src).toMatch(/phase === "success"/);
    expect(src).toMatch(/onClick=\{handleDone\}/);
    // The button label is the literal "Done" so an operator
    // recognises it as the close-out action for the recovery-code
    // panel. The label is JSX text content; biome formatting may
    // wrap it across lines, so we tolerate surrounding whitespace.
    expect(src).toMatch(/>\s*Done\s*<\/Button>/);
  });

  it("clears recovery codes BEFORE invoking onDone (no leaks)", () => {
    // Pin the ordering: setRecoveryCodes([]) precedes onDone?.() in
    // the same handler so a synchronous re-render triggered by the
    // callback never re-renders the cleared codes.
    const handleDoneIdx = src.indexOf("const handleDone");
    expect(handleDoneIdx).toBeGreaterThan(0);
    const handler = src.slice(handleDoneIdx, handleDoneIdx + 400);
    const clearIdx = handler.indexOf("setRecoveryCodes([])");
    const callIdx = handler.indexOf("onDone?.()");
    expect(clearIdx).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(clearIdx);
  });

  it("never persists recovery codes to localStorage or sessionStorage", () => {
    // Catch actual member access, not doc-comment mentions. The form's
    // security doc-comment legitimately says "never persisted to
    // localStorage / sessionStorage / URL" — that doesn't constitute
    // usage.
    expect(src).not.toMatch(/localStorage\s*\.\s*(set|get|remove)Item/);
    expect(src).not.toMatch(/sessionStorage\s*\.\s*(set|get|remove)Item/);
    expect(src).not.toMatch(/window\s*\.\s*localStorage/);
    expect(src).not.toMatch(/window\s*\.\s*sessionStorage/);
  });

  it("does not console.log secret material", () => {
    // Belt-and-braces: ensure the form never logs anything. The
    // existing security doc-comment promises secrets are only in
    // component state.
    expect(src).not.toMatch(/console\s*\.\s*(log|warn|error|debug|info)\s*\(/);
  });

  it("declares 'use client'", () => {
    expect(src.startsWith('"use client";')).toBe(true);
  });
});

describe("MfaSection — delegates EnrollmentCTA to the Client Component", () => {
  const src = source("app/account/settings/mfa-section.tsx");

  it("imports EnrollmentCTA from ./enrollment-cta", () => {
    expect(src).toMatch(/import\s+\{\s*EnrollmentCTA\s*\}\s+from\s+"\.\/enrollment-cta"/);
  });

  it("does not define its own inline EnrollmentCTA function", () => {
    expect(src).not.toMatch(/function\s+EnrollmentCTA\s*\(/);
  });

  it("does not duplicate the not-enrolled warning copy", () => {
    // The copy now lives in enrollment-cta.tsx only.
    expect(src).not.toMatch(/Authenticator app not enrolled/);
  });

  it("still renders the EnrolledStatus / UnknownStatus / EnrollmentCTA branches by mfaEnabled", () => {
    expect(src).toMatch(/mfaEnabled === true\s*&&\s*<EnrolledStatus/);
    expect(src).toMatch(/mfaEnabled === false\s*&&\s*<EnrollmentCTA\s*\/>/);
    expect(src).toMatch(/mfaEnabled === undefined\s*&&\s*<UnknownStatus\s*\/>/);
  });
});
