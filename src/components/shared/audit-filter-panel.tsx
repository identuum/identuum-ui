/**
 * AuditFilterPanel — URL-backed GET form for audit log filters.
 *
 * Server component. Submits as GET so all filters become URL query params.
 * No client-side filtering; backend is authoritative for scoping.
 *
 * Sort order is controlled by the table Time header, not this form.
 * Time range: preset window (24h/7d/30d) takes priority over custom dates.
 * Page resets to 1 on every filter submission.
 */

import {
  AUDIT_EVENT_TYPE_GROUPS,
  humanizeEventType,
  KNOWN_AUDIT_EVENT_TYPES,
} from "@/lib/audit-event-types";
import type { AuditEventTypeGroupFromAPI } from "@/lib/idp-admin-client";

export interface AuditFilterValues {
  eventType: string | null;
  subjectType: string | null;
  /** Preset window: "24h" | "7d" | "30d" | null */
  window: string | null;
  /** YYYY-MM-DD — used when window is null */
  startDate: string | null;
  endDate: string | null;
  sortOrder: "asc" | "desc";
}

interface AuditFilterPanelProps {
  basePath: string;
  filters: AuditFilterValues;
  /**
   * Event type groups from the backend endpoint. Falls back to the static
   * compile-time list when null (endpoint unavailable or feature not licensed).
   */
  eventTypeGroups?: AuditEventTypeGroupFromAPI[] | null;
  /**
   * Subject UUID filter that arrived via a per-row "View in audit" or
   * "View all →" link. The panel preserves it across filter-form
   * submissions via a hidden input so the operator's filter changes
   * do not silently broaden the visible event set. Omit (or pass
   * null) on surfaces that do not use subject_id (the field is
   * out-of-band from the other filter form controls — the operator
   * cannot type a UUID into the panel UI).
   */
  subjectId?: string | null;
}

const SUBJECT_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "user", label: "User" },
  { value: "organization", label: "Organization" },
  { value: "auth", label: "Auth / token" },
];

const WINDOW_OPTIONS = [
  { value: "", label: "All time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
];

/** True when any non-sort filter is active */
export function hasActiveFilters(f: AuditFilterValues): boolean {
  return !!(f.eventType || f.subjectType || f.window || f.startDate || f.endDate);
}

function windowSelectValue(f: AuditFilterValues): string {
  if (f.window === "24h" || f.window === "7d" || f.window === "30d") return f.window;
  if (f.startDate || f.endDate) return "custom";
  return "";
}

export function AuditFilterPanel({
  basePath,
  filters,
  eventTypeGroups,
  subjectId,
}: AuditFilterPanelProps) {
  const activeFilters = hasActiveFilters(filters);
  const windowVal = windowSelectValue(filters);
  const isCustom = windowVal === "custom";

  // Resolve which groups to render: backend-provided → static fallback
  const resolvedGroups: Array<{ label: string; types: Array<{ value: string; label: string }> }> =
    eventTypeGroups && eventTypeGroups.length > 0
      ? eventTypeGroups
      : AUDIT_EVENT_TYPE_GROUPS.map((g) => ({
          label: g.label,
          types: g.types.map((t) => ({ value: t, label: humanizeEventType(t) })),
        }));

  const knownValues: ReadonlySet<string> =
    eventTypeGroups && eventTypeGroups.length > 0
      ? new Set(eventTypeGroups.flatMap((g) => g.types.map((t) => t.value)))
      : KNOWN_AUDIT_EVENT_TYPES;

  // If the current eventType is set but not in the known list, show it as a custom option.
  const customEventType =
    filters.eventType !== null && filters.eventType !== "" && !knownValues.has(filters.eventType)
      ? filters.eventType
      : null;

  return (
    <details
      open={activeFilters}
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <summary className="px-5 py-3.5 text-xs font-semibold text-sky-950 cursor-pointer select-none flex items-center justify-between gap-2 hover:bg-stone-50 transition-colors list-none">
        <span>Filters{activeFilters && <span className="ml-1 text-sky-600">· active</span>}</span>
        <svg
          className="h-3.5 w-3.5 text-stone-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </summary>

      <form
        method="GET"
        action={basePath}
        className="px-5 pb-5 pt-3 border-t border-stone-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3"
      >
        {/* Reset page to 1 on filter change. Sort order preserved via separate URL mechanism. */}
        <input type="hidden" name="page" value="1" />
        {/* Preserve subject_id across filter-form submissions so a
            "View in audit" link doesn't silently broaden when the
            operator changes another filter. Out-of-band from the
            visible controls — operator cannot type a UUID here. */}
        {subjectId ? <input type="hidden" name="subject_id" value={subjectId} /> : null}

        {/* Event type — grouped select from known backend constants */}
        <div className="space-y-1 sm:col-span-2 lg:col-span-1">
          <label htmlFor="af-event-type" className="block text-xs font-semibold text-stone-600">
            Event type
          </label>
          <select
            id="af-event-type"
            name="event_type"
            defaultValue={filters.eventType ?? ""}
            className={inputCls}
          >
            <option value="">All events</option>
            {/* If the current value is an unknown/custom type, surface it at the top */}
            {customEventType !== null && <option value={customEventType}>{customEventType}</option>}
            {resolvedGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Subject type */}
        <div className="space-y-1">
          <label htmlFor="af-subject-type" className="block text-xs font-semibold text-stone-600">
            Subject type
          </label>
          <select
            id="af-subject-type"
            name="subject_type"
            defaultValue={filters.subjectType ?? ""}
            className={inputCls}
          >
            {SUBJECT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Time window preset */}
        <div className="space-y-1">
          <label htmlFor="af-window" className="block text-xs font-semibold text-stone-600">
            Time range
          </label>
          <select id="af-window" name="window" defaultValue={windowVal} className={inputCls}>
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Custom date range */}
        <div className="space-y-1">
          <label htmlFor="af-start" className="block text-xs font-semibold text-stone-600">
            From{" "}
            {!isCustom && <span className="font-normal text-stone-400">(custom range only)</span>}
          </label>
          <input
            id="af-start"
            type="date"
            name="start_date"
            defaultValue={filters.startDate ?? ""}
            disabled={!isCustom}
            className={`${inputCls} disabled:opacity-40 disabled:cursor-not-allowed`}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="af-end" className="block text-xs font-semibold text-stone-600">
            To{" "}
            {!isCustom && <span className="font-normal text-stone-400">(custom range only)</span>}
          </label>
          <input
            id="af-end"
            type="date"
            name="end_date"
            defaultValue={filters.endDate ?? ""}
            disabled={!isCustom}
            className={`${inputCls} disabled:opacity-40 disabled:cursor-not-allowed`}
          />
        </div>

        {/* Actions */}
        <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-1">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
          >
            Apply filters
          </button>
          {activeFilters && (
            <a
              href={basePath}
              className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
            >
              Clear filters
            </a>
          )}
        </div>
      </form>
    </details>
  );
}

const inputCls =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";
