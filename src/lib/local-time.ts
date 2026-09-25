// UI-DATES (owner decision U-020, platform/decisions.md): UTC on the wire,
// shown in the viewer's browser zone, formatted ONLY in the browser. This is
// the one module allowed to call Intl.DateTimeFormat or toLocale*String
// (src/__tests__/local-time-guard.test.ts); render dates with <LocalTime>
// (src/components/ui/local-time.tsx), which calls it after mount.

export type LocalTimeStyle = "date" | "datetime" | "datetime-seconds";

const OPTIONS: Record<LocalTimeStyle, Intl.DateTimeFormatOptions> = {
  date: { year: "numeric", month: "short", day: "numeric", timeZoneName: "short" },
  datetime: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  },
  "datetime-seconds": {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  },
};

export type Instant = string | number | Date | null | undefined;

/** The instant `value` names, or null when it is empty or not a date. */
export function parseInstant(value: Instant): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The exact UTC ISO 8601 form of `value` (the wire and data form), or null. */
export function utcIso(value: Instant): string | null {
  return parseInstant(value)?.toISOString() ?? null;
}

/**
 * `value` formatted with its zone shown ("Sep 24, 2026, 11:30 AM GMT-12"), in
 * `timeZone` or, when omitted, the zone of the runtime calling it. Call it only
 * in the browser: a server render must not depend on its process's zone.
 */
export function formatLocalTime(
  value: Instant,
  style: LocalTimeStyle = "datetime",
  timeZone?: string
): string | null {
  const d = parseInstant(value);
  if (!d) return null;
  return new Intl.DateTimeFormat("en-US", { ...OPTIONS[style], timeZone }).format(d);
}
