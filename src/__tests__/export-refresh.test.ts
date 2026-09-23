import { afterEach, expect, it, vi } from "vitest";
import { bff } from "../../export/src/bff";

afterEach(() => vi.unstubAllGlobals());
const expired = () =>
  new Response(JSON.stringify({ reason: "missing_credential" }), { status: 401 });

it("refreshes a missing access cookie without exposing credentials and retries a read once", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(expired())
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  expect((await bff("/api/v1/validate")).status).toBe(200);
  expect(fetch.mock.calls.map((c) => c[0])).toEqual([
    "/bff/api/v1/validate",
    "/bff/session/refresh",
    "/bff/api/v1/validate",
  ]);
  const options = fetch.mock.calls[1][1];
  expect(options.method).toBe("POST");
  expect(options.body).toBeUndefined();
  expect(options.credentials).toBe("same-origin");
  expect(options.redirect).toBe("error");
  expect(options.headers.get("X-Requested-With")).toBe("identuum-ui");
});

it("does not submit a protected mutation when refresh is unavailable", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(expired())
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  expect((await bff("/api/v1/profile", { method: "PUT", body: "{}" })).status).toBe(503);
  expect(fetch.mock.calls.some((c) => c[0] === "/bff/api/v1/profile")).toBe(false);
});

it("never replays a protected mutation after its handler refuses", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  expect((await bff("/api/v1/profile", { method: "PUT", body: "{}" })).status).toBe(401);
  expect(fetch.mock.calls.map((c) => c[0])).toEqual([
    "/bff/api/v1/validate",
    "/bff/api/v1/profile",
  ]);
});

it.each(["token_revoked", "session_not_usable", "user_not_active"])(
  "does not refresh a %s verdict",
  async (reason) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ reason }), { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    expect((await bff("/api/v1/validate")).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it("shares one refresh among concurrent reads", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url === "/bff/session/refresh") {
      await barrier;
      return new Response(null, { status: 204 });
    }
    return ++reads <= 2 ? expired() : new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  const results = [bff("/api/v1/validate"), bff("/api/v1/validate")];
  await vi.waitFor(() =>
    expect(fetch.mock.calls.filter((c) => c[0] === "/bff/session/refresh")).toHaveLength(1)
  );
  release();
  expect((await Promise.all(results)).map((r) => r.status)).toEqual([200, 200]);
});

it("does not refresh an explicit Bearer or retry a second failed read", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(expired());
  vi.stubGlobal("fetch", fetch);
  expect(
    (await bff("/api/v1/validate", { headers: { Authorization: "Bearer synthetic" } })).status
  ).toBe(401);
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch
    .mockReset()
    .mockResolvedValueOnce(expired())
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(expired());
  expect((await bff("/api/v1/validate")).status).toBe(401);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each(["/session/logout", "/api/v1/auth/login"])("never refreshes during %s", async (path) => {
  const fetch = vi.fn(async () => expired());
  vi.stubGlobal("fetch", fetch);
  expect((await bff(path, { method: "POST" })).status).toBe(401);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("cancelling the first caller does not cancel another caller's shared refresh", async () => {
  const first = new AbortController();
  let finish!: () => void;
  let reads = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/bff/session/refresh") {
      return new Promise<Response>((resolve, reject) => {
        finish = () => resolve(new Response(null, { status: 204 }));
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }
    init.signal?.throwIfAborted();
    return ++reads <= 2 ? expired() : new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  const a = bff("/api/v1/validate", { signal: first.signal });
  const aRejected = expect(a).rejects.toMatchObject({ name: "AbortError" });
  const b = bff("/api/v1/validate");
  // Attach the rejection handler before cancelling so a failing implementation
  // cannot produce an unhandled rejection in the test runner.
  const bResult = b.then(
    (response) => response.status,
    () => "cancelled"
  );
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  first.abort();
  finish();
  await aRejected;
  expect(await bResult).toBe(200);
  expect(fetch.mock.calls.filter((c) => c[0] === "/bff/session/refresh")).toHaveLength(1);
});

it("a cancelled waiter returns before shared refresh finishes and never retries its read", async () => {
  const waiter = new AbortController();
  let finish!: () => void;
  let reads = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/bff/session/refresh") {
      return new Promise<Response>((resolve) => {
        finish = () => resolve(new Response(null, { status: 204 }));
      });
    }
    init.signal?.throwIfAborted();
    return ++reads <= 2 ? expired() : new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  const a = bff("/api/v1/validate");
  const b = bff("/api/v1/profile", { signal: waiter.signal });
  let settled = false;
  const bResult = b.catch((error: unknown) => {
    settled = true;
    return error;
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  waiter.abort();
  try {
    await vi.waitFor(() => expect(settled).toBe(true));
  } finally {
    finish();
    await a;
    await bResult;
  }
  expect(await bResult).toMatchObject({ name: "AbortError" });
  expect(fetch.mock.calls.filter((c) => c[0] === "/bff/api/v1/profile")).toHaveLength(1);
});

it("a delayed old 401 reuses a completed renewal instead of rotating again", async () => {
  let finishOldRead!: () => void;
  let profileReads = 0;
  let validateReads = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url === "/bff/session/refresh") return new Response(null, { status: 204 });
    if (url === "/bff/api/v1/profile" && ++profileReads === 1) {
      return new Promise<Response>((resolve) => {
        finishOldRead = () => resolve(expired());
      });
    }
    if (url === "/bff/api/v1/validate" && ++validateReads === 1) return expired();
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  const delayed = bff("/api/v1/profile");
  expect((await bff("/api/v1/validate")).status).toBe(200);
  finishOldRead();
  expect((await delayed).status).toBe(200);
  expect(fetch.mock.calls.filter((c) => c[0] === "/bff/session/refresh")).toHaveLength(1);
});
