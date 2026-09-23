/**
 * same-origin-guard.test.ts — CSRF guard on the /api/idp proxy and the
 * state-changing /api/auth/* routes (v0.2.3, F1).
 *
 * A page on another origin (cross-site, or the same site on another port)
 * must not be able to make the proxy act with the user's cookie. Refusals
 * happen before any upstream call; GET is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UI = "http://localhost:17104";
const cfg: { ui_origin: string } = { ui_origin: UI };

vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: cfg.ui_origin,
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

const SECRET_COOKIE = "access_token=cookie-value-must-not-leak";

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cfg.ui_origin = UI;
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

async function proxy(method: string, headers: Record<string, string>) {
  const { NextRequest } = await import("next/server");
  const mod = await import("../app/api/idp/[...path]/route");
  const req = new NextRequest(`${UI}/api/idp/api/v1/organizations/o1/roles`, {
    method,
    headers: { cookie: SECRET_COOKIE, host: "localhost:17104", ...headers },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify({ name: "r" }),
  });
  const handler = mod[method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE"];
  return handler(req, {
    params: Promise.resolve({ path: ["api", "v1", "organizations", "o1", "roles"] }),
  });
}

async function logout(headers: Record<string, string>) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../app/api/auth/logout/route");
  return POST(
    new NextRequest(`${UI}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: SECRET_COOKIE, host: "localhost:17104", ...headers },
    })
  );
}

function expectRefused(res: Response) {
  expect(res.status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
  const line = String(warn.mock.calls[0]?.[0]);
  expect(line).toContain("[csrf] refused");
  expect(line).not.toContain("cookie-value-must-not-leak");
}

describe("the /api/idp proxy refuses cross-origin state changes", () => {
  it("cross-site Origin → 403, no upstream call", async () => {
    expectRefused(
      await proxy("POST", { origin: "http://evil.test", "sec-fetch-site": "cross-site" })
    );
  });

  it("same-site page on another port → 403, no upstream call", async () => {
    expectRefused(
      await proxy("POST", { origin: "http://localhost:17556", "sec-fetch-site": "same-site" })
    );
  });

  it("no Origin and no Sec-Fetch-Site → 403", async () => {
    expectRefused(await proxy("POST", {}));
  });

  it("no Origin and Sec-Fetch-Site other than same-origin → 403", async () => {
    expectRefused(await proxy("DELETE", { "sec-fetch-site": "same-site" }));
  });

  it("an unparseable Origin (null) → 403", async () => {
    expectRefused(await proxy("PATCH", { origin: "null" }));
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("same-origin %s is forwarded", async (m) => {
    const res = await proxy(m, { origin: UI, "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("no Origin but Sec-Fetch-Site same-origin is forwarded", async () => {
    const res = await proxy("POST", { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET is untouched, even with a foreign Origin", async () => {
    const res = await proxy("GET", { origin: "http://evil.test", "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("with ui_origin unset, the Origin host must equal the Host header", async () => {
    cfg.ui_origin = "";
    expect((await proxy("POST", { origin: UI })).status).toBe(201);
    fetchMock.mockClear();
    expectRefused(await proxy("POST", { origin: "http://localhost:17556" }));
  });
});

describe("the state-changing /api/auth/* routes refuse cross-origin requests", () => {
  it("POST /api/auth/logout from another origin → 403, no upstream call, no cookie cleared", async () => {
    const res = await logout({ origin: "http://localhost:17556", "sec-fetch-site": "same-site" });
    expectRefused(res);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("POST /api/auth/logout with no Origin and no Sec-Fetch-Site → 403", async () => {
    expectRefused(await logout({}));
  });

  it("POST /api/auth/logout from the UI origin signs out", async () => {
    const res = await logout({ origin: UI, "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(303);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
