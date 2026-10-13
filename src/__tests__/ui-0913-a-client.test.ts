// target: src/__tests__/ui-0913-a-client.test.ts
/**
 * UI-0913-A red-first (prep, UI-0913-AB-PREP; read at identuum-ui 5577201).
 * Client-level pins for G3, D4 and the D7/O19 sign-in words. The names the
 * tests import that do not exist at 5577201 are PROPOSALS (marked "proposed"):
 * the writer may rename them, but must keep the assertion.
 * SECURITY: every value is a fixture; no token, cookie or secret appears.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/server-runtime-state", () => ({
  getServerRuntimeState: async () => ({
    mode: "idp_only",
    components: { idp: { usable: true, capabilities: {} }, ag: null },
  }),
}));
vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: "http://ui.test",
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));
const idpFetch = vi.fn();
vi.mock("../lib/idp-transport", () => ({
  idpAuthHeaders: async () => ({}),
  idpFetch: (...args: unknown[]) => idpFetch(...args),
}));

afterEach(() => {
  idpFetch.mockReset();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("G3: a user-route 404 reads the same for both spellings (UI-0913-A item 2b)", () => {
  it.each(["not_found", "not found"])("reset link 404 %j -> 'User not found.'", async (code) => {
    idpFetch.mockResolvedValueOnce(json(404, { error: code }));
    const { createPasswordResetLink } = await import("../lib/idp-admin-client");
    const out = await createPasswordResetLink("0198b2d0-0000-7000-8000-0000000000bb");
    expect(out).toEqual({ ok: false, status: 404, message: "User not found." });
  });
});

describe("D4: the application read carries updated_at exactly as received (item 3)", () => {
  // OSS answers microsecond precision (OSS-0913-A item 2); the UI must not
  // re-format it, or the 409 check would refuse every save.
  const STAMP = "2026-10-13T09:15:42.123456Z";
  it("getOrganizationClientById keeps updated_at byte for byte", async () => {
    idpFetch.mockResolvedValueOnce(
      // OSS HandleGetClient answers the client top-level (toSafeClient).
      json(200, {
        id: "c-1",
        client_id: "app-1",
        name: "App",
        is_public: true,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: STAMP,
      })
    );
    const { getOrganizationClientById } = await import("../lib/idp-admin-client");
    const out = await getOrganizationClientById("c-1");
    expect(out.ok).toBe(true);
    expect((out as { data: { updated_at?: string } }).data.updated_at).toBe(STAMP);
  });

  it("updateOrganizationClient sends expect_updated_at when given, and only then", async () => {
    idpFetch.mockResolvedValue(json(200, { id: "c-1", client_id: "app-1", name: "App" }));
    const { updateOrganizationClient } = await import("../lib/idp-admin-client");
    await updateOrganizationClient("c-1", { name: "App", expect_updated_at: STAMP } as never);
    const sent = JSON.parse(String((idpFetch.mock.calls[0][1] as RequestInit).body));
    expect(sent.expect_updated_at).toBe(STAMP);
    await updateOrganizationClient("c-1", { name: "App" });
    const second = JSON.parse(String((idpFetch.mock.calls[1][1] as RequestInit).body));
    expect("expect_updated_at" in second).toBe(false);
  });

  it("409 client_changed is told apart from the other 409 (duplicate)", async () => {
    idpFetch.mockResolvedValueOnce(
      json(409, { error: "client_changed", message: "changed since read" })
    );
    const { updateOrganizationClient } = await import("../lib/idp-admin-client");
    const out = (await updateOrganizationClient("c-1", { name: "App" })) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    // proposed: a distinct flag; the duplicate 409 keeps conflict:true.
    expect(out.changed).toBe(true);
    expect(out.conflict).not.toBe(true);
  });
});
