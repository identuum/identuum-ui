/**
 * The site administrator's organization edit sends only lifecycle fields.
 *
 * Owner ruling (identuum-idp-oss v0.9.5): on a tenant organization a site
 * administrator changes active and the name; the policy fields (MFA,
 * sign-in, registration) belong to the organization's administrator and the
 * backend refuses them from a site administrator (403 forbidden_field). The
 * edit action therefore never sends them, and the route's 409 (an
 * organization whose administrator has not activated yet) is named for what
 * it is.
 *
 * SECURITY: every value here is a synthetic fixture.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("@/lib/server-session", () => ({
  getServerSession: async () => ({ role: "site_admin", user: { role: "site_admin" } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

afterEach(() => vi.unstubAllGlobals());

const ORG_ID = "01990000-0000-7000-8000-0000000000a1";

function submitted(): FormData {
  const fd = new FormData();
  fd.set("org_id", ORG_ID);
  fd.set("name", "Acme Renamed");
  fd.set("active", "false");
  // A stale form (or a crafted post) that still carries policy fields.
  fd.set("auth_policy", "idp_only");
  fd.set("mfa_policy", "required");
  return fd;
}

describe("site-admin organization edit", () => {
  it("sends only name and active", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: ORG_ID }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const { updateOrgAction } = await import("@/app/site-admin/organizations/[id]/edit/actions");
    await expect(updateOrgAction({}, submitted())).rejects.toThrow(
      `redirect:/site-admin/organizations/${ORG_ID}`
    );
    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    const put = calls.find(([, init]) => init?.method === "PUT");
    expect(put).toBeDefined();
    expect(JSON.parse(String(put?.[1].body))).toEqual({ name: "Acme Renamed", active: false });
  });

  it("names the activation-pending refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "activation_pending" }), { status: 409 })
      )
    );
    const { updateOrgAction } = await import("@/app/site-admin/organizations/[id]/edit/actions");
    const state = await updateOrgAction({}, submitted());
    expect(state.error).toMatch(/activation link/i);
    expect(state.error).not.toMatch(/domain or slug/i);
  });
});
