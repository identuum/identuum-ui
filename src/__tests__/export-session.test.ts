import { afterEach, expect, it, vi } from "vitest";
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
