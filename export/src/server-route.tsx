/**
 * Renders a shared Next "server" tree in the browser.
 *
 * The org-admin layout and pages are async functions that return JSX; the
 * data they await goes through the platform adapters (see
 * platform-plugin.mts). `build` awaits the layout first — so its guard runs
 * before any page data is requested, as in Next — then the page, and
 * returns the composed element. A revalidation (a server action's
 * revalidatePath) re-runs `build` and swaps the tree in place, keeping client
 * component state the way router.refresh() does.
 *
 * redirect() inside the tree has already navigated when it throws, so an
 * ExportRedirect renders nothing. Any other failure renders an alert; it is
 * never shown as a successful empty page.
 */
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { ExportRedirect } from "./platform/next-navigation";

type View = { key: string; node: ReactNode } | { key: string; error: true };

export function ServerRoute({
  routeKey,
  revalidation,
  build,
}: {
  routeKey: string;
  revalidation: number;
  build: () => Promise<ReactNode>;
}) {
  const [view, setView] = useState<View | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tree re-builds on a new route or a revalidation, never on a new closure identity
  useEffect(() => {
    let cancelled = false;
    buildRef.current().then(
      (node) => {
        if (!cancelled) setView({ key: routeKey, node });
      },
      (error: unknown) => {
        if (cancelled || error instanceof ExportRedirect) return;
        setView({ key: routeKey, error: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [routeKey, revalidation]);

  if (view === null || view.key !== routeKey) {
    return <p data-testid="route-loading">Loading…</p>;
  }
  if ("error" in view) return <RouteError />;
  return <ActionBoundary key={routeKey}>{view.node}</ActionBoundary>;
}

function RouteError() {
  return (
    <p role="alert" data-testid="route-error">
      This page could not be loaded. Try again.
    </p>
  );
}

/**
 * A server action that redirects throws ExportRedirect after navigating; the
 * route has already changed, so the boundary renders nothing for it. Any other
 * error thrown while rendering or from an action renders the alert.
 */
class ActionBoundary extends Component<
  { children: ReactNode },
  { failure: "redirected" | "error" | null }
> {
  state: { failure: "redirected" | "error" | null } = { failure: null };
  static getDerivedStateFromError(error: unknown) {
    return { failure: error instanceof ExportRedirect ? "redirected" : "error" };
  }
  render() {
    if (this.state.failure === "redirected") return null;
    if (this.state.failure === "error") return <RouteError />;
    return this.props.children;
  }
}
