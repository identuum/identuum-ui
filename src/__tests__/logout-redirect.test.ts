/**
 * logout-redirect.test.ts — sign-out lands on /login on the PUBLIC origin
 * (v0.2.3, F2).
 *
 * In the container, Next sees the request URL as the listen address
 * (http://0.0.0.0:7104), not the origin the browser used. A Location built
 * from req.nextUrl.origin sent every browser to 0.0.0.0 and a connection
 * error after sign-out. The Location is now relative, so the browser
 * resolves it against the origin it is on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLIC = "http://localhost:17104";

vi.mock("../lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({
    configured: true,
    ui_origin: PUBLIC,
    idp: { enabled: true, public_base_url: "http://idp.test" },
    ag: { enabled: false, public_base_url: "" },
  }),
  idpBaseUrl: () => "http://idp.test",
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signOutFromContainer() {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../app/api/auth/logout/route");
  // The URL Next hands the route inside the container; the browser is on PUBLIC.
  return POST(
    new NextRequest("http://0.0.0.0:7104/api/auth/logout", {
      method: "POST",
      headers: { origin: PUBLIC, host: "localhost:17104", cookie: "access_token=a" },
    })
  );
}

describe("logout redirect", () => {
  it("never points the browser at the container's listen address", async () => {
    const res = await signOutFromContainer();
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("0.0.0.0");
    expect(location).not.toContain(":7104");
  });

  it("resolves to /login on the public origin", async () => {
    const res = await signOutFromContainer();
    const location = res.headers.get("location") ?? "";
    expect(new URL(location, PUBLIC).href).toBe(`${PUBLIC}/login`);
  });

  it("still clears both auth cookies", async () => {
    const res = await signOutFromContainer();
    const setCookies = res.headers.getSetCookie();
    for (const name of ["access_token", "refresh_token"]) {
      expect(setCookies.some((c) => c.startsWith(`${name}=`) && /max-age=0/i.test(c))).toBe(true);
    }
  });
});
