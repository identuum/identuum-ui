import { afterEach, describe, expect, it } from "vitest";
import { auditDateRange, expiryUtcIso } from "@/lib/utc-wire";

// UI-DATES (owner decision U-020): the dates the UI produces as data — the
// audit date filter sent to the API (site-admin and org-admin audit) and a
// service account's expiry (org-admin create form) — are UTC ISO 8601 and do
// not depend on the server process's zone.

const NOW = Date.parse("2026-09-24T23:30:00Z");
const ZONES = ["Pacific/Kiritimati", "Etc/GMT+12", "UTC"];
const original = process.env.TZ;
afterEach(() => {
  process.env.TZ = original;
});

describe.each(ZONES)("under TZ=%s", (tz) => {
  it("audit presets end now, in UTC", () => {
    process.env.TZ = tz;
    expect(auditDateRange("24h", null, null, NOW)).toEqual({
      startDateISO: "2026-09-23T23:30:00.000Z",
      endDateISO: null,
    });
    expect(auditDateRange("7d", null, null, NOW).startDateISO).toBe("2026-09-17T23:30:00.000Z");
    expect(auditDateRange("30d", null, null, NOW).startDateISO).toBe("2026-08-25T23:30:00.000Z");
  });

  it("an audit custom range covers whole UTC days", () => {
    process.env.TZ = tz;
    expect(auditDateRange(null, "2026-09-24", "2026-09-25", NOW)).toEqual({
      startDateISO: "2026-09-24T00:00:00.000Z",
      endDateISO: "2026-09-25T23:59:59.999Z",
    });
  });

  it("an audit custom range ignores what is not a calendar day", () => {
    process.env.TZ = tz;
    expect(auditDateRange(null, "2026-09-24T10:00", "garbage", NOW)).toEqual({
      startDateISO: null,
      endDateISO: null,
    });
  });

  it("a service account expiry is the end of the UTC day, or an explicit instant", () => {
    process.env.TZ = tz;
    expect(expiryUtcIso("2026-12-31", NOW)).toBe("2026-12-31T23:59:59.000Z");
    expect(expiryUtcIso("2026-12-31T10:00:00+02:00", NOW)).toBe("2026-12-31T08:00:00.000Z");
    expect(expiryUtcIso("2026-12-31T10:00", NOW)).toBeNull();
    expect(expiryUtcIso("2026-09-01", NOW)).toBeNull();
    expect(expiryUtcIso("garbage", NOW)).toBeNull();
  });
});
