/**
 * next/navigation for the static export. The shared org-admin pages,
 * layouts, server actions and client components import these names; here
 * they drive the export's History API router instead of the Next runtime.
 *
 * redirect()/notFound() keep their contract — they never return: redirect
 * navigates first and then throws ExportRedirect, which the export's route
 * boundary recognises as "already handled".
 */
import { currentLocation, navigate, revalidate, useLocation } from "../router";

export class ExportRedirect extends Error {
  constructor(public readonly to: string) {
    super(`redirect ${to}`);
    this.name = "ExportRedirect";
  }
}

export class ExportNotFound extends Error {
  constructor() {
    super("not found");
    this.name = "ExportNotFound";
  }
}

export function redirect(to: string): never {
  navigate(to, { replace: true });
  throw new ExportRedirect(to);
}

export function permanentRedirect(to: string): never {
  return redirect(to);
}

export function notFound(): never {
  throw new ExportNotFound();
}

export function usePathname(): string {
  return useLocation().path.split("?")[0] ?? "/";
}

export function useSearchParams(): URLSearchParams {
  const search = useLocation().path.split("?")[1] ?? "";
  return new URLSearchParams(search);
}

export function useRouter() {
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    refresh: () => revalidate(),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    prefetch: () => undefined,
  };
}

export { currentLocation };
