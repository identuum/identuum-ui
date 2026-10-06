/**
 * UI-SEC-HEADERS (M1): the binary serves the export under a script policy
 * without 'unsafe-eval'. zod 4 probes eval once (`new Function("")` inside a
 * try) to pick its fast path; the browser reports that probe as a policy
 * violation on every page even though zod catches the throw. The export turns
 * zod's jitless mode on before any schema runs, which skips the probe.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("the export never asks the browser for eval [M1]", () => {
  it("a zod object parse after the export's setup calls no Function constructor", async () => {
    await import("../src/zod-jitless");
    const { z } = await import("zod");
    const spy = vi.spyOn(globalThis, "Function");
    const schema = z.object({ email: z.string(), days: z.number().int() });
    expect(schema.parse({ email: "a@b.test", days: 3 })).toEqual({ email: "a@b.test", days: 3 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the export entry loads the setup before anything else that runs", () => {
    const main = readFileSync(resolve(__dirname, "../src/main.tsx"), "utf8");
    const imports = [...main.matchAll(/^import .*$/gm)].map((m) => m[0]);
    expect(imports[0]).toBe('import "./zod-jitless";');
  });
});
