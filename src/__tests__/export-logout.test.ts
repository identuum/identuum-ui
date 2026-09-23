import { afterEach, expect, it, vi } from "vitest";
import { signOutDestination } from "../../export/src/logout";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("bounds stalled browser transport without claiming revocation or cookie clearing", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("fixture timeout")), {
            once: true,
          });
        })
    )
  );
  let destination: string | undefined;
  void signOutDestination().then((value) => {
    destination = value;
  });
  await vi.advanceTimersByTimeAsync(6100);
  expect(destination).toBe("/login?reason=sign_out_unconfirmed");
});

it.each([403, 404, 503, 200])(
  "never calls an unconfirmed response (%s) a completed logout",
  async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    expect(await signOutDestination()).toBe("/login?reason=sign_out_unconfirmed");
  }
);

it("does not claim local cookie clearing when the browser received no response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));
  expect(await signOutDestination()).toBe("/login?reason=sign_out_unconfirmed");
});

it("distinguishes confirmed revocation and confirmed local-only clearing", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ logout: "local_only" }), { status: 200 })
      )
  );
  expect(await signOutDestination()).toBe("/login?reason=signed_out");
  expect(await signOutDestination()).toBe("/login?reason=signed_out_locally");
});
