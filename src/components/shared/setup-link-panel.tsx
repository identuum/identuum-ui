"use client";

/**
 * SetupLinkPanel — displays a one-time invitation setup link with a copy button.
 *
 * Used for:
 *   - Approve-registration setup link (editions that issue one; not OSS)
 *   - One-time API-resource secret display
 *
 * Security:
 *   - The link is rendered in a readonly field only; never logged or put in URLs.
 *   - Clipboard fallback selects the input text so the operator can copy manually.
 *   - No link value is stored beyond the component's in-memory state.
 */

import { useRef, useState } from "react";

interface SetupLinkPanelProps {
  link: string;
  /** Short header shown above the link field. */
  title: string;
  /** Optional description shown below the header. */
  description?: string;
  /** Compact variant for inline row use; default is full-size panel. */
  compact?: boolean;
}

export function SetupLinkPanel({ link, title, description, compact = false }: SetupLinkPanelProps) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleCopy() {
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      },
      () => {
        // Clipboard permission denied or unavailable — select the text so the
        // operator can copy manually with Ctrl+C / Cmd+C.
        inputRef.current?.select();
      }
    );
  }

  if (compact) {
    return (
      <div className="space-y-1.5 min-w-[260px]">
        <p className="text-[10px] font-semibold text-amber-700">{title}</p>
        {description && <p className="text-[10px] text-stone-400 leading-tight">{description}</p>}
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            aria-label="Setup link"
            className="flex-1 min-w-0 rounded border border-stone-200 bg-white px-2 py-1 text-[10px] font-mono text-sky-950 shadow-inner focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Link copied" : "Copy setup link"}
            className="shrink-0 rounded bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-700 transition-colors"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        <p className="text-[10px] text-stone-400 leading-tight">
          Shown only after generation. Regenerate if you lose it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-stone-700">{title}</p>
        {description && (
          <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          readOnly
          value={link}
          aria-label="Setup link"
          className="flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-sky-950 font-mono shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        />
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Link copied" : "Copy setup link"}
          className={[
            "shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
            copied ? "bg-emerald-600 text-white" : "bg-sky-600 text-white hover:bg-sky-700",
          ].join(" ")}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
      <p className="text-xs text-stone-400 leading-relaxed">
        Shown only after generation. Regenerate the link if you lose it.
      </p>
    </div>
  );
}
