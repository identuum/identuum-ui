/**
 * FUNC-M7 (audits/oss-functionality-2026-10-05.md): the create form said the
 * role defaults to org_admin (the IdP creates org_user), that a blank expiry
 * takes an organization default the IdP caps (it stores none: the account
 * never expires), and called client_credentials "a future feature" while
 * POST /organizations/{id}/service-accounts/with-client issues a working
 * client. The pages now say what the IdP does.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(__dirname, "../app/org-admin/service-accounts");
const read = (p: string) => readFileSync(resolve(dir, p), "utf8");

describe("service-account pages say what the IdP does", () => {
  const form = read("new/create-service-account-form.tsx");

  it("the role defaults to org_user", () => {
    expect(form).toContain("(optional — defaults to org_user)");
    expect(form).toContain('<option value="">org_user (default)</option>');
    expect(form).toContain('state.created.role || "org_user"');
    expect(form).not.toMatch(/defaults to org_admin|org_admin \(default\)/);
  });

  it("a blank expiry never expires", () => {
    expect(form).toContain("Leave blank and the service account never expires.");
    expect(form).not.toContain("organization-default expiry");
  });

  it("no page calls the credential a future feature; the bundle route is named", () => {
    for (const p of ["new/create-service-account-form.tsx", "new/page.tsx", "page.tsx"]) {
      expect(read(p)).not.toContain("future feature");
    }
    expect(form).toContain("/service-accounts/with-client");
  });
});
