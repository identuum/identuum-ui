"use client";

/**
 * AccountMenu — a lightweight dropdown anchored to the user email in the shell header.
 *
 * Links to /account/settings and provides logout.
 * Used in all three authenticated shells (site-admin, org-admin, dashboard).
 *
 * Accessibility:
 *   - Toggle button declares aria-expanded and aria-haspopup.
 *   - Menu items use role="menuitem" on the inner elements.
 *   - Clicking outside or pressing Escape closes the menu.
 */

import { useEffect, useRef, useState } from "react";

interface AccountMenuProps {
  email: string;
}

export function AccountMenu({ email }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape key.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 truncate max-w-xs transition-colors"
      >
        <span className="truncate">{email}</span>
        {/* chevron-down */}
        <svg
          className="h-3 w-3 shrink-0"
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
        <div
          role="menu"
          aria-label="Account options"
          className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-stone-200 bg-white shadow-lg z-50 py-1 overflow-hidden"
        >
          <a
            href="/account/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
          >
            Account settings
          </a>

          <div aria-hidden="true" className="my-1 border-t border-stone-100" />

          {/* Logout uses POST so the session cookie is sent correctly. */}
          <form method="POST" action="/api/auth/logout">
            <button
              type="submit"
              role="menuitem"
              className="w-full text-left px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
