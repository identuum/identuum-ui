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
 */
import type { ReactNode } from "react";
import LoginPage from "@/app/login/page";
import { signOutDestination } from "./logout";
import { navigate } from "./router";

type PageProps = { searchParams: Promise<Record<string, string | string[]>> };

export async function ExportLoginPage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : null;
  const page = await LoginPage();
  return (
    <section data-testid="login">
      <LoginReason reason={reason} />
      {page}
    </section>
  );
}

function LoginReason({ reason }: { reason: string | null }) {
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
