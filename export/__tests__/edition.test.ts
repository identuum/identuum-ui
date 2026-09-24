import { describe, expect, it, vi } from "vitest";
import { loadEdition } from "../src/edition";

// The edition comes from the binary's own /api/runtime-config (pkg/uiserve),
// read once at boot.
describe("loadEdition", () => {
  it("reads edition from /api/runtime-config once", async () => {
    const f = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(JSON.stringify({ configured: true, edition: "oss" }), { status: 200 })
    );
    expect(await loadEdition(f as unknown as typeof fetch)).toBe("oss");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]?.[0])).toBe("/api/runtime-config");
  });

  it.each([
    ["a failed request", async () => new Response("", { status: 503 })],
    ["no edition field", async () => new Response("{}", { status: 200 })],
    [
      "a network error",
      async (): Promise<Response> => {
        throw new TypeError("offline");
      },
    ],
  ])("%s is unknown", async (_label, impl) => {
    expect(await loadEdition(vi.fn(impl) as unknown as typeof fetch)).toBe("unknown");
  });
});
