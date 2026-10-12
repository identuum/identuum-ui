/**
 * /login in the export: the SHARED sign-in page (src/app/login/page.tsx),
 * under a banner for the reason the export sent the browser here.
 *
 * The banner is the export's, not a change to the shared page: two of its
 * reasons come from the Go boundary's own logout (signed_out_locally when the
 * IdP could not be reached and the boundary cleared the cookies itself,
 * sign_out_unconfirmed when no answer confirmed anything — logout.ts), which
 * the Next deployment has no equivalent of; the other two (signed_out,
 * session_expired) are where the export's sign-out and the shared layouts'
 * expiry send the browser.
 *
 * UI-0912-A (C6): the signed-out banner shows ONCE. After its first render
 * the reason leaves the address bar (a reload or a bookmark does not repeat
 * it), and it is hidden as soon as the sign-in form is submitted.
 * UI-0912-AB-FIX F7 (judge ruling): ONLY that banner. "Sign-out could not be
 * confirmed" (with Retry sign-out) and "signed out on this device only" stay,
 * address and all, until they are resolved; so does "session expired".
 */
import { type ReactNode, useEffect, useState } from "react";
import LoginPage from "@/app/login/page";
import { signOutDestination } from "./logout";
import { navigate } from "./router";

type PageProps = { searchParams: Promise<Record<string, string | string[]>> };

export async function ExportLoginPage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : null;
  const page = await LoginPage({ searchParams: Promise.resolve(params) });
  return (
    <section data-testid="login">
      <LoginReason reason={reason} />
      {page}
    </section>
  );
}

/** Whether this reason's banner shows once (F7: only signed_out). */
export function showsOnce(reason: string | null): boolean {
  return reason === "signed_out";
}

/** The address without its `reason` parameter, or null when it has none. */
export function addressWithoutReason(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has("reason")) return null;
  params.delete("reason");
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

function LoginReason({ reason }: { reason: string | null }) {
  const [hidden, setHidden] = useState(false);
  const once = showsOnce(reason);
  useEffect(() => {
    if (!once) return;
    // Not navigate(): the route must not re-render; only the address changes.
    const to = addressWithoutReason(window.location.pathname, window.location.search);
    if (to !== null) window.history.replaceState(window.history.state, "", to);
    const hide = () => setHidden(true);
    document.addEventListener("submit", hide, true);
    return () => document.removeEventListener("submit", hide, true);
  }, [once]);
  if (hidden) return null;
  const frame = "mx-auto mt-4 max-w-sm rounded-xl border px-4 py-3 text-sm";
  if (reason === "sign_out_unconfirmed") {
    return (
      <p
        role="alert"
        data-testid="login-reason"
        className={`${frame} border-amber-200 bg-amber-50`}
      >
        Sign-out could not be confirmed. Your session may still be active.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => void signOutDestination().then((to) => navigate(to))}
        >
          Retry sign-out
        </button>
      </p>
    );
  }
  const copy: Record<string, string> = {
    signed_out_locally:
      "You were signed out on this device only: the identity provider could not be reached to end the session.",
    signed_out: "You have been signed out.",
    session_expired: "Your session has expired. Sign in again.",
  };
  const text = reason ? copy[reason] : undefined;
  if (!text) return null;
  return (
    <p role="status" data-testid="login-reason" className={`${frame} border-stone-200 bg-white`}>
      {text}
    </p>
  );
}
