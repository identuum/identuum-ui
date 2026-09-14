import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/status/route";
import RootLayout from "@/app/layout";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "sans" }),
  Geist_Mono: () => ({ variable: "mono" }),
}));
vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true }, ag: { enabled: false } }),
  idpBaseUrl: () => "http://connected-idp",
  agBaseUrl: () => "http://unused-ag",
}));

afterEach(() => vi.unstubAllGlobals());

const warning =
  "Brute-force protections are disabled. This instance is not safe for real accounts.";

describe("continuous brute-force warning", () => {
  for (const mode of ["disabled", "", "enabled", "true"]) {
    it(`renders only the server's explicit disabled state: ${mode}`, async () => {
      const fetcher = vi.fn(
        async () =>
          new Response("{}", {
            headers: mode ? { "X-Identuum-Brute-Force-Protection": mode } : {},
          })
      );
      vi.stubGlobal("fetch", fetcher);
      const status = await (await GET()).json();
      expect(status.idp.brute_force_protection_disabled === true).toBe(mode === "disabled");
      const html = renderToStaticMarkup(await RootLayout({ children: <main>Any page</main> }));
      expect(html.includes(warning)).toBe(mode === "disabled");
      expect(html).toContain("Any page");
      expect(fetcher).toHaveBeenCalledWith(
        "http://connected-idp/healthz",
        expect.objectContaining({ cache: "no-store" })
      );
      if (mode === "disabled") {
        expect(html).toContain('role="alert"');
        expect(html).not.toMatch(/<button|<details|hidden=|aria-hidden="true"/);
      }
    });
  }

  it("reports OSS's signal even on a not-serving health response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/healthz")
          ? new Response("", { status: 404 })
          : new Response("{}", {
              status: 503,
              headers: { "X-Identuum-Brute-Force-Protection": "disabled" },
            })
      )
    );
    const status = await (await GET()).json();
    expect(status.idp.brute_force_protection_disabled).toBe(true);
    expect(status.idp.healthy).toBe(false);
    expect(renderToStaticMarkup(await RootLayout({ children: null }))).toContain(warning);
  });

  it("keeps observation live and offers no dismissal state", () => {
    const source = readFileSync("src/components/shared/brute-force-warning.tsx", "utf8");
    expect(source).toContain('fetch("/api/status"');
    expect(source).toContain("setInterval");
    expect(source).toContain("usePathname");
    expect(source).not.toMatch(/localStorage|sessionStorage|onClick|dismiss|process\.env/);
  });
});
