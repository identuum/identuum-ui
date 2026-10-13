/**
 * The phone drawer's behaviour, kept apart from React and the DOM so it can
 * be tested in node (UI-0913-C). ShellFrame calls `openDrawer` when the
 * drawer opens and the returned `release` when it closes.
 *
 * While open:
 *   - the page behind does not scroll (body overflow hidden);
 *   - focus moves to the drawer's first stop and Tab / Shift+Tab stay inside;
 *   - Escape closes.
 * On close the body scroll comes back and focus returns to the Menu button,
 * except when the drawer closed because the window widened: the Menu button
 * is hidden then, and focus stays where it is in the now visible sidebar
 * (UI-0913-C-REVIEW F1).
 */

export interface Focusable {
  focus(): void;
}

export interface DrawerKey {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

export interface DrawerEnv<T extends Focusable> {
  /** The drawer's focus stops, in document order. */
  stops(): readonly T[];
  /** The element that has focus now. */
  active(): T | null;
  /** The button that opened the drawer; focus returns here. */
  menuButton(): T | null;
  body: { style: { overflow: string } };
  close(): void;
}

/**
 * Where Tab should go when it would leave the drawer, or null to let the
 * browser move focus. Focus outside the stops goes to the first (Tab) or
 * the last (Shift+Tab).
 */
export function trapTab<T>(stops: readonly T[], active: T | null, backwards: boolean): T | null {
  if (stops.length === 0) return null;
  const first = stops[0] as T;
  const last = stops[stops.length - 1] as T;
  const inside = active !== null && stops.includes(active);
  if (backwards) return !inside || active === first ? last : null;
  return !inside || active === last ? first : null;
}

/** A tap on a link inside the drawer closes it; the link then navigates. */
export function isLinkTap(target: { closest?(selector: string): unknown } | null): boolean {
  return typeof target?.closest === "function" && target.closest("a[href]") !== null;
}

export function openDrawer<T extends Focusable>(
  env: DrawerEnv<T>
): { onKey(e: DrawerKey): void; release(returnFocus?: boolean): void } {
  const previousOverflow = env.body.style.overflow;
  env.body.style.overflow = "hidden";
  env.stops()[0]?.focus();
  return {
    onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        env.close();
        return;
      }
      if (e.key !== "Tab") return;
      const target = trapTab(env.stops(), env.active(), e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    },
    release(returnFocus = true) {
      env.body.style.overflow = previousOverflow;
      if (returnFocus) env.menuButton()?.focus();
    },
  };
}
