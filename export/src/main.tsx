// The shared pages are styled by the app's own stylesheet (Tailwind through
// the repository's PostCSS config), the same one the Next root layout loads.
import "@/app/globals.css";
import { type FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { roleToPath } from "@/lib/role-routing";
import { bff, readJson } from "./bff";
import { signOutDestination } from "./logout";
import { nextProxyFetch } from "./next-proxy";
import { navigate, useLocation } from "./router";
import { ServerRoute } from "./server-route";
import { buildServerRoute, isServerRoute } from "./server-routes";
import { discoverPlatform } from "./session";

// Page operations have a bounded transport failure outcome. Session validation
// retains its separate shared retry engine and never uses this adapter.
async function pageRequest(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await bff(path, { ...init, signal: init.signal ?? AbortSignal.timeout(5000) });
  } catch {
    return new Response(null, { status: 503 });
  }
}

const UNAVAILABLE_MESSAGE = "The identity provider is unavailable. Try again.";

/**
 * THE-UI-THAT-GO-CAN-SERVE (Plan B): the representative set, as a static
 * export the OSS binary serves. Routing is the History API — the binary
 * answers every shell path with index.html and the script resolves the path —
 * and every data call goes through the boundary in ./bff.ts.
 *
 * What is deliberately reproduced from the Next app, by file:
 *   - the boot ladder (src/app/page.tsx:10-50)                → <Root/>
 *   - the layout guards' three arms (src/lib/session-guard.ts) → <Guard/>
 *   - the login branches (src/lib/idp-client.ts:86-143)        → <Login/>
 *   - one dynamic-ID page (src/app/org-admin/users/[id])       → <UserDetail/>
 *   - one protected mutation (account/settings/mfa-actions.ts) → <AccountSettings/>
 *   - logout with the local-only outcome (api/auth/logout)     → signOut()
 * What is NOT here: every AG surface (the standalone deployment's), the
 * wizard's completion step, and every admin page outside the set.
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
        navigate(`/platform-status?detail=${encodeURIComponent(state.detail)}`);
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

function PlatformStatus({ query }: { query: URLSearchParams }) {
  return (
    <section data-testid="platform-status">
      <h1>Identity provider unavailable</h1>
      <p data-testid="platform-status-detail">{query.get("detail") ?? "unreachable"}</p>
      <p>
        <Link to="/" testid="platform-status-retry">
          Retry
        </Link>
      </p>
    </section>
  );
}

function SetupRequired() {
  return (
    <section data-testid="setup-required">
      <h1>Setup required</h1>
      <p>
        This identity provider has not completed setup. The wizard runs from the setup code an
        operator holds.
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ login

type LoginStep =
  | { step: "password" }
  | { step: "mfa"; sessionId: string }
  | { step: "enroll"; sessionId: string };

/**
 * First-login TOTP enrolment (src/components/auth/mfa-enroll-form.tsx): one
 * initiate per pending session, then the code proves the authenticator holds
 * the secret and completeMFALogin mints the cookies. The secret is shown once,
 * to the user it belongs to, exactly as the Next form shows its QR code.
 */
function EnrollForm({ sessionId }: { sessionId: string }) {
  const [secret, setSecret] = useState<string>("");
  const [error, setError] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    pageRequest("/api/v1/auth/login/mfa/enroll/initiate", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    }).then(async (res) => {
      if (cancelled) return;
      const body = await readJson(res);
      if (res.ok && typeof body?.secret === "string") setSecret(body.secret);
      else
        setError(
          res.status >= 500 || res.status === 429
            ? UNAVAILABLE_MESSAGE
            : "Enrolment could not be started. Sign in again."
        );
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  async function complete(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const res = await pageRequest("/api/v1/auth/login/mfa/enroll/complete", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, code: String(form.get("code") ?? "") }),
    });
    const body = await readJson(res);
    if (res.ok) {
      navigate(roleToPath(body?.role as string | undefined));
      return;
    }
    setError(
      res.status >= 500 || res.status === 429
        ? UNAVAILABLE_MESSAGE
        : "Invalid verification code. Try again."
    );
  }
  return (
    <div data-testid="mfa-enroll-required">
      <p>Two-factor authentication must be set up before you can sign in.</p>
      {secret && (
        <p>
          Authenticator secret: <code data-testid="mfa-secret">{secret}</code>
        </p>
      )}
      <form onSubmit={complete} data-testid="mfa-enroll-form">
        <label>
          Authenticator code{" "}
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </label>
        <button type="submit">Finish setup</button>
      </form>
      {error && (
        <p role="alert" data-testid="login-error">
          {error}
        </p>
      )}
    </div>
  );
}

