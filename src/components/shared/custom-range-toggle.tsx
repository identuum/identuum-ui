"use client";

/**
 * V2-014 (testbook): the audit filter's From/To follow its Time range select
 * while the page is open — enabled for Custom range only. The form is a
 * server-rendered GET form, so without script the inputs keep the state the
 * server rendered.
 */

import { useEffect, useRef } from "react";

type Field = { value: string; disabled: boolean };

/** Enables the date fields when the window field says "custom". */
export function applyCustomRange(window: Field | null, dates: Field[]): void {
  const custom = window?.value === "custom";
  for (const d of dates) d.disabled = !custom;
}

export function CustomRangeToggle() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const field = (name: string) =>
      form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    const window = field("window");
    const dates = [field("start_date"), field("end_date")].filter(
      (f): f is HTMLInputElement | HTMLSelectElement => f !== null
    );
    const sync = () => applyCustomRange(window, dates);
    sync();
    window?.addEventListener("change", sync);
    return () => window?.removeEventListener("change", sync);
  }, []);
  return <span ref={ref} hidden />;
}
