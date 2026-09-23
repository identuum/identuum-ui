import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ ui_origin: "http://ui.test", idp: { enabled: true } }),
  idpBaseUrl: () => "http://idp.test",
}));

import { POST } from "@/app/api/auth/logout/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser logout security", () => {
  it.each([403, 429, 200, 302])(
    "reports upstream %s as local-only, never confirmed revocation",
    async (status) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      const result = await POST(
        new NextRequest("http://ui.test/api/auth/logout", {
          method: "POST",
          headers: { origin: "http://ui.test" },
        })
      );
      expect(result.headers.get("location")).toBe("/login?reason=signed_out_locally");
      expect(result.headers.getSetCookie()).toHaveLength(2);
    }
  );

  it("honors an upstream unconfirmed marker even on a 204 response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 204,
          headers: { "X-Identuum-Logout": "revocation_unconfirmed" },
        })
      )
    );
    const result = await POST(
      new NextRequest("http://ui.test/api/auth/logout", {
        method: "POST",
        headers: { origin: "http://ui.test" },
      })
    );
    expect(result.headers.get("location")).toBe("/login?reason=signed_out_locally");
  });
  it.each([undefined, "https://foreign.test", "http://ui.test.attacker.test"])(
    "refuses missing or foreign origin before forwarding or clearing cookies (%s)",
    async (origin) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const headers = new Headers({ cookie: "access_token=fixture" });
      if (origin) headers.set("origin", origin);
      const result = await POST(
        new NextRequest("http://ui.test/api/auth/logout", { method: "POST", headers })
      );
      expect(result.status).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
      expect(result.headers.getSetCookie()).toHaveLength(0);
    }
  );

  it("forwards only auth cookies with the backend CSRF header and a timeout", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const result = await POST(
      new NextRequest("http://ui.test/api/auth/logout", {
        method: "POST",
        headers: { origin: "http://ui.test", cookie: "access_token=fixture; unrelated=omit" },
      })
    );
    expect(result.status).toBe(303);
    const options = fetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(options.headers);
    expect(headers.get("X-Requested-With")).toBe("identuum-ui");
    expect(headers.get("cookie")?.includes("unrelated=")).toBe(false);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.redirect).toBe("manual");
  });
});
