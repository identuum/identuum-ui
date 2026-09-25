import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// UI-DATES (owner decision U-020): every date the UI shows goes through ONE
// component and helper (src/components/ui/local-time.tsx,
// src/lib/local-time.ts), which formats only in the browser. A locale or
// time-zone dependent formatter anywhere else would bring back a server
// render that differs from the browser's — the 23:00–00:05 UTC hydration
// mismatch. Numbers go through src/lib/format-count.ts (a fixed locale).

const ROOT = join(__dirname, "..", "..");
const SCANNED = ["src", "export/src"];
const ALLOWED = new Set(["src/lib/local-time.ts"]);
const FORBIDDEN = /\.toLocale(String|DateString|TimeString)\(|Intl\.DateTimeFormat/;
const IS_TEST = /(__tests__\/|\.test\.tsx?$|\.spec\.tsx?$)/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
}

it("no locale or time-zone dependent formatter outside the one date helper", () => {
  const files: string[] = [];
  for (const d of SCANNED) walk(join(ROOT, d), files);
  const offenders: string[] = [];
  for (const f of files) {
    const rel = relative(ROOT, f);
    if (ALLOWED.has(rel) || IS_TEST.test(rel)) continue;
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (FORBIDDEN.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
  }
  expect(files.length).toBeGreaterThan(100);
  expect(offenders).toEqual([]);
});
