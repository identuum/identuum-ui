import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  resolve(
    __dirname,
    "..",
    "app",
    "site-admin",
    "organizations",
    "[id]",
    "reset-admin-mfa-button.tsx"
  ),
  "utf-8"
);

const NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("ResetAdminMFAButton dialog contract", () => {
  it("uses a native dialog instead of a role=dialog div", () => {
    expect(NO_COMMENTS).toMatch(/useRef<HTMLDialogElement>\(null\)/);
    expect(NO_COMMENTS).toMatch(/<dialog[\s\S]*ref=\{dialogRef\}/);
    expect(NO_COMMENTS).toMatch(/dialog\.showModal\(\)/);
    expect(NO_COMMENTS).toMatch(/dialog\.show\(\)/);
    expect(NO_COMMENTS).toMatch(/dialog\.close\(\)/);
    expect(NO_COMMENTS).not.toMatch(/role=["']dialog["']/);
  });

  it("keeps a stable accessible dialog name", () => {
    expect(NO_COMMENTS).toMatch(/aria-labelledby="reset-mfa-dialog-title"/);
    expect(NO_COMMENTS).toMatch(
      /<h2[\s\S]*id="reset-mfa-dialog-title"[\s\S]*>\s*Reset MFA\s*<\/h2>/
    );
  });

  it("keeps Escape and native cancel disabled while the reset is pending", () => {
    expect(NO_COMMENTS).toMatch(/e\.key === "Escape" && !isPending[\s\S]*setOpen\(false\)/);
    expect(NO_COMMENTS).toMatch(
      /onCancel=\{\(e\) => \{[\s\S]*if \(isPending\) \{[\s\S]*e\.preventDefault\(\);[\s\S]*return;[\s\S]*\}[\s\S]*setOpen\(false\);[\s\S]*\}\}/
    );
  });

  it("preserves click-outside close without closing during submit", () => {
    expect(NO_COMMENTS).toMatch(/getBoundingClientRect\(\)/);
    expect(NO_COMMENTS).toMatch(/e\.clientX < rect\.left/);
    expect(NO_COMMENTS).toMatch(/e\.clientX > rect\.right/);
    expect(NO_COMMENTS).toMatch(/e\.clientY < rect\.top/);
    expect(NO_COMMENTS).toMatch(/e\.clientY > rect\.bottom/);
    expect(NO_COMMENTS).toMatch(/if \(clickedOutside && !isPending\) \{[\s\S]*setOpen\(false\);/);
  });

  it("keeps the form action, hidden inputs, and disabled controls wired", () => {
    expect(NO_COMMENTS).toMatch(/<form\s+action=\{action\}/);
    expect(NO_COMMENTS).toMatch(/<input\s+type="hidden"\s+name="user_id"\s+value=\{userId\}/);
    expect(NO_COMMENTS).toMatch(/<input\s+type="hidden"\s+name="org_id"\s+value=\{orgId\}/);
    expect(NO_COMMENTS).toMatch(
      /<button[\s\S]*type="button"[\s\S]*onClick=\{\(\) => setOpen\(false\)\}[\s\S]*disabled=\{isPending\}[\s\S]*>\s*Cancel\s*<\/button>/
    );
    expect(NO_COMMENTS).toMatch(
      /<button[\s\S]*ref=\{confirmRef\}[\s\S]*type="submit"[\s\S]*disabled=\{isPending\}/
    );
    expect(NO_COMMENTS).toMatch(/\{isPending \? "Resetting…" : "Reset MFA"\}/);
  });
});
