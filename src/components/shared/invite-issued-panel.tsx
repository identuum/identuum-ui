"use client";

/**
 * InviteIssuedPanel — the once-only hand-over of a user invite (OSS-ONBOARD-B,
 * D-016), shaped like the organization activation's: the /invite link with its
 * Copy button, the raw token underneath, and when it expires (U-020, the
 * viewer's zone). When the IdP could not build a link it says why instead
 * (invite_url_unavailable names the missing setting) and the token remains.
 *
 * The values live only in the caller's in-memory state: never stored, logged
 * or put in a URL, and not shown again once the page is left.
 */

import { LocalTime } from "@/components/ui/local-time";
import type { IssuedInvite } from "@/lib/idp-admin-client";
import { SetupLinkPanel } from "./setup-link-panel";

export function InviteIssuedPanel({ invite }: { invite: IssuedInvite }) {
  return (
    <div
      data-testid="invite-issued"
      className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4 space-y-3"
    >
      <div>
        <p className="text-sm font-semibold text-sky-950">Invitation ready</p>
        <p className="text-xs text-stone-600 mt-0.5 leading-relaxed">
          Hand this to {invite.email || "the user"} through a channel you trust. It works once and
          expires <LocalTime value={invite.expiresAt} />.
        </p>
      </div>
      {invite.inviteUrl ? (
        <SetupLinkPanel
          link={invite.inviteUrl}
          title="Invitation link"
          description="Opening it lets the user set a password and sign in."
        />
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
          <p className="text-xs font-semibold text-stone-700">No link could be built</p>
          <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
            {invite.inviteUrlUnavailable ?? "The identity provider returned no link."}
          </p>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-stone-700">Invitation token</p>
        <p className="font-mono text-[11px] text-sky-950 break-all rounded-lg border border-stone-200 bg-white px-3 py-2">
          {invite.inviteToken}
        </p>
      </div>
      <p className="text-xs font-semibold text-amber-700">
        Copy it now. It will not be shown again after you leave this page.
      </p>
    </div>
  );
}
