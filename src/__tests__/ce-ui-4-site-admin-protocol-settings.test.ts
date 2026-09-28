/**
 * CE-UI-4 (matrix row 119): protocol settings are the tenant's own resource.
 * identuum-idp-oss refuses site_admin on the family
 * (internal/handlers/organization_protocol_settings.go, refuseSiteAdminOnTenantResource:
 * 403), and identuum-idp-ce does too, so the site-admin organization page
 * never asks PUT /api/v1/organizations/:id/protocol-settings: the save action
 * has no site_admin path, and a site_admin submit is sent to its home.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let role = "site_admin";
vi.mock("../lib/server-session", () => ({
  getServerSession: async () => ({ user: { role }, role }),
}));

class Redirected extends Error {}
const redirect = vi.fn((to: string) => {
  throw new Redirected(to);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const updateOrgProtocolSettings = vi.fn(async () => ({
  ok: true,
  settings: { dynamic_client_registration_enabled: true, scim_enabled: false, source: "explicit" },
}));
vi.mock("../lib/idp-admin-client", () => ({
  updateOrgProtocolSettings: (...a: unknown[]) => updateOrgProtocolSettings(...(a as [])),
  getOwnOrganization: async () => ({ id: "0190f000-0000-7000-8000-000000000001" }),
}));

afterEach(() => {
  updateOrgProtocolSettings.mockClear();
  redirect.mockClear();
  role = "site_admin";
});

function form(): FormData {
  const f = new FormData();
  f.set("org_id", "0190f000-0000-7000-8000-000000000002");
  f.set("dynamic_client_registration_enabled", "true");
  f.set("scim_enabled", "false");
  return f;
}

describe("the protocol-settings save action asks PUT for the org_admin only", () => {
  it("a site_admin submit asks nothing and goes home", async () => {
    const { updateProtocolSettingsAction } = await import(
      "../app/site-admin/organizations/[id]/protocol-settings-actions"
    );
    await expect(updateProtocolSettingsAction({}, form())).rejects.toBeInstanceOf(Redirected);
    expect(updateOrgProtocolSettings).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/site-admin");
  });

  it("the org_admin saves its own organization, never the submitted org_id", async () => {
    role = "org_admin";
    const { updateProtocolSettingsAction } = await import(
      "../app/site-admin/organizations/[id]/protocol-settings-actions"
    );
    const state = await updateProtocolSettingsAction({}, form());
    expect(state.ok).toBe(true);
    expect(updateOrgProtocolSettings).toHaveBeenCalledTimes(1);
    expect(updateOrgProtocolSettings).toHaveBeenCalledWith("0190f000-0000-7000-8000-000000000001", {
      dynamic_client_registration_enabled: true,
      scim_enabled: false,
    });
  });
});
