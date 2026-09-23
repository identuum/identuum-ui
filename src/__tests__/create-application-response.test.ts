import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

import { createOrganizationClient } from "@/lib/idp-admin-client";

afterEach(() => vi.unstubAllGlobals());

// OSS HandleCreateClient answers 201 {"client": <safe client>, "client_secret": "..."}
// (identuum-idp-oss internal/handlers/clients.go). The success panel's name,
// client ID and redirect URIs come from the nested client; the one-time
// secret from the top level. Found by PLAN-D-2's browser run: the panel
// rendered " has been created." with an empty client ID.
it("reads the created application from OSS's wrapped response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            client: {
              id: "01990000-0000-7000-8000-0000000000c1",
              client_id: "fixture-client-id",
              name: "Fixture app",
              is_public: false,
              redirect_uris: ["https://rp.example.test/callback"],
              token_endpoint_auth_method: "client_secret_basic",
            },
            client_secret: "fixture-secret-not-real",
          }),
          { status: 201 }
        )
    )
  );
  const result = await createOrganizationClient({
    name: "Fixture app",
    redirect_uris: ["https://rp.example.test/callback"],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toMatchObject({
    id: "01990000-0000-7000-8000-0000000000c1",
    client_id: "fixture-client-id",
    name: "Fixture app",
    redirect_uris: ["https://rp.example.test/callback"],
    token_endpoint_auth_method: "client_secret_basic",
  });
  expect(result.data.client_secret).toBe("fixture-secret-not-real");
});

it("still reads a flat response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "01990000-0000-7000-8000-0000000000c2",
            client_id: "flat-client-id",
            name: "Flat app",
            client_secret: "flat-secret-not-real",
          }),
          { status: 201 }
        )
    )
  );
  const result = await createOrganizationClient({
    name: "Flat app",
    redirect_uris: ["https://rp.example.test/callback"],
  });
  expect(result.ok && result.data.client_id).toBe("flat-client-id");
  expect(result.ok && result.data.client_secret).toBe("flat-secret-not-real");
});
