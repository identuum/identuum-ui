/**
 * browser-console-gate-source-invariants.test.ts — BROWSER-CONSOLE-GATE-1
 *
 * THE-ELEVEN-MISMATCHES (2026-09-15): for four days every e2e mint's dev
 * server printed "Hydration failed because the server rendered HTML didn't
 * match the client" eleven times, and every spec passed, because nothing in
 * e2e-full read the browser console. A React hydration mismatch — the server
 * and the client rendering different markup for the same state — was
 * invisible to every gate. A suite that exercises the appliance while a
 * rendering error scrolls past says less than it is read to say.
 *
 * The gate lives where every phase's evidence is born: pw-phase.sh reads the
 * phase's OWN traces (--trace on) and FAILS the phase on a React rendering or
 * hydration error, naming the page and the test. These pins keep it wired:
 *
 *   (a) the scan reads the run's traces: their uncaught page errors (how
 *       React 19 under next dev reports a hydration mismatch — measured, all
 *       eleven) and their console errors;
 *   (b) the failing class is React's — hydration text and React's own
 *       react.dev/link pointer — and the tolerated class is NAMED in the
 *       code (network-resource errors the suite provokes on purpose);
 *   (c) a hit exits non-zero and the phase's rc follows — an enforcing exit,
 *       not a neutralized one — and a trace the scan cannot read is red too;
 *   (d) the browser phases of full-run.sh record traces, so the scan has
 *       something to read.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string): string => readFileSync(resolve(REPO, p), "utf8");

/** Comment-stripped source, same rationale as SKIP-CEILING-1's pins. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*#.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n]*/g, "");

describe("e2e-full fails on a React rendering or hydration error in the browser console [BROWSER-CONSOLE-GATE-1]", () => {
  const sh = stripComments(read("e2e-full/scripts/pw-phase.sh"));

  it("pw-phase.sh reads the phase's own traces: their page errors and their console errors", () => {
    expect(sh, "trace attachments are taken from the run's JSON report").toMatch(
      /a\.name === "trace" && a\.path/
    );
    expect(sh, "the trace is unpacked from the zip the run wrote").toMatch(
      /execFileSync\("unzip", \["-p", zip, "\*\.trace"\]/
    );
    // MEASURED 2026-09-15: React 19 under `next dev` reports a hydration
    // mismatch as an UNCAUGHT page error — all eleven were pageError events,
    // none a console message. A scan that read only console events saw zero.
    expect(sh, "uncaught page errors are judged").toMatch(
      /e\.type === "event" && e\.method === "pageError"/
    );
    expect(sh, "console messages of type error are judged").toMatch(
      /e\.type === "console" && e\.messageType === "error"/
    );
  });

  it("the failing class is React's, and the tolerated class is named in the code", () => {
    expect(sh, "hydration mismatches fail").toMatch(/\/Hydration failed\//);
    expect(sh, "React's own error pointer fails").toMatch(
      /\/https:\\\/\\\/react\\\.dev\\\/link\\\/\//
    );
    expect(sh, "the recoverable-render report fails").toMatch(/\/\^The above error occurred in\//);
    expect(sh, "network-resource console errors are tolerated by name").toMatch(
      /Failed to load resource: the server responded with a status of/
    );
  });

  it("a hit exits non-zero and the phase's rc follows — an enforcing exit [BROWSER-CONSOLE-GATE-1]", () => {
    expect(
      sh,
      "the scan's exit is decided by the React hit count, failing closed on an unreadable trace"
    ).toMatch(
      /const red = reactHits > 0 \|\| unreadable > 0;[\s\S]*?process\.exit\(red \? 1 : 0\)/
    );
    expect(sh, "every hit is a check FAILED evidence line").toMatch(
      /check FAILED: \$\{phase\} browser-console: React error on/
    );
    expect(sh, "the phase's rc is raised when the scan fails").toMatch(
      /browser-console[\s\S]*?\[ "\$rc" -eq 0 \] && rc=1/
    );
  });

  it("the browser phases of full-run.sh record traces for the scan to read", () => {
    const run = stripComments(read("e2e-full/scripts/full-run.sh"));
    expect(run, "fresh-appliance records traces").toMatch(/'fresh-appliance=[^\n]*--trace on/);
    expect(run, "devloop-provisioned records traces").toMatch(
      /'devloop-provisioned=[^\n]*--trace on/
    );
  });
});
