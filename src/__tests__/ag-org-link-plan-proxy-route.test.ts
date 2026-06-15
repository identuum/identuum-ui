/**
 * ag-org-link-plan-proxy-route.test.ts
 *
 * Tests for /api/ag-org-link/plan — the Next proxy route that surfaces
 * the AG OSS post-AG-31 plan to the UI. Pins the HTTP-status mapping for
 * each classified client result variant so a future regression that
 * conflates auth/availability/error states surfaces here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ag-org-link-plan-oss-client", () => ({
  fetchAGOrgLinkPlanOSS: vi.fn(),
}));

import { GET } from "../app/api/ag-org-link/plan/route";
import { fetchAGOrgLinkPlanOSS } from "../lib/ag-org-link-plan-oss-client";

const mockFetch = vi.mocked(fetchAGOrgLinkPlanOSS);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/api/ag-org-link/plan — status-code mapping", () => {
  it("ok → 200 with {status:'ok', plan}", async () => {
    mockFetch.mockResolvedValue({
      status: "ok",
      plan: {
        organizations: [
          {
            id: "aaaaaaaa-0000-0000-0000-000000000001",
            name: "acme",
            display_name: "Acme Corp",
            linked_idp_org_id: "cccccccc-0000-0000-0000-000000000003",
            link_status: "linked",
          },
        ],
        total: 1,
        linked_count: 1,
        unlinked_count: 0,
      },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; plan: { total: number } };
    expect(body.status).toBe("ok");
    expect(body.plan.total).toBe(1);
  });

  it("not_configured → 200 with {status:'not_configured'} (no auth challenge)", async () => {
    mockFetch.mockResolvedValue({ status: "not_configured" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "not_configured" });
  });

  it("ag_auth_required → 401", async () => {
    mockFetch.mockResolvedValue({ status: "ag_auth_required" });
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "ag_auth_required" });
  });

  it("ag_forbidden → 403", async () => {
    mockFetch.mockResolvedValue({ status: "ag_forbidden" });
    const res = await GET();
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "ag_forbidden" });
  });

  it("ag_unavailable → 503", async () => {
    mockFetch.mockResolvedValue({ status: "ag_unavailable" });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "ag_unavailable" });
  });

  it("error → 502", async () => {
    mockFetch.mockResolvedValue({ status: "error" });
    const res = await GET();
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "error" });
  });

  it("body never includes raw bearer tokens or internal URLs", async () => {
    mockFetch.mockResolvedValue({
      status: "ok",
      plan: {
        organizations: [
          {
            id: "aaaaaaaa-0000-0000-0000-000000000001",
            name: "acme",
            display_name: "Acme Corp",
            link_status: "unlinked",
          },
        ],
        total: 1,
        linked_count: 0,
        unlinked_count: 1,
      },
    });
    const res = await GET();
    const raw = await res.text();
    expect(raw).not.toContain("Bearer ");
    expect(raw).not.toContain("host.docker.internal");
    expect(raw).not.toContain("identuum-ag:7215");
    expect(raw).not.toContain("identuum-ag:7315");
    expect(raw).not.toContain("internal_base_url");
  });
});
