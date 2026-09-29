"use client";

/**
 * OSS-FIN-1 (U-020): the audit filter's From/To are the viewer's local days.
 * At submit, before the GET form is serialized, this fills start_utc/end_utc
 * with the UTC instants of local 00:00 on From and the end of To; the server
 * prefers them (utc-wire auditDateRange) and reads the plain day as UTC when
 * they are absent.
 */

import { useEffect, useRef } from "react";
import { localDayEndUtc, localDayStartUtc } from "@/lib/utc-wire";

export function LocalDayBounds() {
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = startRef.current?.form;
    if (!form) return;
    const sync = () => {
      const day = (name: string) =>
        (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
      if (startRef.current) startRef.current.value = localDayStartUtc(day("start_date")) ?? "";
      if (endRef.current) endRef.current.value = localDayEndUtc(day("end_date")) ?? "";
    };
    form.addEventListener("submit", sync);
    return () => form.removeEventListener("submit", sync);
  }, []);
  return (
    <>
      <input ref={startRef} type="hidden" name="start_utc" defaultValue="" />
      <input ref={endRef} type="hidden" name="end_utc" defaultValue="" />
    </>
  );
}
