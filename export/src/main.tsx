import { type FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { UserUnavailable } from "@/components/shared/user-unavailable";
import { roleToPath } from "@/lib/role-routing";
import { bff, readJson } from "./bff";
import { signOutDestination } from "./logout";
import { discoverPlatform, type SessionState, validateSession } from "./session";

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

type Listener = () => void;
const listeners = new Set<Listener>();

export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  for (const l of listeners) l();
}

function usePath(): string {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const update = () => setPath(window.location.pathname + window.location.search);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
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

// ------------------------------------------------------------------ guard

function Unavailable({ state }: { state: Extract<SessionState, { kind: "unavailable" }> }) {
  return (
    <section data-testid="unavailable">
      <h1>Service unavailable</h1>
      <p>
        The identity provider could not confirm your session. Your session was not ended; try again.
      </p>
      <dl>
        <dt>Status</dt>
        <dd data-testid="unavailable-status">{state.status ?? "network"}</dd>
        <dt>Correlation id</dt>
        <dd data-testid="unavailable-cid">{state.correlationId ?? "—"}</dd>
        <dt>Attempts</dt>
        <dd data-testid="unavailable-attempts">{state.attempts}</dd>
      </dl>
      <p>
        <button
          type="button"
          data-testid="unavailable-retry"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </p>
    </section>
  );
}

/**
 * The layout guard's three arms (src/lib/session-guard.ts:23-32): authenticated
 * renders; unauthenticated (an answer below 500) leaves for /login;
 * unavailable renders IN PLACE and touches no cookie. Nothing privileged is
 * rendered before the verdict.
 */
function Guard({
  render,
  pathname,
}: {
  render: (session: Extract<SessionState, { kind: "authenticated" }>) => React.ReactNode;
  pathname: string;
}) {
  // The App keys each Guard by the full path, so a navigation remounts it
  // and re-validates; nothing from the previous page survives the remount.
  const [session, setSession] = useState<SessionState | null>(null);
  useEffect(() => {
    let cancelled = false;
    validateSession().then((s) => {
      if (cancelled) return;
      if (s.kind === "unauthenticated") {
        navigate("/login?reason=session_expired");
        return;
      }
      if (s.kind === "authenticated") {
        const requiredRole = pathname.startsWith("/org-admin")
          ? "org_admin"
          : pathname.startsWith("/site-admin")
            ? "site_admin"
            : pathname.startsWith("/dashboard")
              ? "org_user"
              : null;
        if (requiredRole && s.role !== requiredRole) {
          navigate(roleToPath(s.role));
          return;
        }
        if (requiredRole === "org_admin" && s.user.mfa_enabled === false) {
          navigate("/account/settings?reason=mfa_required");
          return;
        }
      }
      setSession(s);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  if (session === null) return <p data-testid="guard-validating">Checking your session…</p>;
  if (session.kind === "unavailable") return <Unavailable state={session} />;
  if (session.kind === "unauthenticated") return null;
  return <>{render(session)}</>;
}

async function signOut(): Promise<void> {
  navigate(await signOutDestination());
}

function Shell({
  session,
  children,
}: {
  session: Extract<SessionState, { kind: "authenticated" }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <header>
        <span data-testid="who">{session.user.email}</span>{" "}
        <span data-testid="role">{session.role}</span>{" "}
        <nav>
          <Link to={roleToPath(session.role)} testid="nav-home">
            Home
          </Link>{" "}
          <Link to="/account/settings" testid="nav-account">
            Account
          </Link>{" "}
          <button type="button" data-testid="sign-out" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

// ------------------------------------------------------------------- pages

interface UserRow {
  id: string;
  email: string;
  role?: string;
}

function readUsers(body: Record<string, unknown> | null): UserRow[] {
  const raw = Array.isArray(body)
    ? body
    : Array.isArray(body?.users)
      ? body.users
      : Array.isArray(body?.items)
        ? body.items
        : [];
  return (raw as Array<Record<string, unknown>>)
    .filter((u) => typeof u.id === "string" && typeof u.email === "string")
    .map((u) => ({
      id: String(u.id),
      email: String(u.email),
      role: typeof u.role === "string" ? u.role : undefined,
    }));
}

function Home({ session }: { session: Extract<SessionState, { kind: "authenticated" }> }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    pageRequest("/api/v1/users").then(async (res) => {
      if (cancelled) return;
      setStatus(res.status);
      if (!res.ok) setUnavailable(true);
      else setUsers(readUsers(await readJson(res)));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Shell session={session}>
      <h1 data-testid="home">Home</h1>
      {unavailable ? (
        <p role="alert" data-testid="users-unavailable">
          The user list could not be loaded. Try again.
        </p>
      ) : users === null ? (
        <p>Loading users…</p>
      ) : (
        <ul data-testid="user-list" data-status={status ?? ""}>
          {users.map((u) => (
            <li key={u.id}>
              {session.role === "org_admin" ? (
                <Link to={`/org-admin/users/${u.id}`} testid={`user-link-${u.id}`}>
                  {u.email}
                </Link>
              ) : (
                u.email
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NotFoundPanel() {
  // Preserved as today: the panel, at HTTP 200 (Plan A correction, 5b-2).
  return <p data-testid="user-not-found">This user could not be found.</p>;
}

function UserDetail({
  session,
  id,
}: {
  session: Extract<SessionState, { kind: "authenticated" }>;
  id: string;
}) {
  const [user, setUser] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [status, setStatus] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // A route change clears the previous record before the new one is fetched:
    // no stale user is ever shown under a different id.
    setUser(undefined);
    setStatus(null);
    setUnavailable(false);
    if (!UUID_RE.test(id)) {
      setUser(null);
      return;
    }
    pageRequest(`/api/v1/users/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (cancelled) return;
        setStatus(res.status);
        if (!res.ok) {
          if (res.status === 403 || res.status === 404) setUser(null);
          else setUnavailable(true);
          return;
        }
        const body = await readJson(res);
        const record = (body?.user as Record<string, unknown> | undefined) ?? body;
        if (!record || typeof record.id !== "string") setUnavailable(true);
        else setUser(record);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return (
    <Shell session={session}>
      <p>
        <Link to={roleToPath(session.role)} testid="back-to-list">
          Back
        </Link>
      </p>
      {unavailable ? (
        <UserUnavailable retryHref={`/org-admin/users/${encodeURIComponent(id)}`} />
      ) : user === undefined ? (
        <p data-testid="user-loading">Loading…</p>
      ) : user === null ? (
        <NotFoundPanel />
      ) : (
        <article data-testid="user-detail" data-id={id} data-status={status ?? ""}>
          <h1 data-testid="user-email">{String(user.email ?? "")}</h1>
          <dl>
            <dt>Id</dt>
            <dd data-testid="user-id">{String(user.id ?? "")}</dd>
            <dt>Role</dt>
            <dd data-testid="user-role">{String(user.role ?? "")}</dd>
          </dl>
        </article>
      )}
    </Shell>
  );
}

function AccountSettings({
  session,
}: {
  session: Extract<SessionState, { kind: "authenticated" }>;
}) {
  const [outcome, setOutcome] = useState<string>("");
  const [profileOutcome, setProfileOutcome] = useState<string>("");
  // The authorized-success mutation of the proof set: PUT /api/v1/profile
  // (users.go:432, RequireAuthenticated, self-scoped by the principal).
  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await pageRequest("/api/v1/profile", {
      method: "PUT",
      body: JSON.stringify({ name: String(form.get("name") ?? "") }),
    });
    const body = await readJson(res);
    if (res.ok) setProfileOutcome(`saved:${String(body?.name ?? "")}`);
    else if (res.status === 401) setProfileOutcome("Your session has expired. Sign in again.");
    else if (res.status === 403) setProfileOutcome("refused");
    else setProfileOutcome(`error:${res.status}`);
  }
  async function disable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (String(form.get("confirm") ?? "") !== "DISABLE") {
      setOutcome("Type DISABLE to confirm.");
      return;
    }
    const res = await pageRequest("/api/v1/me/mfa/disable", {
      method: "POST",
      body: JSON.stringify({ code: String(form.get("code") ?? ""), password: "" }),
    });
    const body = await readJson(res);
    // The mapping of src/lib/idp-account-client.ts:138-151, preserved.
    if (res.status === 204) setOutcome("disabled");
    else if (res.status === 404 || res.status === 501 || res.status === 503)
      setOutcome("MFA disable is not available from this IDP runtime.");
    else if (res.status === 403)
      setOutcome("Your organization requires MFA; it cannot be disabled.");
    else if (res.status === 400) setOutcome("MFA is not enrolled on this account.");
    else if (res.status === 401 && body?.error === "invalid_code")
      setOutcome("Could not verify the code.");
    else if (res.status === 401) setOutcome("Your session has expired. Sign in again.");
    else setOutcome("Could not disable MFA.");
  }
  return (
    <Shell session={session}>
      <h1>Account settings</h1>
      <form onSubmit={saveProfile} data-testid="profile-form">
        <label>
          Display name <input name="name" data-testid="profile-name" />
        </label>
        <button type="submit">Save</button>
      </form>
      {profileOutcome && (
        <p role="status" data-testid="profile-outcome">
          {profileOutcome}
        </p>
      )}
      <form onSubmit={disable} data-testid="mfa-disable-form">
        <label>
          Authenticator code <input name="code" inputMode="numeric" />
        </label>
        <label>
          Type DISABLE <input name="confirm" />
        </label>
        <button type="submit">Disable two-factor authentication</button>
      </form>
      {outcome && (
        <p role="status" data-testid="mfa-disable-outcome">
          {outcome}
        </p>
      )}
    </Shell>
  );
}

// -------------------------------------------------------------------- app

function App() {
  const full = usePath();
  const [pathname, search] = full.split("?");
  const query = new URLSearchParams(search ?? "");
  const guard = (
    render: (s: Extract<SessionState, { kind: "authenticated" }>) => React.ReactNode
  ) => <Guard key={full} render={render} pathname={pathname} />;

  if (pathname === "/") return <Root />;
  if (pathname === "/login") return <Login query={query} />;
  if (pathname === "/setup" || pathname === "/setup-required") return <SetupRequired />;
  if (pathname === "/platform-status") return <PlatformStatus query={query} />;
  if (pathname === "/dashboard" || pathname === "/org-admin" || pathname === "/site-admin") {
    return guard((s) => <Home session={s} />);
  }
  const user = pathname.match(/^\/org-admin\/users\/([^/]+)$/);
  if (user) return guard((s) => <UserDetail session={s} id={decodeURIComponent(user[1] ?? "")} />);
  if (pathname === "/account/settings") return guard((s) => <AccountSettings session={s} />);
  return (
    <section data-testid="not-found">
      <h1>Page not found</h1>
      <Link to="/">Home</Link>
    </section>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
