/**
 * export-signed-out-probe.test.ts — OSS-HARDEN item 4 (2026-10-01)
 *
 * Under the login-step opt-in (X-Identuum-Login-Step-Status: 200) the IdP
 * answers a session probe or a refresh that presents NO credential 200
 * {"authenticated":false}, so a signed-out visit to / logs no failed
 * resource. The console's session probe opts in; the refresh is still tried
 * first (an expired access cookie with a live refresh cookie is not signed
 * out); and a caller that did not opt in still sees the refresh's 401.
 *
 * SECURITY: synthetic responses only; no credential appears here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bff } from "../../export/src/bff";
import { validateSession } from "../../export/src/session";
import { LOGIN_STEP_STATUS_HEADER } from "../lib/idp-client";
import { validateSessionResponse } from "../lib/session-validation";

const SIGNED_OUT = JSON.stringify({ authenticated: false });
const SESSION = JSON.stringify({
  user: { id: "u-1", email: "user@example.invalid", role: "org_user" },
  role: "org_user",
});

type Route = (headers: Headers) => Response;

function server(routes: Record<string, Route[]>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const queue = routes[url];
    if (!queue?.length) throw new Error(`unexpected fetch ${url}`);
    return (queue.shift() as Route)(new Headers(init?.headers));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const optedIn = (fetch: ReturnType<typeof server>, i: number) =>
  new Headers((fetch.mock.calls[i][1] as RequestInit).headers).get(LOGIN_STEP_STATUS_HEADER);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the signed-out session probe", () => {
  it("reads 200 {authenticated:false} as signed out, never as a session", async () => {
    const state = await validateSessionResponse(
      async () => new Response(SIGNED_OUT, { status: 200 })
    );
    expect(state.kind).toBe("unauthenticated");
  });

  it("opts in on the probe and the refresh, and answers signed out", async () => {
    const fetch = server({
      "/bff/api/v1/validate": [() => new Response(SIGNED_OUT, { status: 200 })],
      "/bff/session/refresh": [() => new Response(SIGNED_OUT, { status: 200 })],
    });
    expect(await validateSession()).toEqual({ kind: "unauthenticated", reason: "signed_out" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(optedIn(fetch, 0)).toBe("200");
    expect(optedIn(fetch, 1)).toBe("200");
  });

  it("a live refresh cookie still restores the session", async () => {
    server({
      "/bff/api/v1/validate": [
        () => new Response(SIGNED_OUT, { status: 200 }),
        () => new Response(SESSION, { status: 200 }),
      ],
      "/bff/session/refresh": [() => new Response(null, { status: 204 })],
    });
    expect(await validateSession()).toMatchObject({ kind: "authenticated", role: "org_user" });
  });

  it("a caller that did not opt in still receives the refresh's 401", async () => {
    server({
      "/bff/api/v1/users": [
        () =>
          new Response(JSON.stringify({ error: "unauthorized", reason: "missing_credential" }), {
            status: 401,
          }),
      ],
      "/bff/session/refresh": [() => new Response(SIGNED_OUT, { status: 200 })],
    });
    const res = await bff("/api/v1/users");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(JSON.stringify({ reason: "missing_refresh_credential" }));
  });
});
