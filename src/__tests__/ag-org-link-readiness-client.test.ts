/**
 * Tests for ag-org-link-readiness-client.ts.
 *
 * Verifies that:
 *   - The AG CE 2026-06-24 readiness wire shape is parsed correctly
 *     under both fully-mounted (configured=true, ready=true) and
 *     unconfigured (configured=false, ready=false) postures.
 *   - not_configured is reachable without making any HTTP call when
 *     AG is disabled in the UI runtime config.
 *   - Network failure, abort/timeout, non-2xx status, and unexpected-
 *     shape responses each map to a distinct discriminated result
 *     variant (no silent degrade-to-empty).
 *   - Sensitive-looking keys on the wire (operator_id, idp_org_id,
 *     organizations, total, linked_count, unlinked_count, password,
 *     secret, private_key, client_secret) are NEVER copied through
 *     to the result, even when the wire body smuggles them.
 *   - The probe never attaches an Authorization header (the AG CE
 *     route is pre-login by design).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: vi.fn(),
  agBaseUrl: vi.fn(),
}));

import { fetchAGOrgLinkReadiness } from "../lib/ag-org-link-readiness-client";
import { agBaseUrl, loadRuntimeConfig } from "../lib/runtime-config";

const mockLoadConfig = vi.mocked(loadRuntimeConfig);
const mockAgBaseUrl = vi.mocked(agBaseUrl);

function mockAGEnabled() {
  mockLoadConfig.mockReturnValue({
    ag: { enabled: true, public_base_url: "http://ag-ce:7225" },
  } as unknown as ReturnType<typeof loadRuntimeConfig>);
  mockAgBaseUrl.mockReturnValue("http://ag-ce:7225");
}

function mockAGDisabled() {
  mockLoadConfig.mockReturnValue({
    ag: { enabled: false, public_base_url: "" },
  } as unknown as ReturnType<typeof loadRuntimeConfig>);
}

function mockResponse(status: number, body: unknown, ok?: boolean): Response {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
  } as Response;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
});

describe("fetchAGOrgLinkReadiness — happy paths", () => {
  it("parses the fully-mounted readiness body (configured + ready)", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockResolvedValue(
      mockResponse(200, {
        configured: true,
        ready: true,
        plan_endpoint: "/api/v1/org-link/plan",
        detail_endpoint_pattern: "/api/v1/org-link/organizations/{id}",
        notes: [
          "AG CE org-link plan + detail + link/unlink WRITE routes are mounted behind operator-auth; the UI can drive the full read+write linking flow.",
        ],
      })
    );
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.readiness.configured).toBe(true);
      expect(result.readiness.ready).toBe(true);
      expect(result.readiness.plan_endpoint).toBe("/api/v1/org-link/plan");
      expect(result.readiness.detail_endpoint_pattern).toBe("/api/v1/org-link/organizations/{id}");
      expect(result.readiness.notes).toHaveLength(1);
    }
  });

  it("parses the unconfigured readiness body (configured=false, ready=false)", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockResolvedValue(
      mockResponse(200, {
        configured: false,
        ready: false,
        plan_endpoint: "",
        detail_endpoint_pattern: "",
        notes: [
          "AG CE org-link planning is not yet wired; the auth-gated plan and detail routes are not mounted in this binary.",
        ],
      })
    );
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.readiness.configured).toBe(false);
      expect(result.readiness.ready).toBe(false);
      expect(result.readiness.plan_endpoint).toBe("");
      expect(result.readiness.detail_endpoint_pattern).toBe("");
    }
  });

  it("does not attach an Authorization header (route is pre-login)", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockResolvedValue(
      mockResponse(200, {
        configured: true,
        ready: true,
        plan_endpoint: "/api/v1/org-link/plan",
        detail_endpoint_pattern: "/api/v1/org-link/organizations/{id}",
        notes: ["x"],
      })
    );
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    await fetchAGOrgLinkReadiness();

    expect(stub).toHaveBeenCalledTimes(1);
    const [, init] = stub.mock.calls[0];
    // The init object must not carry an Authorization header. (Our
    // implementation doesn't pass a headers object at all, so this is
    // a positive assertion that nothing got smuggled in.)
    const headers = init?.headers;
    if (headers) {
      if (headers instanceof Headers) {
        expect(headers.get("authorization")).toBeNull();
      } else if (Array.isArray(headers)) {
        for (const [k] of headers) {
          expect(k.toLowerCase()).not.toBe("authorization");
        }
      } else {
        for (const k of Object.keys(headers)) {
          expect(k.toLowerCase()).not.toBe("authorization");
        }
      }
    }
  });
});

describe("fetchAGOrgLinkReadiness — failure modes", () => {
  it("returns not_configured when AG is disabled in UI runtime config", async () => {
    mockAGDisabled();
    const stub = vi.fn();
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("not_configured");
    expect(stub).not.toHaveBeenCalled();
  });

  it("returns ag_unavailable on network/fetch rejection", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("ag_unavailable");
  });

  it("returns ag_unavailable on non-2xx status", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockResolvedValue(mockResponse(503, { error: "unavailable" }));
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("ag_unavailable");
  });

  it("returns error on malformed JSON body (json() throws)", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    } as unknown as Response);
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("error");
  });

  it("returns error on 2xx body missing required fields", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockResolvedValue(
      mockResponse(200, {
        // missing `configured` + `ready` + endpoint fields
        notes: [],
      })
    );
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("error");
  });

  it("returns error on 2xx body with notes containing non-string entries", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockResolvedValue(
      mockResponse(200, {
        configured: true,
        ready: true,
        plan_endpoint: "/api/v1/org-link/plan",
        detail_endpoint_pattern: "/api/v1/org-link/organizations/{id}",
        notes: ["ok", 42, "also-ok"],
      })
    );
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("error");
  });
});

describe("fetchAGOrgLinkReadiness — no-leak invariants", () => {
  it("ignores sensitive-looking smuggled wire fields", async () => {
    mockAGEnabled();
    const stub = vi.fn().mockResolvedValue(
      mockResponse(200, {
        configured: true,
        ready: true,
        plan_endpoint: "/api/v1/org-link/plan",
        detail_endpoint_pattern: "/api/v1/org-link/organizations/{id}",
        notes: ["ok"],
        // Sensitive-looking smuggled fields — MUST NOT appear on the
        // sanitised result. The sanitiser only reads the documented
        // bounded set, so the projection should be exactly the 5
        // documented fields.
        operator_id: "should-never-leak",
        idp_org_id: "11111111-1111-1111-1111-111111111111",
        organizations: [{ id: "x" }],
        total: 99,
        linked_count: 7,
        unlinked_count: 8,
        password: "should-never-leak",
        client_secret: "should-never-leak",
        private_key: "-----BEGIN PRIVATE KEY-----xxx-----END PRIVATE KEY-----",
        secret: "should-never-leak",
      })
    );
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    const result = await fetchAGOrgLinkReadiness();

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const json = JSON.stringify(result.readiness);
      // None of the smuggled sensitive strings should appear in the
      // sanitised projection (the sanitiser reads only the 5
      // documented fields by name).
      expect(json).not.toContain("should-never-leak");
      expect(json).not.toContain("11111111-1111-1111-1111-111111111111");
      expect(json).not.toContain("PRIVATE KEY");
      expect(json).not.toContain("operator_id");
      // Note: the legitimate `detail_endpoint_pattern` contains the
      // substring "organizations" so we cannot blanket-reject that
      // word — instead the keys check below pins the exact projected
      // shape so smuggled top-level keys cannot reach the result.
      // Confirm exactly the 5 documented keys are present.
      const keys = Object.keys(result.readiness).sort();
      expect(keys).toEqual([
        "configured",
        "detail_endpoint_pattern",
        "notes",
        "plan_endpoint",
        "ready",
      ]);
    }
  });
});
