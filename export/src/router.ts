/**
 * The export's History API router: one current location, one listener set,
 * and a revalidation counter that server-component routes re-load on.
 *
 * The binary answers every shell path with index.html; this module decides
 * which view the path means. It is imported by the platform adapters
 * (next/navigation, next/cache) and by main.tsx, so none of them import
 * each other.
 */
import { useEffect, useState } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
let revalidation = 0;
let generation = 0;

function notify(): void {
  generation += 1;
  for (const l of listeners) l();
}

/**
 * Changes on every navigation, history step and revalidation: the export's
 * equivalent of "one server request", used to share a per-request result
 * (session validation, runtime discovery) between a layout and its page.
 */
export function routeGeneration(): number {
  return generation;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    generation += 1;
  });
}

export function currentLocation(): string {
  return window.location.pathname + window.location.search;
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  notify();
}

/** Marks every loaded route stale; mounted routes re-load in place. */
export function revalidate(): void {
  revalidation += 1;
  notify();
}

export function useLocation(): { path: string; revalidation: number } {
  const [state, setState] = useState(() => ({ path: currentLocation(), revalidation }));
  useEffect(() => {
    const update = () => setState({ path: currentLocation(), revalidation });
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return state;
}
