import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverPlatform, validateSession } from "../../export/src/session";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps an unavailable session distinct from a denied session in the static adapter", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ correlation_id: "fixture-correlation" }), {
          status: 503,
          headers: { "retry-after": "1" },
        })
    )
  );
  const pending = validateSession();
  await vi.advanceTimersByTimeAsync(8100);
  expect(await pending).toMatchObject({
    kind: "unavailable",
    status: 503,
    correlationId: "fixture-correlation",
    retryAfterSeconds: 1,
  });
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ reason: "token_revoked" }), { status: 401 })
  );
  vi.stubGlobal("fetch", fetch);
  expect(await validateSession()).toEqual({ kind: "unauthenticated", reason: "token_revoked" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["setup_required", "setup_complete", "unknown"])(
  "classifies the setup-state answer %s without guessing",
  async (state) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ state }), { status: 200 }))
    );
    const result = await discoverPlatform();
    expect(result.mode).toBe(
      state === "setup_required"
        ? "setup_required"
        : state === "setup_complete"
          ? "ready"
          : "unavailable"
    );
  }
);

// CE-UI-1: a CE binary in upgrade mode mounts no /api/v1/component (404);
// the ladder then asks /api/upgrade/status, as the Next ladder does.
describe("an absent component probe consults the upgrade status", () => {
  const component404 = () => new Response("404 page not found", { status: 404 });
  const upgrade = (state: string) => new Response(JSON.stringify({ state }), { status: 200 });

  it.each(["oss_database_detected", "upgrade_required", "backup_required"])(
    "%s routes to the upgrade wizard",
    async (state) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(component404())
        .mockResolvedValueOnce(upgrade(state));
      vi.stubGlobal("fetch", fetch);
      expect(await discoverPlatform()).toEqual({ mode: "upgrade_required" });
      expect(fetch.mock.calls.map((c) => c[0])).toEqual([
        "/api/v1/component",
        "/api/upgrade/status",
      ]);
    }
  );

  it("an upgrade state that needs no wizard stays unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(component404())
        .mockResolvedValueOnce(upgrade("upgrade_complete"))
    );
    expect(await discoverPlatform()).toEqual({ mode: "unavailable", detail: "component_404" });
  });

  it("an absent upgrade status stays unavailable (an OSS or unknown backend)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(component404()).mockResolvedValueOnce(component404())
    );
    expect(await discoverPlatform()).toEqual({ mode: "unavailable", detail: "component_404" });
  });

  it("a failing component probe other than 404 does not ask", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    expect(await discoverPlatform()).toEqual({ mode: "unavailable", detail: "component_503" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("does not turn a missing session payload into an expired-session verdict", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 }))
  );
  expect(await validateSession()).toMatchObject({ kind: "unavailable" });
});

it("a rate-limited validation is unavailable rather than an authentication verdict", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", {
          status: 429,
          headers: { "retry-after": "1" },
        })
    )
  );
  const pending = validateSession();
  await vi.advanceTimersByTimeAsync(8100);
  expect(await pending).toMatchObject({ kind: "unavailable", status: 429, retryAfterSeconds: 1 });
});

it.each([
  null,
  [],
  { role: "site_admin", user: { id: "fixture", role: "org_user" } },
  { role: "unknown", user: { id: "fixture", role: "unknown" } },
  { role: "org_admin", user: { role: "org_admin" } },
])("refuses an inconsistent or incomplete authenticated session payload", async (body) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  );
  expect(await validateSession()).toMatchObject({ kind: "unavailable" });
});
