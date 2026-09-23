/**
 * unavailable-not-expired.test.ts — THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02)
 *
 * RULE: UNAVAILABLE-NOT-EXPIRED-1
 *
 * A 503 (or a network failure) from the IdP NEVER produces
 * reason=session_expired and NEVER clears a cookie: the tri-state session
 * helper answers `unavailable` (with the IdP's correlation id and
 * Retry-After), the layouts' guard renders the unavailable state in place,
 * getServerSession() sends non-rendering callers to /unavailable, and the
 * retry loop honors Retry-After inside the stated cap. A genuine 401 still
 * answers `unauthenticated` and the guard still redirects to /login. The
 * logout route clears the browser's cookies even when the IdP is
 * unavailable — a stated decision — and names it in the redirect.
 *
 * Red-proof (mutation): revert getServerSession()'s unavailable branch to
 * `return null` (the pre-slice collapse) → "getServerSession never turns an
 * outage into null" fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar: Array<{ name: string; value: string }> = [{ name: "access_token", value: "live" }];
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => cookieJar }),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

function stubFetch(answers: Answer[]): { calls: number } {
  const state = { calls: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const a = answers[Math.min(state.calls, answers.length - 1)];
      state.calls += 1;
      if (a instanceof Error) throw a;
      return new Response(a.body === undefined ? null : JSON.stringify(a.body), {
        status: a.status,
        headers: { "content-type": "application/json", ...(a.headers ?? {}) },
      });
    })
  );
  return state;
}

// Fresh module per test: React's cache() memoises per module instance.
async function loadSession() {
  vi.resetModules();
  return await import("../lib/server-session");
}

describe("three states, honest retry, no false verdict [UNAVAILABLE-NOT-EXPIRED-1]", () => {
  beforeEach(() => {
    // Only the clock and setTimeout are faked: Response body reads (undici)
    // ride on setImmediate/microtasks, which must stay real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a 503 with correlation id + Retry-After is `unavailable`, never null, never /login [UNAVAILABLE-NOT-EXPIRED-1]", async () => {
    const answers: Answer[] = [
      {
        status: 503,
        body: {
          error: "temporarily_unavailable",
          reason: "auth_store_error",
          correlation_id: "cid-503",
        },
        headers: { "retry-after": "1", "x-request-id": "cid-503" },
      },
    ];
    stubFetch(answers);
    const mod = await loadSession();
    const statePromise = mod.getServerSessionState();
    await vi.advanceTimersByTimeAsync(mod.SESSION_VALIDATE_TOTAL_CAP_MS + 100);
    const state = await statePromise;
    expect(state.kind).toBe("unavailable");
    if (state.kind !== "unavailable") throw new Error("unreachable");
    expect(state.correlationId).toBe("cid-503");
    expect(state.retryAfterSeconds).toBe(1);
    expect(state.status).toBe(503);

    // getServerSession never turns an outage into null: it redirects to the
    // honest page, carrying the correlation id — and never to /login.
    // (React's cache() memoises only inside a server request; here the call
    // re-runs the loop, so the fake clock is advanced for it as well.)
    let redirectedTo = "";
    const sessionCall = mod.getServerSession().then(
      () => "resolved",
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(mod.SESSION_VALIDATE_TOTAL_CAP_MS + 100);
    const outcome = await sessionCall;
    if (outcome instanceof RedirectSignal) redirectedTo = outcome.to;
    else throw new Error(`getServerSession must redirect on an outage, got ${String(outcome)}`);
    expect(redirectedTo.startsWith("/unavailable?")).toBe(true);
    expect(redirectedTo).toContain("cid=cid-503");
    expect(redirectedTo).not.toContain("/login");
    expect(redirectedTo).not.toContain("session_expired");
    // The helper never touches cookies: the jar is exactly what the request carried.
    expect(cookieJar).toEqual([{ name: "access_token", value: "live" }]);
  });

  it("the guard renders the unavailable state in place for an outage and redirects to /login only for a verdict", async () => {
    const { decideSessionGuard, LOGIN_SESSION_EXPIRED } = await import("../lib/session-guard");
    const outage = decideSessionGuard({
      kind: "unavailable",
      status: 503,
      correlationId: "cid-x",
      retryAfterSeconds: 1,
      attempts: 3,
      detail: "IdP validate answered 503",
    });
    expect(outage.action).toBe("render-unavailable");
    const verdict = decideSessionGuard({
      kind: "unauthenticated",
      status: 401,
      reason: "token_invalid",
    });
    expect(verdict).toEqual({ action: "redirect", to: LOGIN_SESSION_EXPIRED });
    const ok = decideSessionGuard({ kind: "authenticated", session: { role: "site_admin" } });
    expect(ok.action).toBe("proceed");
  });

  it("a genuine 401 is `unauthenticated` with the IdP's reason, no retry, and getServerSession returns null", async () => {
    const calls = stubFetch([
      { status: 401, body: { error: "unauthorized", reason: "token_invalid" } },
    ]);
    const mod = await loadSession();
    const state = await mod.getServerSessionState();
    expect(state).toEqual({ kind: "unauthenticated", status: 401, reason: "token_invalid" });
    expect(calls.calls).toBe(1);
    expect(await mod.getServerSession()).toBeNull();
  });

  it("honors Retry-After between attempts and recovers without any redirect", async () => {
    const calls = stubFetch([
      { status: 503, body: { correlation_id: "cid-1" }, headers: { "retry-after": "1" } },
      { status: 200, body: { role: "site_admin", user: { role: "site_admin" } } },
    ]);
    const mod = await loadSession();
    const statePromise = mod.getServerSessionState();
    await vi.advanceTimersByTimeAsync(999);
    expect(calls.calls).toBe(1); // the second attempt waits for Retry-After (1 s), not the 200 ms backoff
    await vi.advanceTimersByTimeAsync(2);
    const state = await statePromise;
    expect(state.kind).toBe("authenticated");
    expect(calls.calls).toBe(2);
  });

  it("caps the total wait at SESSION_VALIDATE_TOTAL_CAP_MS and states it", async () => {
    const calls = stubFetch([new Error("ECONNREFUSED")]);
    const mod = await loadSession();
    expect(mod.SESSION_VALIDATE_TOTAL_CAP_MS).toBe(8000);
    const started = Date.now();
    const statePromise = mod.getServerSessionState();
    await vi.advanceTimersByTimeAsync(mod.SESSION_VALIDATE_TOTAL_CAP_MS + 500);
    const state = await statePromise;
    expect(state.kind).toBe("unavailable");
    expect(Date.now() - started).toBeLessThanOrEqual(mod.SESSION_VALIDATE_TOTAL_CAP_MS + 500);
    expect(calls.calls).toBeGreaterThanOrEqual(2);
    if (state.kind === "unavailable") expect(state.attempts).toBe(calls.calls);
  });

  it("parses Retry-After as seconds or HTTP-date and plans waits inside the budget", async () => {
    const mod = await loadSession();
    expect(mod.parseRetryAfterSeconds("1")).toBe(1);
    expect(mod.parseRetryAfterSeconds("  7 ")).toBe(7);
    expect(mod.parseRetryAfterSeconds(null)).toBeNull();
    expect(mod.parseRetryAfterSeconds("soon")).toBeNull();
    const now = Date.parse("2026-09-02T18:00:00Z");
    expect(mod.parseRetryAfterSeconds("Wed, 02 Sep 2026 18:00:03 GMT", now)).toBe(3);
    // Retry-After 1 s beats the 200 ms backoff; the 2 s cap beats a 30 s Retry-After.
    expect(mod.planNextWaitMs(1, 1, 8000)).toBe(1000);
    expect(mod.planNextWaitMs(1, 30, 8000)).toBe(mod.SESSION_VALIDATE_MAX_WAIT_MS);
    expect(mod.planNextWaitMs(1, null, 8000)).toBe(200);
    // No budget left for a useful attempt → stop.
    expect(mod.planNextWaitMs(1, null, 250)).toBeNull();
  });

  it("logout clears the browser cookies even when the IdP is unavailable, and SAYS so in the redirect", async () => {
    vi.useRealTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch([
      {
        status: 503,
        body: { correlation_id: "cid-logout" },
        headers: { "x-request-id": "cid-logout" },
      },
    ]);
    vi.resetModules();
    const { POST } = await import("../app/api/auth/logout/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://ui.test/api/auth/logout", {
      method: "POST",
      // Same-origin form POST (the CSRF guard refuses anything else).
      headers: {
        cookie: "access_token=live; refresh_token=live",
        origin: "http://ui.test",
        host: "ui.test",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?reason=signed_out_locally");
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("access_token=") && /max-age=0/i.test(c))).toBe(
      true
    );
    expect(setCookies.some((c) => c.startsWith("refresh_token=") && /max-age=0/i.test(c))).toBe(
      true
    );
    expect(warn.mock.calls.some((c) => String(c[0]).includes("cid-logout"))).toBe(true);
    warn.mockRestore();
  });
});
