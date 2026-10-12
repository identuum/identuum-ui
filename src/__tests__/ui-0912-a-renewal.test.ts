/**
 * UI-0912-A, part A1 (OSS v0.9.12 C3), cause H1: the access token died while
 * the tab stayed open. identuum-idp-oss has no `token_expired`: the boundary
 * retries the dead cookie anonymously and the guard answers 401
 * `no_credential`, which the export's bff() did not renew, so the provider
 * page said "Your organization could not be read". Cause H2 (a stale
 * connection) is covered by ui-0912-a-org-read.test.tsx only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bff } from "../../export/src/bff";

afterEach(() => vi.unstubAllGlobals());

const ORG = { id: "01990000-0000-7000-8000-0000000000a1", name: "Acme", domain: "acme.test" };

describe("H1: the export renews a dead access credential on a safe read", () => {
  it("401 no_credential on the organization read is renewed once and the read retried [RENEW-NO-CREDENTIAL-1]", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reason: "no_credential" }), { status: 401 })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ORG), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const res = await bff("/api/v1/organizations/current");
    expect(res.status).toBe(200);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      "/bff/api/v1/organizations/current",
      "/bff/session/refresh",
      "/bff/api/v1/organizations/current",
    ]);
  });

  it("a visitor with no refresh cookie gets one refresh, then a 401, and no loop", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reason: "no_credential" }), { status: 401 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: false }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetch);
    const res = await bff("/api/v1/organizations/current");
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("missing_refresh_credential");
    expect(fetch.mock.calls.filter((c) => c[0] === "/bff/session/refresh")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
