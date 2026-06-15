/**
 * Tests for ag-org-link-plan-oss-client.ts.
 *
 * Verifies that:
 *   - The AG OSS post-AG-31 response shape is parsed correctly.
 *   - Missing operator session, 401, 403, network failure, and
 *     unexpected-shape responses each map to a distinct discriminated
 *     result variant (no silent degrade-to-empty).
 *   - The "not_configured" path is reachable without making any HTTP call.
 *   - Sensitive-looking keys (status, description, created_at, updated_at,
 *     password, secret, private_key, client_secret) are never copied
 *     through to the result, even when present on the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ag-client", () => ({
  agRequest: vi.fn(),
  getAgOperatorToken: vi.fn(),
  AG_COOKIE_NAME: "ag_operator_session",
}));

vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: vi.fn(),
  agBaseUrl: vi.fn(),
}));

import { agRequest } from "../lib/ag-client";
import { fetchAGOrgLinkPlanOSS } from "../lib/ag-org-link-plan-oss-client";
import { loadRuntimeConfig } from "../lib/runtime-config";

const mockAgRequest = vi.mocked(agRequest);
const mockLoadConfig = vi.mocked(loadRuntimeConfig);

const AG_ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const AG_ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
const IDP_ORG_X = "cccccccc-0000-0000-0000-000000000003";

function mockAGEnabled() {
  mockLoadConfig.mockReturnValue({
    ag: { enabled: true, public_base_url: "http://ag:7315" },
  } as unknown as ReturnType<typeof loadRuntimeConfig>);
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchAGOrgLinkPlanOSS — success", () => {
  it("returns ok with linked + unlinked rows and counts", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(
      mockResponse(200, {
        organizations: [
          {
            id: AG_ORG_A,
            name: "acme",
            display_name: "Acme Corp",
            linked_idp_org_id: IDP_ORG_X,
            link_status: "linked",
          },
          {
            id: AG_ORG_B,
            name: "beta",
            display_name: "Beta Inc",
            link_status: "unlinked",
          },
        ],
        total: 2,
        linked_count: 1,
        unlinked_count: 1,
      })
    );

    const result = await fetchAGOrgLinkPlanOSS();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.total).toBe(2);
    expect(result.plan.linked_count).toBe(1);
    expect(result.plan.unlinked_count).toBe(1);
    expect(result.plan.organizations).toHaveLength(2);
    expect(result.plan.organizations[0]).toEqual({
      id: AG_ORG_A,
      name: "acme",
      display_name: "Acme Corp",
      linked_idp_org_id: IDP_ORG_X,
      link_status: "linked",
    });
    expect(result.plan.organizations[1].link_status).toBe("unlinked");
    expect(result.plan.organizations[1].linked_idp_org_id).toBeNull();
  });

  it("returns ok with empty organizations and zero counts", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(
      mockResponse(200, {
        organizations: [],
        total: 0,
        linked_count: 0,
        unlinked_count: 0,
      })
    );

    const result = await fetchAGOrgLinkPlanOSS();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.total).toBe(0);
    expect(result.plan.linked_count).toBe(0);
    expect(result.plan.unlinked_count).toBe(0);
    expect(result.plan.organizations).toEqual([]);
  });
});

describe("fetchAGOrgLinkPlanOSS — error states", () => {
  it("returns not_configured when ag.enabled is false (no HTTP call)", async () => {
    mockAGDisabled();
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "not_configured" });
    expect(mockAgRequest).not.toHaveBeenCalled();
  });

  it("returns ag_auth_required when agRequest yields null (no operator cookie)", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(null);
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "ag_auth_required" });
  });

  it("returns ag_auth_required on HTTP 401", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(mockResponse(401, { error: "unauthorized" }));
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "ag_auth_required" });
  });

  it("returns ag_forbidden on HTTP 403", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(mockResponse(403, { error: "forbidden" }));
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "ag_forbidden" });
  });

  it("returns ag_unavailable on agRequest reject (network failure)", async () => {
    mockAGEnabled();
    mockAgRequest.mockRejectedValue(new Error("network"));
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "ag_unavailable" });
  });

  it("returns ag_unavailable on HTTP 500", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(mockResponse(500, { error: "boom" }));
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "ag_unavailable" });
  });

  it("returns error on 2xx with non-object body (array)", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(mockResponse(200, [{ id: AG_ORG_A }]));
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "error" });
  });

  it("returns error on 2xx with missing total field", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(
      mockResponse(200, { organizations: [], linked_count: 0, unlinked_count: 0 })
    );
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "error" });
  });

  it("returns error on 2xx with organization missing required field", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(
      mockResponse(200, {
        organizations: [{ id: AG_ORG_A, name: "acme" /* missing display_name */ }],
        total: 1,
        linked_count: 0,
        unlinked_count: 1,
      })
    );
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when json() throws", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result).toEqual({ status: "error" });
  });
});

describe("fetchAGOrgLinkPlanOSS — sensitive-field exclusion", () => {
  it("does not surface unexpected sensitive fields in the parsed plan", async () => {
    mockAGEnabled();
    // The wire body includes extra fields that would never come from the
    // real AG OSS route but represent the kind of leak this client must
    // not propagate.
    mockAgRequest.mockResolvedValue(
      mockResponse(200, {
        organizations: [
          {
            id: AG_ORG_A,
            name: "acme",
            display_name: "Acme Corp",
            link_status: "linked",
            linked_idp_org_id: IDP_ORG_X,
            // Sensitive-looking strings that must NOT appear on the typed result.
            status: "active",
            description: "should not propagate",
            created_at: "2026-06-11T00:00:00Z",
            updated_at: "2026-06-11T00:00:00Z",
            password: "x",
            secret: "x",
            private_key: "x",
            client_secret: "x",
          },
        ],
        total: 1,
        linked_count: 1,
        unlinked_count: 0,
      })
    );

    const result = await fetchAGOrgLinkPlanOSS();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const parsed = result.plan.organizations[0] as unknown as Record<string, unknown>;
    const allowedKeys = new Set(["id", "name", "display_name", "linked_idp_org_id", "link_status"]);
    for (const key of Object.keys(parsed)) {
      expect(allowedKeys.has(key), `unexpected key in parsed org: ${key}`).toBe(true);
    }
    // Spot-check JSON-string of the entire result contains no leaked sensitive substrings.
    const serialized = JSON.stringify(result.plan);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("client_secret");
    expect(serialized).not.toContain("private_key");
    expect(serialized).not.toContain("description");
    expect(serialized).not.toContain("created_at");
    expect(serialized).not.toContain("updated_at");
    // "secret" alone is too noisy (could appear in error strings); pin only that
    // it does not appear as a JSON key in the org body shape we emit.
    expect(serialized).not.toContain('"secret"');
  });
});

describe("fetchAGOrgLinkPlanOSS — link_status fallback", () => {
  it("treats any non-linked link_status string as unlinked", async () => {
    mockAGEnabled();
    mockAgRequest.mockResolvedValue(
      mockResponse(200, {
        organizations: [
          {
            id: AG_ORG_A,
            name: "acme",
            display_name: "Acme Corp",
            link_status: "weird",
          },
        ],
        total: 1,
        linked_count: 0,
        unlinked_count: 1,
      })
    );
    const result = await fetchAGOrgLinkPlanOSS();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.organizations[0].link_status).toBe("unlinked");
  });
});
