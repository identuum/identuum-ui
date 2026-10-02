/**
 * OSS-QUEUE-TRIAGE Part 3.3: /platform-status shows "version (commit <short>)"
 * from what the IdP already serves — /api/v1/component's version and the
 * public /system/info build_commit. An IdP that serves no commit shows the
 * version alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchIdpBuildCommit, versionWithCommit } from "../lib/runtime-composition";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  vi.fn(async (_input: string) => new Response(JSON.stringify(body), { status }));

describe("versionWithCommit", () => {
  it("adds the short commit", () => {
    expect(versionWithCommit("0.9.1", "1633ffb25f7eb9557e6062f125f0979b8da9ae48")).toBe(
      "0.9.1 (commit 1633ffb25f7e)"
    );
  });
  it("is the version alone without a commit", () => {
    expect(versionWithCommit("0.9.1", null)).toBe("0.9.1");
    expect(versionWithCommit("0.9.1", "")).toBe("0.9.1");
  });
});

describe("fetchIdpBuildCommit", () => {
  it("reads build_commit from /system/info", async () => {
    const f = answer(200, { status: "healthy", version: "0.9.1", build_commit: "1633ffb25f7e" });
    vi.stubGlobal("fetch", f);
    expect(await fetchIdpBuildCommit("http://idp.test")).toBe("1633ffb25f7e");
    expect(String(f.mock.calls[0]?.[0])).toBe("http://idp.test/system/info");
  });
  it("answers null when the IdP serves no commit, an error or nothing", async () => {
    vi.stubGlobal("fetch", answer(200, { status: "healthy" }));
    expect(await fetchIdpBuildCommit("")).toBeNull();
    vi.stubGlobal("fetch", answer(404, {}));
    expect(await fetchIdpBuildCommit("")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("down")))
    );
    expect(await fetchIdpBuildCommit("")).toBeNull();
  });
});
