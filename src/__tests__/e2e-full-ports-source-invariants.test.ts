/**
 * e2e-full-ports-source-invariants.test.ts — OSS-TEST-FULL-PORTS
 *
 * Owner ruling t (2026-10-07): the e2e-full harness runs beside the owner's
 * dev stack. Its appliance and dev-loop UI use host ports 17113 and 17108
 * (Postgres stays 15513); the dev stack keeps 5513, 7113 and 7114. Each port
 * has ONE source, E2E_APP_PORT / E2E_UI_PORT in full-run.sh, which reaches
 * compose as DEV_APP_PORT and every spec through the environment
 * (e2e-full/helpers/harness.ts). These pins keep it so:
 *
 *   (a) no file under e2e-full/ (outside .evidence/) names port 7113 — a
 *       literal there once made a spec fall back to whatever served the dev
 *       stack's port;
 *   (b) full-run.sh declares each harness port exactly once, with the
 *       ruling's values, and exports the appliance port and the IdP base
 *       and origin from it;
 *   (c) every spec that talks to the appliance takes its base from the
 *       harness helper, which has no default.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const E2E_FULL = resolve(REPO, "e2e-full");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === ".evidence" || name === "node_modules") continue;
      out.push(...walk(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

const DEV_APP_PORT = /(^|[^0-9])7113([^0-9]|$)/;

describe("the e2e-full harness keeps off the dev stack's ports [OSS-TEST-FULL-PORTS]", () => {
  it("no file under e2e-full/ names port 7113", () => {
    const files = walk(E2E_FULL);
    expect(files.length, "the walk must see the harness files").toBeGreaterThan(10);
    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (DEV_APP_PORT.test(line))
            hits.push(`${relative(REPO, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, "port 7113 is the dev stack's; the harness reads E2E_APP_PORT").toEqual([]);
  });

  it("full-run.sh declares each harness port once, with ruling t's values", () => {
    const src = read("e2e-full/scripts/full-run.sh");
    expect(src.match(/^E2E_APP_PORT=.*$/gm)).toEqual(["E2E_APP_PORT=17113"]);
    expect(src.match(/^E2E_UI_PORT=.*$/gm)).toEqual(["E2E_UI_PORT=17108"]);
    expect(src.match(/^export DEV_PG_HOST_PORT=.*$/gm)).toEqual(["export DEV_PG_HOST_PORT=15513"]);
    expect(src).toMatch(/^export DEV_APP_PORT="\$E2E_APP_PORT"$/m);
    expect(src).toMatch(/^E2E_IDP_BASE="http:\/\/127\.0\.0\.1:\$\{E2E_APP_PORT\}"$/m);
    expect(src).toMatch(/^export IDENTUUM_E2E_FULL_IDP_BASE="\$E2E_IDP_BASE"$/m);
    expect(src).toMatch(
      /^export IDENTUUM_E2E_FULL_IDP_ORIGIN="http:\/\/localhost:\$\{E2E_APP_PORT\}"$/m
    );
  });

  it("every spec takes the appliance base from the harness helper, which has no default", () => {
    const helper = read("e2e-full/helpers/harness.ts");
    expect(helper).not.toMatch(/\?\?/);
    expect(helper).toMatch(/throw new Error/);
    const specs = readdirSync(E2E_FULL).filter((f) => f.endsWith(".spec.ts"));
    for (const spec of specs) {
      const src = read(`e2e-full/${spec}`);
      expect(src, `${spec} reads IDENTUUM_E2E_FULL_IDP_BASE directly`).not.toMatch(
        /process\.env\.IDENTUUM_E2E_FULL_IDP_(BASE|ORIGIN)/
      );
      if (/\bIDP_BASE\b/.test(src)) {
        expect(src, `${spec} declares IDP_BASE without the helper`).toMatch(
          /const IDP_BASE = harnessIdpBase\(\);/
        );
      }
    }
  });
});
