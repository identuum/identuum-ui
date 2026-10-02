/**
 * CE-UI-5c: identuum-idp-ce reports `disabled` on each client (a public or
 * service-account client the OSS upgrade carried in disabled). The console
 * shows a Disabled badge and hides the actions that do not apply to a client
 * that cannot sign anyone in (edit, secret rotation). An IdP that omits the
 * field (identuum-idp-oss) reads as enabled.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: vi.fn(),
}));
vi.mock("../lib/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/runtime-config")>()),
  loadRuntimeConfig: vi.fn(() => ({ idp: { enabled: true } })),
  idpBaseUrl: vi.fn(() => "http://idp.test"),
}));

import { getOrganizationClientById, listOwnOrganizationClients } from "../lib/idp-admin-client";
import { idpFetch } from "../lib/idp-transport";

const fetchMock = vi.mocked(idpFetch);

function respond(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const wire = (extra: Record<string, unknown>) => ({
  id: "00000000-0000-0000-0000-000000000001",
  client_id: "app",
  name: "App",
  is_public: true,
  redirect_uris: [],
  ...extra,
});

beforeEach(() => fetchMock.mockReset());

describe("the client projection carries disabled", () => {
  it("keeps the IdP's disabled answer on the list", async () => {
    fetchMock.mockResolvedValueOnce(respond({ clients: [wire({ disabled: true }), wire({})] }));
    const res = await listOwnOrganizationClients();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.clients[0].disabled).toBe(true);
    expect(res.data.clients[1].disabled).toBe(false);
  });
  it("keeps it on the detail", async () => {
    fetchMock.mockResolvedValueOnce(respond(wire({ disabled: true })));
    const res = await getOrganizationClientById("00000000-0000-0000-0000-000000000001");
    expect(res.ok && res.data.disabled).toBe(true);
  });
  it("reads an IdP that omits the field as enabled", async () => {
    fetchMock.mockResolvedValueOnce(respond(wire({})));
    const res = await getOrganizationClientById("00000000-0000-0000-0000-000000000001");
    expect(res.ok && res.data.disabled).toBe(false);
  });
});

describe("the console's disabled client", () => {
  it("shows a Disabled badge and hides edit and secret rotation", async () => {
    const { ClientStatusBadge, clientActionsApply } = await import(
      "../app/org-admin/applications/client-status"
    );
    expect(renderToStaticMarkup(<ClientStatusBadge disabled />)).toContain("Disabled");
    expect(renderToStaticMarkup(<ClientStatusBadge disabled={false} />)).toBe("");
    expect(clientActionsApply({ disabled: true })).toBe(false);
    expect(clientActionsApply({ disabled: false })).toBe(true);
    expect(clientActionsApply({})).toBe(true);
  });
});
