// UI-DATES (owner decision U-020): what the UI SENDS stays UTC ISO 8601,
// whatever zone the server process or the viewer is in. The audit date filter
// and a service account's expiry are the dates the UI produces as data; the
// calendar days a date input yields (YYYY-MM-DD) are read as UTC days.

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const EXPLICIT_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * The UTC ISO bounds the audit API is queried with: a preset window ending
 * now, or the start of `startDate` and the end of `endDate` as UTC days.
 */
export function auditDateRange(
  window: string | null,
  startDate: string | null,
  endDate: string | null,
  nowMs: number,
  // OSS-FIN-1: the browser's UTC instants for the viewer's local days
  // (start_utc / end_utc, set by LocalDayBounds at submit). Preferred when
  // each parses as a UTC ISO instant; otherwise the day is read as UTC.
  startUtc: string | null = null,
  endUtc: string | null = null
): { startDateISO: string | null; endDateISO: string | null } {
  const days = window ? WINDOW_DAYS[window] : undefined;
  if (days) {
    return { startDateISO: new Date(nowMs - days * DAY_MS).toISOString(), endDateISO: null };
  }
  const instant = (s: string | null): string | null =>
    s !== null && UTC_INSTANT.test(s) && !Number.isNaN(Date.parse(s))
      ? new Date(s).toISOString()
      : null;
  const fromBrowser = { start: instant(startUtc), end: instant(endUtc) };
  // Only a calendar day: a zone-less date-time ("2026-09-24T10:00") would
  // parse in the server process's zone.
  const isDay = (s: string | null): s is string =>
    s !== null && CALENDAR_DAY.test(s) && !Number.isNaN(Date.parse(s));
  return {
    startDateISO: fromBrowser.start ?? (isDay(startDate) ? `${startDate}T00:00:00.000Z` : null),
    endDateISO: fromBrowser.end ?? (isDay(endDate) ? `${endDate}T23:59:59.999Z` : null),
  };
}

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** The UTC instant of 00:00 on `day` in the viewer's zone (runs in the browser). */
export function localDayStartUtc(day: string): string | null {
  if (!CALENDAR_DAY.test(day)) return null;
  const t = new Date(`${day}T00:00:00`).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** The UTC instant of the last millisecond of `day` in the viewer's zone. */
export function localDayEndUtc(day: string): string | null {
  if (!CALENDAR_DAY.test(day)) return null;
  const t = new Date(`${day}T23:59:59.999`).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * A service account expiry as UTC ISO: a calendar day (from <input
 * type="date">) is the end of that UTC day; anything else must carry an
 * explicit zone. Null when it does not parse or is not in the future.
 */
export function expiryUtcIso(raw: string, nowMs: number): string | null {
  let candidate: string;
  if (CALENDAR_DAY.test(raw)) candidate = `${raw}T23:59:59Z`;
  else if (EXPLICIT_ZONE.test(raw)) candidate = raw;
  else return null;
  const t = Date.parse(candidate);
  if (Number.isNaN(t) || t < nowMs) return null;
  return new Date(t).toISOString();
}
