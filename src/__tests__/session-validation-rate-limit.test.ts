import { afterEach, expect, it, vi } from "vitest";
import { validateSessionResponse } from "@/lib/session-validation";

afterEach(() => {
  vi.useRealTimers();
});

// A 429 from /api/v1/validate is the IdP declining to judge right now, not a
// verdict about the session: it must never become "unauthenticated" (which
// the guards turn into a session-expired redirect).
it("treats a validate 429 as unavailable and honours its Retry-After within the budget", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  let calls = 0;
  const pending = validateSessionResponse(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "Retry-After": "1", "X-Request-ID": "cid-429" },
    });
  });
  await vi.advanceTimersByTimeAsync(8100);
  expect(await pending).toMatchObject({
    kind: "unavailable",
    status: 429,
    correlationId: "cid-429",
    retryAfterSeconds: 1,
  });
  expect(calls).toBeGreaterThan(1);
});

it("keeps a 401 a verdict", async () => {
  const state = await validateSessionResponse(
    async () => new Response(JSON.stringify({ reason: "token_expired" }), { status: 401 })
  );
  expect(state).toEqual({ kind: "unauthenticated", status: 401, reason: "token_expired" });
});
