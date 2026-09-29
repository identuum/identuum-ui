/**
 * OSS-BINARIES items 2–3.
 *
 * 3. The org-creation form said an admin email "requests an activation
 *    email". Under D-016 the activation LINK is shown to the site admin to
 *    hand over, and it is mailed only when email delivery is configured.
 * 2. OSS now refuses reactivating a never-activated organization (409
 *    activation_pending): its administrator activates it through the link.
 *    The Reactivate action says so instead of "Try again".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/server-session", () => ({
  getServerSession: async () => ({ role: "site_admin", user: { role: "site_admin" } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("../lib/idp-admin-client", () => ({
  updateOrganization: async () => ({ ok: false, status: 409, notFound: false, conflict: true }),
}));

describe("the org-creation form says what D-016 says", () => {
  it("the admin-email hint names the handed-over link, mailed only with email configured", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "app/site-admin/organizations/new/form-client.tsx"),
      "utf8"
    ).replace(/\s+/g, " ");
    expect(src).not.toContain("requests an activation email");
    expect(src).toMatch(/one-time activation link/);
    expect(src).toMatch(/mailed only when email delivery is configured/);
  });
});

describe("reactivating a never-activated organization is explained", () => {
  it("a 409 names the activation link instead of 'Try again'", async () => {
    const { reactivateOrgAction } = await import(
      "../app/site-admin/organizations/[id]/reactivate/actions"
    );
    const f = new FormData();
    f.set("org_id", "0198b2d0-0000-7000-8000-0000000000aa");
    const state = await reactivateOrgAction({}, f);
    expect(state.error).toMatch(/activation link/i);
    expect(state.error).not.toMatch(/Try again/);
  });
});
