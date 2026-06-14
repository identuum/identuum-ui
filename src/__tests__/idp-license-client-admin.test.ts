/**
 * Unit tests for the admin-time half of src/lib/idp-license-client.ts —
 * adminGetLicenseStatus + adminUploadLicense.
 *
 * Mocks global fetch. Each test pins one discriminated-union variant so the
 * site-admin license page can rely on narrow result shapes when rendering
 * branch-specific UI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminGetLicenseStatus, adminUploadLicense } from "../lib/idp-license-client";

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

describe("adminGetLicenseStatus", () => {
  it("calls the same-origin /api/idp/admin/license proxy with Bearer header", async () => {
    let capturedUrl = "";
    let capturedAuth: string | null = null;
    vi.stubGlobal(
      "fetch",
      mockFetch((url, init) => {
        capturedUrl = String(url);
        const headers = new Headers(init?.headers);
        capturedAuth = headers.get("authorization");
        return jsonResponse(200, {
          state: "license_missing",
          distribution: "ce",
          product: "identuum-idp-ce",
        });
      })
    );
    const got = await adminGetLicenseStatus("ce-adm-test-token");
    expect(got.kind).toBe("ok");
    expect(capturedUrl).toBe("/api/idp/admin/license");
    expect(capturedAuth).toBe("Bearer ce-adm-test-token");
  });

  it("omits Authorization when adminToken is empty", async () => {
    let capturedAuth: string | null = null;
    vi.stubGlobal(
      "fetch",
      mockFetch((_url, init) => {
        const headers = new Headers(init?.headers);
        capturedAuth = headers.get("authorization");
        return new Response(null, { status: 401 });
      })
    );
    const got = await adminGetLicenseStatus("");
    expect(got.kind).toBe("unauthorized");
    expect(capturedAuth).toBeNull();
  });

  it("returns unauthorized on 401", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response(null, { status: 401 }))
    );
    const got = await adminGetLicenseStatus("ce-adm-x");
    expect(got.kind).toBe("unauthorized");
  });

  it("returns forbidden on 403", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response(null, { status: 403 }))
    );
    const got = await adminGetLicenseStatus("ce-adm-x");
    expect(got.kind).toBe("forbidden");
  });

  it("returns unreachable on fetch throw", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => {
        throw new Error("offline");
      })
    );
    const got = await adminGetLicenseStatus("ce-adm-x");
    expect(got.kind).toBe("unreachable");
  });

  it("returns error on non-ok non-401/403", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response("oops", { status: 502 }))
    );
    const got = await adminGetLicenseStatus("ce-adm-x");
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.status).toBe(502);
  });

  it("projects license_valid body with optional fields", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "license_valid",
          distribution: "ce",
          product: "identuum-idp-ce",
          tier: "enterprise",
          licensee: "Acme Corp",
          expires_at: "2027-01-01T00:00:00Z",
          license_id: "lic-42",
          license_type: "customer",
          next_action: "live",
        })
      )
    );
    const got = await adminGetLicenseStatus("ce-adm-x");
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.tier).toBe("enterprise");
    expect(got.status.licensee).toBe("Acme Corp");
    expect(got.status.licenseId).toBe("lic-42");
  });

  it("returns error when response is not a license-shaped object", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(200, { hello: "world" }))
    );
    const got = await adminGetLicenseStatus("ce-adm-x");
    expect(got.kind).toBe("error");
  });

  it("returns error when response is an array", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(200, []))
    );
    const got = await adminGetLicenseStatus("ce-adm-x");
    expect(got.kind).toBe("error");
  });

  it("returns error when JSON parsing fails", async () => {
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
    const got = await adminGetLicenseStatus("ce-adm-x");
    expect(got.kind).toBe("error");
  });
});

describe("adminUploadLicense", () => {
  it("posts JSON to /api/idp/admin/license with Bearer + license body", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedAuth: string | null = null;
    let capturedBody = "";
    vi.stubGlobal(
      "fetch",
      mockFetch(async (url, init) => {
        capturedUrl = String(url);
        capturedMethod = String(init?.method ?? "GET");
        const headers = new Headers(init?.headers);
        capturedAuth = headers.get("authorization");
        capturedBody = init?.body ? String(init.body) : "";
        return jsonResponse(200, {
          state: "license_valid",
          distribution: "ce",
          product: "identuum-idp-ce",
        });
      })
    );
    const got = await adminUploadLicense({
      adminToken: "ce-adm-upload",
      license: "envelope-bytes",
    });
    expect(got.kind).toBe("ok");
    expect(capturedUrl).toBe("/api/idp/admin/license");
    expect(capturedMethod.toUpperCase()).toBe("POST");
    expect(capturedAuth).toBe("Bearer ce-adm-upload");
    const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(parsed.license).toBe("envelope-bytes");
    // Critical pin: the body MUST NOT contain a setup_token field —
    // the admin surface uses bearer auth, not the setup-time token.
    expect("setup_token" in parsed).toBe(false);
  });

  it("returns unauthorized on 401", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response(null, { status: 401 }))
    );
    const got = await adminUploadLicense({ adminToken: "x", license: "y" });
    expect(got.kind).toBe("unauthorized");
  });

  it("returns forbidden on 403", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => new Response(null, { status: 403 }))
    );
    const got = await adminUploadLicense({ adminToken: "x", license: "y" });
    expect(got.kind).toBe("forbidden");
  });

  it("returns rejected with mapped code on license_invalid", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(400, { error: "license_invalid" }))
    );
    const got = await adminUploadLicense({ adminToken: "x", license: "y" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("license_invalid");
  });

  it("returns rejected with next_action message when present", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(503, {
          error: "license_persist_failed",
          next_action: "Check filesystem permissions and retry.",
        })
      )
    );
    const got = await adminUploadLicense({ adminToken: "x", license: "y" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe("license_persist_failed");
    expect(got.message).toBe("Check filesystem permissions and retry.");
  });

  it.each([
    "license_envelope_required",
    "license_envelope_malformed",
    "license_invalid",
    "license_expired",
    "license_product_mismatch",
    "license_persist_failed",
    "license_persist_path_unset",
  ] as const)("maps wire code %s to rejected", async (code) => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(400, { error: code }))
    );
    const got = await adminUploadLicense({ adminToken: "x", license: "y" });
    expect(got.kind).toBe("rejected");
    if (got.kind !== "rejected") return;
    expect(got.code).toBe(code);
  });

  it("falls through to error for unknown error code", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(400, { error: "something_brand_new" }))
    );
    const got = await adminUploadLicense({ adminToken: "x", license: "y" });
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.status).toBe(400);
  });

  it("returns unreachable on fetch throw", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => {
        throw new Error("offline");
      })
    );
    const got = await adminUploadLicense({ adminToken: "x", license: "y" });
    expect(got.kind).toBe("unreachable");
  });

  it("returns ok on 200 with license_valid body", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() =>
        jsonResponse(200, {
          state: "license_valid",
          distribution: "ce",
          product: "identuum-idp-ce",
          tier: "professional",
        })
      )
    );
    const got = await adminUploadLicense({
      adminToken: "ce-adm-x",
      license: "envelope",
    });
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.status.state).toBe("license_valid");
    expect(got.status.tier).toBe("professional");
  });

  it("returns error when 200 body is not license-shaped", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => jsonResponse(200, { unrelated: true }))
    );
    const got = await adminUploadLicense({ adminToken: "x", license: "y" });
    expect(got.kind).toBe("error");
  });

  it("omits Authorization when adminToken is empty", async () => {
    let capturedAuth: string | null = null;
    vi.stubGlobal(
      "fetch",
      mockFetch((_url, init) => {
        const headers = new Headers(init?.headers);
        capturedAuth = headers.get("authorization");
        return new Response(null, { status: 401 });
      })
    );
    const got = await adminUploadLicense({ adminToken: "", license: "y" });
    expect(got.kind).toBe("unauthorized");
    expect(capturedAuth).toBeNull();
  });
});
