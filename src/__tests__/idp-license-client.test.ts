/**
 * Unit tests for src/lib/idp-license-client.ts.
 *
 * Mocks global fetch. Each test pins one discriminated-union variant
 * of getLicenseStatus / uploadLicense so the wizard's CE license
 * step can rely on narrow result shapes when rendering branch-
 * specific UI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLicenseStatus, uploadLicense } from "../lib/idp-license-client";

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

describe("getLicenseStatus", () => {
  it("returns ok+status on the license_missing body shape", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "license_missing",
          distribution: "ce",
          product: "identuum-idp-ce",
          next_action: "Upload a CE license through the setup wizard.",
        })
      )
    );
    const got = await getLicenseStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.state).toBe("license_missing");
    expect(got.status.distribution).toBe("ce");
    expect(got.status.tier).toBeUndefined();
    expect(got.status.licensee).toBeUndefined();
  });

  it("projects the license_valid body shape with optional fields", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "license_valid",
          distribution: "ce",
          product: "identuum-idp-ce",
          tier: "professional",
          licensee: "Acme Corp",
          expires_at: "2026-12-31T00:00:00Z",
          license_id: "lic-001",
          license_type: "customer",
          next_action: "License is active.",
        })
      )
    );
    const got = await getLicenseStatus();
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.tier).toBe("professional");
    expect(got.status.licensee).toBe("Acme Corp");
    expect(got.status.expiresAt).toBe("2026-12-31T00:00:00Z");
    expect(got.status.licenseId).toBe("lic-001");
  });

  it("returns unreachable when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => {
        throw new Error("network");
      })
    );
    const got = await getLicenseStatus();
    expect(got.kind).toBe("unreachable");
  });

  it("returns error on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response("oops", { status: 500 }))
    );
    const got = await getLicenseStatus();
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.status).toBe(500);
  });

  it("returns error when the state field is not in the wire-stable enum", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "license_unknown_future_state",
          distribution: "ce",
          product: "identuum-idp-ce",
        })
      )
    );
    const got = await getLicenseStatus();
    expect(got.kind).toBe("error");
  });

  it("returns error when the response body is an array", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(200, []))
    );
    const got = await getLicenseStatus();
    expect(got.kind).toBe("error");
  });

  it("returns error when the response body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        () =>
          new Response("not json", {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    );
    const got = await getLicenseStatus();
    expect(got.kind).toBe("error");
  });
});

describe("uploadLicense", () => {
  it("returns ok+status on success", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "license_valid",
          distribution: "ce",
          product: "identuum-idp-ce",
          tier: "professional",
          licensee: "Acme Corp",
        })
      )
    );
    const got = await uploadLicense({ setupToken: "OK", license: "envelope" });
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.state).toBe("license_valid");
    expect(got.status.licensee).toBe("Acme Corp");
  });

  it("posts to the same-origin /api/idp/api/setup/license proxy", async () => {
    let observedURL: string | undefined;
    let observedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      mockFetch((url, init) => {
        observedURL = url;
        observedInit = init;
        return jsonResponse(200, {
          state: "license_valid",
          distribution: "ce",
          product: "identuum-idp-ce",
        });
      })
    );
    await uploadLicense({ setupToken: "OK", license: "envelope" });
    expect(observedURL).toBe("/api/idp/api/setup/license");
    expect(observedInit?.method).toBe("POST");
  });

  it("returns bad_token when 401 setup_token_invalid", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(401, { error: "setup_token_invalid" }))
    );
    const got = await uploadLicense({ setupToken: "WRONG", license: "envelope" });
    expect(got.kind).toBe("bad_token");
  });

  it("returns setup_token_required when 401 setup_token_required", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(401, { error: "setup_token_required" }))
    );
    const got = await uploadLicense({ setupToken: "", license: "envelope" });
    expect(got.kind).toBe("setup_token_required");
  });

  it("returns admin_upload_pending on 401 admin_upload_pending", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(401, {
          error: "admin_upload_pending",
          next_action: "deferred follow-on",
        })
      )
    );
    const got = await uploadLicense({ setupToken: "X", license: "envelope" });
    expect(got.kind).toBe("admin_upload_pending");
    if (got.kind !== "admin_upload_pending") return;
    expect(got.message).toBe("deferred follow-on");
  });

  it.each([
    ["license_envelope_required", 400],
    ["license_envelope_malformed", 400],
    ["license_invalid", 400],
    ["license_expired", 400],
    ["license_product_mismatch", 400],
    ["license_persist_failed", 503],
    ["license_persist_path_unset", 503],
  ] as const)("maps %s on status %d to rejected", async (code, status) => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(status, { error: code }))
    );
    const got = await uploadLicense({ setupToken: "OK", license: "envelope" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe(code);
  });

  it("returns unreachable on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => {
        throw new Error("network");
      })
    );
    const got = await uploadLicense({ setupToken: "OK", license: "envelope" });
    expect(got.kind).toBe("unreachable");
  });

  it("returns error for unrecognised non-ok payloads", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(500, { error: "unknown_future_failure" }))
    );
    const got = await uploadLicense({ setupToken: "OK", license: "envelope" });
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.status).toBe(500);
  });

  it("returns bad_token when 401 carries an unrecognised error code", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(401, { error: "something_else" }))
    );
    const got = await uploadLicense({ setupToken: "X", license: "envelope" });
    expect(got.kind).toBe("bad_token");
  });

  it("forwards the operator-supplied license text verbatim in the request body", async () => {
    let captured: unknown = null;
    vi.stubGlobal(
      "fetch",
      mockFetch(async (_url, init) => {
        captured = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse(200, {
          state: "license_valid",
          distribution: "ce",
          product: "identuum-idp-ce",
        });
      })
    );
    await uploadLicense({
      setupToken: "ABC123",
      license: '{"envelope_version":2,"license":"x","signature":"y"}',
    });
    expect(captured).toEqual({
      setup_token: "ABC123",
      license: '{"envelope_version":2,"license":"x","signature":"y"}',
    });
  });
});