function Login({ query }: { query: URLSearchParams }) {
  const [state, setState] = useState<LoginStep>({ step: "password" });
  const [error, setError] = useState<string>("");
  const reason = query.get("reason");

  async function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const res = await pageRequest("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        remember_me: false,
      }),
    });
    const body = await readJson(res);
    if (body?.mfa_required === true && body?.mfa_enrollment_required === true) {
      setState({ step: "enroll", sessionId: String(body?.session_id ?? "") });
      return;
    }
    if (body?.mfa_required === true && typeof body?.session_id === "string") {
      setState({ step: "mfa", sessionId: body.session_id });
      return;
    }
    if (body?.error === "mfa_enrollment_required") {
      setState({ step: "enroll", sessionId: String(body?.session_id ?? "") });
      return;
    }
    if (res.ok) {
      navigate(roleToPath(body?.role as string | undefined));
      return;
    }
    if (res.status === 401) {
      setError("Invalid credentials.");
      return;
    }
    if (res.status >= 500 || res.status === 429) {
      setError(UNAVAILABLE_MESSAGE);
      return;
    }
    setError("Login failed. Try again.");
  }

  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.step !== "mfa") return;
    setError("");
    const form = new FormData(e.currentTarget);
    const res = await pageRequest("/api/v1/auth/login/mfa", {
      method: "POST",
      body: JSON.stringify({ session_id: state.sessionId, code: String(form.get("code") ?? "") }),
    });
    const body = await readJson(res);
    if (res.ok) {
      navigate(roleToPath(body?.role as string | undefined));
      return;
    }
    if (res.status >= 500 || res.status === 429) {
      setError(UNAVAILABLE_MESSAGE);
      return;
    }
    const message = String(body?.error ?? "");
    if (message.includes("session")) {
      navigate("/login?reason=session_expired");
      return;
    }
    setError("Invalid verification code. Try again.");
  }

  return (
    <section data-testid="login">
      <h1>Sign in</h1>
      {reason === "sign_out_unconfirmed" && (
        <p role="alert" data-testid="login-reason">
          Sign-out could not be confirmed. Your session may still be active.
          <button type="button" onClick={() => void signOut()}>
            Retry sign-out
          </button>
        </p>
      )}
      {reason === "signed_out_locally" && (
        <p role="status" data-testid="login-reason">
          You were signed out on this device only: the identity provider could not be reached to end
          the session.
        </p>
      )}
      {reason === "signed_out" && (
        <p role="status" data-testid="login-reason">
          You have been signed out.
        </p>
      )}
      {reason === "session_expired" && (
        <p role="status" data-testid="login-reason">
          Your session has expired. Sign in again.
        </p>
      )}
      {state.step === "password" && (
        <form onSubmit={submitPassword} data-testid="password-form">
          <label>
            Email <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password{" "}
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Continue</button>
        </form>
      )}
      {state.step === "mfa" && (
        <form onSubmit={submitCode} data-testid="mfa-form">
          <label>
            Authenticator code{" "}
            <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
          </label>
          <button type="submit">Verify</button>
        </form>
      )}
      {state.step === "enroll" && <EnrollForm sessionId={state.sessionId} />}
      {error && (
        <p role="alert" data-testid="login-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- sign-out

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
  if (pathname === "/login") return <Login query={query} />;
  if (pathname === "/setup") return <SetupRequired />;
  if (pathname === "/platform-status") return <PlatformStatus query={query} />;
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
// (next-proxy.ts), before anything renders.
window.fetch = nextProxyFetch(window.fetch.bind(window));

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
