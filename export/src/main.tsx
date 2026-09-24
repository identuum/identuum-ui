// The shared pages are styled by the app's own stylesheet (Tailwind through
// the repository's PostCSS config), the same one the Next root layout loads.
import "@/app/globals.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadEdition } from "./edition";
import { signOutDestination } from "./logout";
import { nextProxyFetch } from "./next-proxy";
import { navigate, useLocation } from "./router";
import { ServerRoute } from "./server-route";
import { buildServerRoute, isServerRoute } from "./server-routes";
import { discoverPlatform } from "./session";

/**
 * THE-UI-THAT-GO-CAN-SERVE (Plan B): the representative set, as a static
 * export the OSS binary serves. Routing is the History API — the binary
 * answers every shell path with index.html and the script resolves the path —
 * and every data call goes through the boundary in ./bff.ts.
 *
 * Since PLAN-D-4 every page is the Next app's own module, rendered through
 * the shared route tables (server-routes.ts). What stays here, by file:
 *   - the boot ladder (src/app/page.tsx:10-50)                → <Root/>
 *   - logout with the local-only outcome (api/auth/logout)     → signOut()
 *   - in-place navigation for same-origin shell links          → interceptDocument()
 * What is NOT here: every AG surface (the standalone deployment's).
 */

// ----------------------------------------------------------------- router

export { navigate };

/**
 * The shared Next pages use plain anchors and the Next-only sign-out route.
 * In the export a same-origin link to a shell path navigates in place (no
 * document load), and a sign-out form posted to /api/auth/logout signs out
 * through the Go boundary's logout instead. API, boundary and system paths
 * are left to the browser.
 */
const NOT_SHELL = ["/api/", "/bff", "/.well-known/", "/system/", "/health", "/livez", "/metrics"];
const NEXT_SIGN_OUT = "/api/auth/logout";

function isShellPath(pathname: string): boolean {
  return !NOT_SHELL.some((p) => pathname === p || pathname.startsWith(p));
}

function interceptDocument(): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const anchor = (e.target as Element | null)?.closest?.("a");
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const href = anchor.getAttribute("href");
    if (href === null) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || !isShellPath(url.pathname)) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  };
  const onSubmit = (e: SubmitEvent) => {
    const form = e.target as HTMLFormElement | null;
    if (!form || e.defaultPrevented || form.method.toLowerCase() !== "post") return;
    if (new URL(form.action, window.location.href).pathname !== NEXT_SIGN_OUT) return;
    e.preventDefault();
    void signOut();
  };
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  return () => {
    document.removeEventListener("click", onClick);
    document.removeEventListener("submit", onSubmit);
  };
}

function Link({
  to,
  children,
  testid,
}: {
  to: string;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <a
      href={to}
      data-testid={testid}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ------------------------------------------------------------------- root

function Root() {
  const [detail, setDetail] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    discoverPlatform().then((state) => {
      if (cancelled) return;
      if (state.mode === "unavailable") {
        setDetail(state.detail);
        // The shared outage destination (src/app/unavailable): the HTTP
        // status the discovery saw, when it saw one.
        const status = state.detail.match(/_(\d{3})$/)?.[1];
        navigate(status ? `/unavailable?status=${status}` : "/unavailable");
      } else if (state.mode === "setup_required") {
        navigate("/setup");
      } else {
        navigate("/login");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return <p data-testid="root-probing">Checking the identity provider… {detail}</p>;
}

// ---------------------------------------------------------------- sign-out

/** The Next sign-out form, mapped to the boundary's logout (logout.ts). */
async function signOut(): Promise<void> {
  navigate(await signOutDestination());
}

// -------------------------------------------------------------------- app

function App() {
  const { path: full, revalidation } = useLocation();
  const [pathname = "/", search] = full.split("?");
  const query = new URLSearchParams(search ?? "");
  useEffect(interceptDocument, []);

  if (pathname === "/") return <Root />;
  if (isServerRoute(pathname)) {
    return (
      <ServerRoute
        routeKey={full}
        revalidation={revalidation}
        build={() => buildServerRoute(pathname, query)}
      />
    );
  }
  return (
    <section data-testid="not-found">
      <h1>Page not found</h1>
      <Link to="/">Home</Link>
    </section>
  );
}

// The shared browser clients call the Next IdP proxy path; answer it here
// (next-proxy.ts), before anything renders. The edition is read once, now;
// only a CE-only route waits for it (edition.ts).
const originalFetch = window.fetch.bind(window);
window.fetch = nextProxyFetch(originalFetch, loadEdition(originalFetch));

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
