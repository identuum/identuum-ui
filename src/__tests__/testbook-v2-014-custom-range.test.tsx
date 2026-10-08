/**
 * V2-014 (testbook): with "Custom range" chosen in the audit filter, both date
 * inputs stayed disabled, so a custom range could not be entered. The inputs
 * follow the Time range select: enabled for Custom range only, and a range
 * applied as custom keeps them enabled.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditFilterPanel, type AuditFilterValues } from "../components/shared/audit-filter-panel";
import { applyCustomRange } from "../components/shared/custom-range-toggle";

const none: AuditFilterValues = {
  eventType: null,
  subjectType: null,
  window: null,
  startDate: null,
  endDate: null,
  sortOrder: "desc",
};

// The disabled ATTRIBUTE; the class list also names Tailwind's disabled: variants.
const DISABLED = /\sdisabled(=""|\s|>)/;

function dateInputs(html: string): string[] {
  return html.match(/<input[^>]*type="date"[^>]*>/g) ?? [];
}

describe("the custom date range of the audit filter", () => {
  it("follows the Time range select: enabled for Custom range only", () => {
    const select = { value: "custom", disabled: false };
    const dates = [
      { value: "", disabled: true },
      { value: "", disabled: true },
    ];
    applyCustomRange(select, dates);
    expect(dates.map((d) => d.disabled)).toEqual([false, false]);
    for (const preset of ["", "24h", "7d", "30d"]) {
      select.value = preset;
      applyCustomRange(select, dates);
      expect(dates.map((d) => d.disabled)).toEqual([true, true]);
    }
  });

  it("keeps both inputs enabled after Custom range is applied without dates", () => {
    const html = renderToStaticMarkup(
      <AuditFilterPanel basePath="/site-admin/audit" filters={{ ...none, window: "custom" }} />
    );
    const inputs = dateInputs(html);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input).not.toMatch(DISABLED);
    expect(html).toMatch(/<option value="custom" selected/);
  });

  it("renders the dates disabled for a preset window, as before", () => {
    const html = renderToStaticMarkup(
      <AuditFilterPanel basePath="/site-admin/audit" filters={{ ...none, window: "7d" }} />
    );
    for (const input of dateInputs(html)) expect(input).toMatch(DISABLED);
  });
});
