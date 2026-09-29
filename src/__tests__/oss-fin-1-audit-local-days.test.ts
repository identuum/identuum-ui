/**
 * OSS-FIN-1 item 4 (U-020): the audit filter's From/To are the VIEWER's local
 * calendar days, sent to the IdP as UTC instants. The browser computes the
 * instants (start_utc / end_utc) from the date inputs at submit; the server
 * prefers them and falls back to UTC days when they are absent (no script).
 * The zone is fixed per case with process.env.TZ, so the proof does not
 * depend on the machine running it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditDateRange, localDayEndUtc, localDayStartUtc } from "../lib/utc-wire";

const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

describe("local days become UTC instants", () => {
  for (const [tz, start, end] of [
    ["America/New_York", "2026-09-24T04:00:00.000Z", "2026-09-25T03:59:59.999Z"],
    ["Asia/Tokyo", "2026-09-23T15:00:00.000Z", "2026-09-24T14:59:59.999Z"],
    ["UTC", "2026-09-24T00:00:00.000Z", "2026-09-24T23:59:59.999Z"],
  ] as const) {
    it(`2026-09-24 in ${tz}`, () => {
      process.env.TZ = tz;
      expect(localDayStartUtc("2026-09-24")).toBe(start);
      expect(localDayEndUtc("2026-09-24")).toBe(end);
    });
  }
  it("anything that is not a calendar day is refused", () => {
    expect(localDayStartUtc("2026-09-24T10:00")).toBeNull();
    expect(localDayEndUtc("")).toBeNull();
  });
});

describe("the server prefers the browser's instants", () => {
  it("uses start_utc / end_utc when both parse as UTC ISO", () => {
    expect(
      auditDateRange(
        null,
        "2026-09-24",
        "2026-09-24",
        0,
        "2026-09-24T04:00:00.000Z",
        "2026-09-25T03:59:59.999Z"
      )
    ).toEqual({
      startDateISO: "2026-09-24T04:00:00.000Z",
      endDateISO: "2026-09-25T03:59:59.999Z",
    });
  });
  it("falls back to UTC days when the instants are absent or malformed", () => {
    expect(auditDateRange(null, "2026-09-24", "2026-09-24", 0, null, "not-a-date")).toEqual({
      startDateISO: "2026-09-24T00:00:00.000Z",
      endDateISO: "2026-09-24T23:59:59.999Z",
    });
  });
});

describe("the form says so", () => {
  it("the filter panel names local days and UTC", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "components/shared/audit-filter-panel.tsx"),
      "utf8"
    ).replace(/\s+/g, " ");
    expect(src).toContain("LocalDayBounds");
    expect(src).toMatch(/your local days/i);
    expect(src).toMatch(/sent as UTC/i);
  });
});
