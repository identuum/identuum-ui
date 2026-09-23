import { afterEach, expect, it, vi } from "vitest";
import { BFF_REQUEST_HEADER, BFF_REQUEST_HEADER_VALUE, bff } from "../../export/src/bff";

// The OSS boundary (internal/api/ui.go) requires the browser proof header on
// EVERY /bff request, reads included: a request without it is refused 403.
// Plan C's browser run stopped at login because reads went out without it.

afterEach(() => {
  vi.unstubAllGlobals();
});

function capture() {
  const seen: { url: string; method: string; proof: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      seen.push({
        url,
        method: String(init.method),
        proof: new Headers(init.headers).get(BFF_REQUEST_HEADER),
      });
      return new Response("{}", { status: 200 });
    })
  );
  return seen;
}

it.each(["GET", "HEAD", undefined])(
  "a %s through the boundary carries the browser proof",
  async (method) => {
    const seen = capture();
    await bff("/api/v1/users/fixture", method ? { method } : {});
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: "/bff/api/v1/users/fixture",
      proof: BFF_REQUEST_HEADER_VALUE,
    });
  }
);

it("every request of a mutation, its validate pre-check included, carries the browser proof", async () => {
  const seen = capture();
  await bff("/api/v1/profile", { method: "PUT", body: "{}" });
  expect(seen.map((s) => s.url)).toEqual(["/bff/api/v1/validate", "/bff/api/v1/profile"]);
  for (const s of seen) expect(s.proof).toBe(BFF_REQUEST_HEADER_VALUE);
});
