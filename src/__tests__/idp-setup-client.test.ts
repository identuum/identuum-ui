/**
 * Unit tests for src/lib/idp-setup-client.ts.
 *
 * Mocks global fetch. Each test pins one discriminated-union variant
 * of the corresponding client function so the wizard can rely on
 * narrow result shapes when rendering branch-specific UI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeSetup, getSetupStatus, verifySetupToken } from "../lib/idp-setup-client";

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): typeof fetch {
  return vi
    .fn()
    .mockImplementation(async (url: string, init?: RequestInit) =>
      handler(url, init)
    ) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getSetupStatus", () => {
  it("returns ok+status on the setup_required body shape", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "setup_required",
          setup_complete: false,
          setup_token_required: true,
          product: "identuum-idp-oss",
          distribution: "oss",
          issuer: "http://localhost:7113",
          first_signing_key_exists: false,
          site_admin_exists: false,
          first_organization_exists: false,
          next_action: "Open the setup wizard.",
        })
      )
    );

    const got = await getSetupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.state).toBe("setup_required");
    expect(got.status.setupTokenRequired).toBe(true);
    expect(got.status.product).toBe("identuum-idp-oss");
    expect(got.status.nextAction).toContain("setup wizard");
  });

  it("returns ok+status on the setup_complete body shape", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "setup_complete",
          setup_complete: true,
          setup_token_required: false,
          product: "identuum-idp-oss",
          distribution: "oss",
          first_signing_key_exists: true,
          site_admin_exists: true,
          first_organization_exists: true,
          next_action: "Use the login page.",
        })
      )
    );
    const got = await getSetupStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.state).toBe("setup_complete");
    expect(got.status.setupComplete).toBe(true);
  });

  it("returns unreachable on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const got = await getSetupStatus();
    expect(got.kind).toBe("unreachable");
  });

  it("returns error on a 503 from the proxy", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response("", { status: 503 }))
    );
    const got = await getSetupStatus();
    expect(got.kind).toBe("error");
    if (got.kind === "error") expect(got.status).toBe(503);
  });

  it("returns error when state field is unexpected", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(200, { state: "not_a_real_state" }))
    );
    const got = await getSetupStatus();
    expect(got.kind).toBe("error");
  });
});

describe("verifySetupToken", () => {
  it("returns ok on 204", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response(null, { status: 204 }))
    );
    expect((await verifySetupToken("anything")).kind).toBe("ok");
  });

  it("returns bad_token on 401", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(401, { error: "setup_token_invalid" }))
    );
    expect((await verifySetupToken("wrong")).kind).toBe("bad_token");
  });

  it("returns already_complete on 410", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(410, { error: "setup_already_complete" }))
    );
    expect((await verifySetupToken("any")).kind).toBe("already_complete");
  });

  it("returns unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    expect((await verifySetupToken("x")).kind).toBe("unreachable");
  });

  it("returns error on 500", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(500, { error: "setup_verify_failed" }))
    );
    const got = await verifySetupToken("x");
    expect(got.kind).toBe("error");
    if (got.kind === "error") expect(got.status).toBe(500);
  });
});

describe("completeSetup", () => {
  const validInput = {
    setupToken: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
    organizationName: "Acme Corp",
    organizationDomain: "acme.example",
    adminEmail: "owner@acme.example",
    adminPassword: "very-long-test-password",
  };

  it("returns ok with the completion view on 200", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "setup_complete",
          organization_id: "11111111-1111-7111-1111-111111111111",
          organization_name: "Acme Corp",
          admin_email: "owner@acme.example",
        })
      )
    );
    const got = await completeSetup(validInput);
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.result.organizationName).toBe("Acme Corp");
    expect(got.result.adminEmail).toBe("owner@acme.example");
  });

  it("returns bad_token on 401", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(401, { error: "setup_token_invalid" }))
    );
    expect((await completeSetup(validInput)).kind).toBe("bad_token");
  });

  it("returns already_complete on 410", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(410, { error: "setup_already_complete" }))
    );
    expect((await completeSetup(validInput)).kind).toBe("already_complete");
  });

  it("returns invalid with a humanized message on 400", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(400, { error: "invalid_request" }))
    );
    const got = await completeSetup(validInput);
    expect(got.kind).toBe("invalid");
    if (got.kind === "invalid") expect(got.message).toBe("invalid request");
  });

  it("returns unreachable on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    expect((await completeSetup(validInput)).kind).toBe("unreachable");
  });

  it("forwards the password in the body but never in the URL", async () => {
    const spy = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        state: "setup_complete",
        organization_id: "11111111-1111-7111-1111-111111111111",
        organization_name: "Acme Corp",
        admin_email: "owner@acme.example",
      })
    );
    vi.stubGlobal("fetch", spy);
    await completeSetup(validInput);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/idp/api/setup/complete");
    expect(url).not.toContain(validInput.adminPassword);
    expect(url).not.toContain(validInput.setupToken);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.admin_password).toBe(validInput.adminPassword);
    expect(body.setup_token).toBe(validInput.setupToken);
  });
});
