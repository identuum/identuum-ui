/**
 * /invite?token=… — accept a user invite (OSS-ONBOARD-B, owner ruling D-016).
 *
 * The link an org_admin hands over (or the IdP mails, where it sends mail):
 * <IDENTUUM_IDP_UI_PUBLIC_BASE_URL>/invite?token=<raw>. Public, like
 * /activate: the server reads the token once and validates it, the page shows
 * the invited email, and the form posts the token back with the password.
 * Where the IdP mounts no invite (capabilities.user_invite not true) nothing
 * is called. The URL carries the token, so Referrer-Policy is no-referrer.
 */
import type { Metadata } from "next";
import { MailCeremonyUnavailable } from "@/components/auth/mail-ceremony-unavailable";
import { userInviteAvailable } from "@/lib/mail-capabilities";
import { validateInviteToken } from "./actions";
import { InviteFormClient, InviteInvalid } from "./form-client";
import { INVITE_RATE_LIMITED_COPY } from "./invite-copy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Accept your invitation — Identuum",
  referrer: "no-referrer",
};

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await userInviteAvailable())) {
    return (
      <MailCeremonyUnavailable
        title="Accept invitation"
        reason="it issues no invitations"
        advice="Ask your administrator how to get access."
      />
    );
  }
  const params = await searchParams;
  const rawToken = typeof params.token === "string" ? params.token.trim() : "";
  const validation = await validateInviteToken(rawToken);

  let body: React.ReactNode;
  if (validation.state === "valid") {
    body = <InviteFormClient rawToken={rawToken} email={validation.email} />;
  } else if (validation.state === "rate_limited") {
    body = <p className="text-sm text-stone-600 leading-relaxed">{INVITE_RATE_LIMITED_COPY}</p>;
  } else if (validation.state === "unavailable") {
    body = (
      <p className="text-sm text-stone-600 leading-relaxed">
        The identity service could not be reached. Try again in a moment.
      </p>
    );
  } else {
    body = <InviteInvalid />;
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center flex flex-col items-center gap-3">
          <div className="h-10 w-10 bg-sky-600 rounded-xl flex items-center justify-center shadow-sm">
            <span className="font-black text-white text-sm tracking-tight leading-none">Id</span>
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-sky-950">identuum</span>
        </div>
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-stone-100">
            <h1 className="text-lg font-bold tracking-tight text-sky-950">
              Accept your invitation
            </h1>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
              Set your password, then sign in.
            </p>
          </div>
          <div className="px-6 py-5">{body}</div>
        </div>
      </div>
    </div>
  );
}
