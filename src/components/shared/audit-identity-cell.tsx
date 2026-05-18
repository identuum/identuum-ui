"use client";

/**
 * AuditIdentityCell — renders an audit actor/target value with pseudonymous HMAC
 * handling.
 *
 * Behaviour:
 *   - Plain email or type string → displayed directly (truncated).
 *   - HMAC-like value (startsWith "hmac:") → shows a compact "~<8-char prefix>" button.
 *     Clicking expands an inline disclosure with a readonly full-value field and
 *     a Copy button. Keyboard: Escape closes; Copy falls back to select-all when
 *     clipboard API is unavailable.
 *
 * Security:
 *   - The full HMAC value is passed as a prop and rendered only inside the disclosure
 *     — never in default visible table text.
 *   - No secrets, tokens, metadata, or session IDs are accepted or rendered here.
 */

import { useEffect, useRef, useState } from "react";

interface AuditIdentityCellProps {
  /** Primary value — actor_email or subject_email. May be a plain email or hmac: value. */
  value: string | null;
  /** Fallback displayed when value is absent (actor_type / subject_type). Never HMAC. */
  fallback: string | null;
}

function isHmac(s: string): boolean {
  return s.startsWith("hmac:");
}

function shortHmac(s: string): string {
  const raw = s.slice(5); // strip "hmac:" prefix
  return raw.length > 0 ? raw.slice(0, 8) : "anon";
}

export function AuditIdentityCell({ value, fallback }: AuditIdentityCellProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!value) {
    if (fallback) {
      return <span className="text-xs text-stone-400">{fallback}</span>;
    }
    return <span className="text-xs text-stone-300">—</span>;
  }

  if (!isHmac(value)) {
    return (
      <span className="text-xs text-stone-600 block truncate max-w-[140px]">{value}</span>
    );
  }

  const short = shortHmac(value);

  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      },
      () => {
        inputRef.current?.select();
      }
    );
  }

  return (
    <div ref={containerRef} className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Pseudonymous identifier starting with ${short} — click to reveal`}
        className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-sky-700 font-mono rounded px-1 py-0.5 hover:bg-sky-50 transition-colors"
      >
        <span className="text-stone-300">~</span>
        {short}
        <svg
          className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`}
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
      </button>

      {open && (
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={value}
            aria-label="Full pseudonymous identifier"
            className="w-36 rounded border border-stone-200 bg-stone-50 px-1.5 py-1 text-[10px] font-mono text-sky-950 shadow-inner focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
          <button
            type="button"
            onClick={handleCopy}
            className={[
              "shrink-0 rounded px-1.5 py-1 text-[10px] font-semibold transition-colors",
              copied
                ? "bg-emerald-600 text-white"
                : "bg-sky-600 text-white hover:bg-sky-700",
            ].join(" ")}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
