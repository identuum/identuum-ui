/**
 * mfa-form-alert.test.ts — OSS-HARDEN item 2 (2026-10-01)
 *
 * The MFA step's refusal is announced as an alert, like the password step's
 * (THE-SIX-SMALL-ONES, UI 2), so a screen reader hears it and the e2e helper
 * reads the role scoped to the form instead of matching its wording.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mfa-form serverError", () => {
  it("renders inside a role=alert element", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "components", "auth", "mfa-form.tsx"),
      "utf8"
    );
    const block = src.slice(src.indexOf("{serverError && ("), src.indexOf("{serverError}"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('role="alert"');
  });
});
