"use client";

import { useEffect, useState } from "react";
import { formatLocalTime, type Instant, type LocalTimeStyle, utcIso } from "@/lib/local-time";

// UI-DATES (owner decision U-020): the one way the UI shows a date. The server
// render and the first client render emit the same zone-free text — the exact
// UTC ISO instant — so hydration never depends on either side's time zone;
// after mount the browser replaces it with its own zone's rendering, zone
// shown. The UTC ISO instant stays in dateTime and in the hover title.
// Empty or invalid input renders `fallback`, never "Invalid Date".

export function LocalTime({
  value,
  style = "datetime",
  fallback = "—",
  className,
}: {
  value: Instant;
  style?: LocalTimeStyle;
  fallback?: string;
  className?: string;
}) {
  const iso = utcIso(value);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(formatLocalTime(iso, style));
  }, [iso, style]);
  if (!iso) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={iso} title={iso} className={className}>
      {text ?? iso}
    </time>
  );
}
