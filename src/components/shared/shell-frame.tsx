"use client";

/**
 * ShellFrame — the one frame around every signed-in console page (UI-0913-C,
 * D5): the dark sidebar with the product mark, the area's menu and Sign out,
 * the header with the role and the account menu, and the page.
 *
 * 768 px and wider: the sidebar sits at the left, as it always has.
 * Narrower: the sidebar is hidden and the header shows a "Menu" button. The
 * button opens the SAME sidebar as a drawer from the left (280 px, at most
 * 85% of the screen) over a dimmed backdrop. The drawer closes on a link
 * tap, a backdrop tap, Escape, or its "Close menu" button; focus stays
 * inside it while open and returns to "Menu" after. The page behind does
 * not scroll while it is open. Behaviour lives in ./shell-drawer.ts.
 *
 * Props (keep this API small; the four role layouts are its only callers):
 *   area       second line of the product mark: "Member", "Organization", …
 *   roleLabel  the small role tag at the left of the header
 *   email      the signed-in address; the account menu shows when present
 *   nav        the area's menu (a client component); rendered once
 *   navFooter  optional links between the menu and Sign out
 *   notice     optional strip between the header and the page. Pass an
 *              already-rendered node (e.g. `await PlatformLicenseWarnings()`),
 *              never an async component element: the static export resolves
 *              async components in `children` only (export/src/area-routes.tsx).
 *   children   the page
 *
 * The sidebar and the drawer are one <aside> with the id "shell-menu", so
 * the menu exists once in the page for every width.
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/shared/account-menu";
import { isLinkTap, openDrawer } from "@/components/shared/shell-drawer";

export const SHELL_MENU_ID = "shell-menu";

const STOPS =
  "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";

interface ShellFrameProps {
  area: string;
  roleLabel: string;
  email: string | null;
  nav: ReactNode;
  navFooter?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}

export function ShellFrame({
  area,
  roleLabel,
  email,
  nav,
  navFooter,
  notice,
  children,
}: ShellFrameProps) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const drawer = openDrawer<HTMLElement>({
      stops: () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(STOPS) ?? []),
      active: () => document.activeElement as HTMLElement | null,
      menuButton: () => menuButtonRef.current,
      body: document.body,
      close: () => setOpen(false),
    });
    // Widening past the breakpoint shows the sidebar: the drawer is done.
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener("keydown", drawer.onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", drawer.onKey);
      wide.removeEventListener("change", onWide);
      drawer.release();
    };
  }, [open]);

  return (
    <div className="flex min-h-screen bg-stone-50">
      {open && (
        // The keyboard closes the drawer with Escape or "Close menu"; this
        // backdrop is the pointer's way out and is hidden from assistive tech.
        <div
          aria-hidden="true"
          data-testid="shell-backdrop"
          className="fixed inset-0 z-40 bg-sky-950/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is set only together with role="dialog" */}
      <aside
        id={SHELL_MENU_ID}
        ref={drawerRef}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "Menu" : undefined}
        onClickCapture={(e) => {
          if (open && isLinkTap(e.target as Element)) setOpen(false);
        }}
        className={`shrink-0 flex-col bg-sky-950 border-r border-sky-900/60 ${
          open
            ? "fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85%] overflow-y-auto md:static md:z-auto md:w-60 md:max-w-none md:overflow-visible"
            : "hidden w-60 md:flex"
        }`}
      >
        {/* Product name */}
        <div className="px-5 py-5 border-b border-sky-900/60 flex items-center gap-2.5">
          <div className="h-7 w-7 bg-sky-600 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
            <span className="font-black text-white text-[11px] tracking-tight leading-none">
              Id
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">Identuum</p>
            <p className="text-sm font-semibold text-white leading-tight">{area}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="md:hidden ml-auto inline-flex h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-sm text-sky-300 hover:bg-sky-900/60 hover:text-white transition-colors"
          >
            {/* x-mark */}
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
            Close menu
          </button>
        </div>

        {nav}

        {navFooter}

        {/* Logout: POST to the UI-side logout handler which proxies to IdP
            and redirects to /login, so the browser receives a redirect. */}
        <div className="px-3 py-4 border-t border-sky-900/60">
          <form method="POST" action="/api/auth/logout">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sky-300 hover:bg-sky-900/60 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — light glass strip above content */}
        <header className="h-12 flex items-center justify-between gap-3 px-4 md:px-6 border-b border-stone-200 bg-white/90 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls={SHELL_MENU_ID}
              className="md:hidden -ml-2 inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-sky-950 hover:bg-stone-100 transition-colors"
            >
              {/* bars-3 */}
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
              Menu
            </button>
            <span className="text-xs text-stone-400 font-mono">{roleLabel}</span>
          </div>
          {email && <AccountMenu email={email} />}
        </header>
        {notice}
        <main className="flex-1 overflow-auto bg-stone-50 px-4 py-4 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
