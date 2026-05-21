/**
 * Tests for ag-org-link-write-client.ts error/auth semantic behavior.
 *
 * Verifies that AG HTTP responses and pre-flight states map to correct
 * safe UI error codes. Uses vi.mock to isolate server-side dependencies.
 *
 * Security invariants tested:
 *   - No internal AG URLs in returned values
 *   - No secret-like fields in returned values
 *   - Auth failures (missing session, 401) map to ag_auth_required
 *   - 403 responses are split by AG error code, not conflated
 *   - Network failures map to ag_unavailable
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ag-client before importing the write client so the module system
// picks up the mock when resolving the import.
vi.mock("../lib/ag-client", () => ({
  agRequest: vi.fn(),
  getAgOperatorToken: vi.fn(),
  AG_COOKIE_NAME: "ag_access_token",
}));

vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: vi.fn(),
  agBaseUrl: vi.fn(),
}));

import {
  linkAGOrganizationToIDPOrg,
  unlinkAGOrganizationFromIDPOrg,
} from "../lib/ag-org-link-write-client";
import { agRequest, getAgOperatorToken } from "../lib/ag-client";
import { loadRuntimeConfig } from "../lib/runtime-config";

const mockAgRequest = vi.mocked(agRequest);
const mockGetToken = vi.mocked(getAgOperatorToken);
const mockLoadConfig = vi.mocked(loadRuntimeConfig);

const VALID_AG_ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const VALID_IDP_ORG = "bbbbbbbb-0000-0000-0000-000000000002";

function mockAGEnabled() {
  mockLoadConfig.mockReturnValue({
    ag: { enabled: true, public_base_url: "http://ag:7215" },
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

describe("linkAGOrganizationToIDPOrg — pre-flight checks", () => {
  it("returns ag_auth_required when AG is configured but no session token", async () => {
    mockAGEnabled();
    mockGetToken.mockResolvedValue(null);

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_auth_required");
    expect(mockAgRequest).not.toHaveBeenCalled();
  });

  it("returns not_configured when AG is disabled in runtime config", async () => {
    mockLoadConfig.mockReturnValue({
      ag: { enabled: false },
    } as unknown as ReturnType<typeof loadRuntimeConfig>);

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("not_configured");
    expect(mockAgRequest).not.toHaveBeenCalled();
  });

  it("returns invalid_request for non-UUID ag_org_id without calling AG", async () => {
    const result = await linkAGOrganizationToIDPOrg("not-a-uuid", VALID_IDP_ORG);
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("invalid_request");
    expect(mockAgRequest).not.toHaveBeenCalled();
  });

  it("returns invalid_request for non-UUID idp_org_id without calling AG", async () => {
    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, "not-a-uuid");
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("invalid_request");
    expect(mockAgRequest).not.toHaveBeenCalled();
  });
});

describe("linkAGOrganizationToIDPOrg — AG response mapping", () => {
  beforeEach(() => {
    mockAGEnabled();
    mockGetToken.mockResolvedValue("valid-token");
  });

  it("returns ag_auth_required when AG responds 401", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(401, { code: "token_expired", message: "Token expired" })
    );

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_auth_required");
  });

  it("returns system_org_not_allowed when AG responds 403 with system_org_not_allowed code", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(403, { code: "system_org_not_allowed", message: "System org not allowed" })
    );

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("system_org_not_allowed");
  });

  it("returns ag_forbidden when AG responds 403 with a different error code", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(403, { code: "insufficient_permissions", message: "Not allowed" })
    );

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_forbidden");
  });

  it("returns ag_forbidden when AG responds 403 with no error code body", async () => {
    mockAgRequest.mockResolvedValue(mockResponse(403, {}));

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_forbidden");
  });

  it("returns ag_unavailable on network failure", async () => {
    mockAgRequest.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_unavailable");
  });

  it("returns org_not_found when AG responds 404", async () => {
    mockAgRequest.mockResolvedValue(mockResponse(404, { code: "org_not_found" }));

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("org_not_found");
  });

  it("returns idp_org_already_linked when AG responds 409", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(409, { code: "idp_org_already_linked" })
    );

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("idp_org_already_linked");
  });

  it("returns ok:true with sanitized org on 200 success", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(200, {
        organization: {
          id: VALID_AG_ORG,
          name: "acme",
          display_name: "Acme Corp",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          linked_idp_org_id: VALID_IDP_ORG,
          link_status: "linked",
          admin_token: "should-be-stripped",
          password: "should-be-stripped",
        },
      })
    );

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);

    expect(result.ok).toBe(true);
    expect(result.organization?.id).toBe(VALID_AG_ORG);
    expect(result.organization?.linked_idp_org_id).toBe(VALID_IDP_ORG);
    const json = JSON.stringify(result);
    expect(json).not.toContain("admin_token");
    expect(json).not.toContain("password");
  });
});

describe("unlinkAGOrganizationFromIDPOrg — pre-flight checks", () => {
  it("returns ag_auth_required when no session token", async () => {
    mockAGEnabled();
    mockGetToken.mockResolvedValue(null);

    const result = await unlinkAGOrganizationFromIDPOrg(VALID_AG_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_auth_required");
    expect(mockAgRequest).not.toHaveBeenCalled();
  });
});

describe("unlinkAGOrganizationFromIDPOrg — AG response mapping", () => {
  beforeEach(() => {
    mockAGEnabled();
    mockGetToken.mockResolvedValue("valid-token");
  });

  it("returns ag_auth_required when AG responds 401", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(401, { code: "token_expired" })
    );

    const result = await unlinkAGOrganizationFromIDPOrg(VALID_AG_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_auth_required");
  });

  it("returns ag_forbidden when AG responds 403 with generic code", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(403, { code: "read_only_mode" })
    );

    const result = await unlinkAGOrganizationFromIDPOrg(VALID_AG_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_forbidden");
  });

  it("returns system_org_not_allowed for system org 403", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(403, { code: "system_org_not_allowed" })
    );

    const result = await unlinkAGOrganizationFromIDPOrg(VALID_AG_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("system_org_not_allowed");
  });

  it("returns ag_unavailable on network failure", async () => {
    mockAgRequest.mockRejectedValue(new TypeError("fetch failed"));

    const result = await unlinkAGOrganizationFromIDPOrg(VALID_AG_ORG);

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("ag_unavailable");
  });

  it("returns ok:true on 200 success", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(200, {
        organization: {
          id: VALID_AG_ORG,
          name: "acme",
          display_name: "Acme Corp",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          linked_idp_org_id: null,
          link_status: "unlinked",
        },
      })
    );

    const result = await unlinkAGOrganizationFromIDPOrg(VALID_AG_ORG);

    expect(result.ok).toBe(true);
    expect(result.organization?.linked_idp_org_id).toBeNull();
  });
});

describe("write client — security invariants", () => {
  beforeEach(() => {
    mockAGEnabled();
    mockGetToken.mockResolvedValue("valid-token");
  });

  it("never includes internal AG URL in error result", async () => {
    mockAgRequest.mockRejectedValue(new Error("ECONNREFUSED http://ag-internal:7215"));

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);
    const json = JSON.stringify(result);

    expect(json).not.toContain("ag-internal");
    expect(json).not.toContain("7215");
  });

  it("never includes Bearer token in result", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(401, { token: "Bearer eyJhbGciOiJSUzI1NiJ9.secret" })
    );

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);
    const json = JSON.stringify(result);

    expect(json).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    expect(json).not.toContain("Bearer");
  });

  it("does not surface raw AG error messages in result", async () => {
    mockAgRequest.mockResolvedValue(
      mockResponse(500, {
        message: "pq: duplicate key violates unique constraint",
        sql_state: "23505",
        stack_trace: "goroutine 1 ...",
      })
    );

    const result = await linkAGOrganizationToIDPOrg(VALID_AG_ORG, VALID_IDP_ORG);
    const json = JSON.stringify(result);

    expect(json).not.toContain("pq:");
    expect(json).not.toContain("23505");
    expect(json).not.toContain("goroutine");
  });
});
