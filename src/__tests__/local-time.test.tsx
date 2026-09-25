import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalTime } from "@/components/ui/local-time";
import { formatCount } from "@/lib/format-count";
import { formatLocalTime, parseInstant, utcIso } from "@/lib/local-time";

// UI-DATES (owner decision U-020): the one date helper and component. These
// replace the per-page formatDate helpers and their tests (sessions-section
// .test.ts accepted "—" OR "Invalid Date" for garbage input; now only "—").

const NIGHT = "2026-09-24T23:30:00Z";

describe("parseInstant / utcIso", () => {
  it.each([null, undefined, "", "not-a-date", Number.NaN])("%s is no instant", (v) => {
    expect(parseInstant(v)).toBeNull();
    expect(utcIso(v)).toBeNull();
  });

  it("gives the exact UTC ISO form of an offset timestamp", () => {
    expect(utcIso("2026-09-25T13:30:00+14:00")).toBe("2026-09-24T23:30:00.000Z");
  });
});

describe("formatLocalTime shows the instant in the given zone, zone named", () => {
  it("renders one instant on different calendar days in zones 26 hours apart", () => {
    expect(formatLocalTime(NIGHT, "datetime", "Etc/GMT+12")).toBe("Sep 24, 2026, 11:30 AM GMT-12");
    expect(formatLocalTime(NIGHT, "datetime", "Pacific/Kiritimati")).toBe(
      "Sep 25, 2026, 01:30 PM GMT+14"
    );
  });

  it("date style keeps the zone", () => {
    expect(formatLocalTime(NIGHT, "date", "UTC")).toBe("Sep 24, 2026, UTC");
  });

  it("seconds style", () => {
    expect(formatLocalTime(NIGHT, "datetime-seconds", "UTC")).toBe("Sep 24, 2026, 11:30:00 PM UTC");
  });

  it("never 'Invalid Date'", () => {
    expect(formatLocalTime("not-a-date")).toBeNull();
  });
});

describe("<LocalTime> server render", () => {
  it("emits the zone-free UTC instant with the UTC ISO title", () => {
    expect(renderToString(<LocalTime value={NIGHT} />)).toBe(
      '<time dateTime="2026-09-24T23:30:00.000Z" title="2026-09-24T23:30:00.000Z">2026-09-24T23:30:00.000Z</time>'
    );
  });

  it.each([null, "", "garbage"])("renders the fallback for %s", (v) => {
    expect(renderToString(<LocalTime value={v} />)).toBe("<span>—</span>");
    expect(renderToString(<LocalTime value={v} fallback="Never" />)).toBe("<span>Never</span>");
  });
});

describe("formatCount uses one fixed locale", () => {
  it("groups thousands the same wherever it runs", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});
