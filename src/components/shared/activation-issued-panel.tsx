"use client";

/**
 * ActivationIssuedPanel — the once-only hand-over of a re-issued organization
 * activation (OSS-FINAL, D-016), shaped like InviteIssuedPanel: the /activate
 * link with its Copy button, the raw token underneath, and when it expires
 * (U-020, the viewer's zone). When the IdP could not build a link it says why
 * (activation_url_unavailable names the missing setting) and the token remains.
 *
 * The values live only in the caller's in-memory state: never stored, logged
 * or put in a URL, and not shown again once the page is left.
 */

import { LocalTime } from "@/components/ui/local-time";
import { SetupLinkPanel } from "./setup-link-panel";

export interface IssuedActivation {
  adminEmail: string;
  /** Why the IdP names no admin email (identuum-idp-ce's unbound claim). */
  adminEmailUnavailable?: string;
  activationToken: string;
  activationUrl?: string;
  activationUrlUnavailable?: string;
  expiresAt: string;
}

export function ActivationIssuedPanel({ activation }: { activation: IssuedActivation }) {
  const recipient = activation.adminEmail || "the pending administrator";
  return (
    <div
      data-testid="activation-issued"
      className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4 space-y-3"
    >
      <div>
        <p className="text-sm font-semibold text-sky-950">Activation link re-issued</p>
        <p className="text-xs text-stone-600 mt-0.5 leading-relaxed">
          Hand this to {recipient} through a channel you trust. The earlier link stops working. It
          works once and expires <LocalTime value={activation.expiresAt} />. It is also mailed only
          when email delivery is configured on the IdP.
          {!activation.adminEmail && activation.adminEmailUnavailable
            ? ` No administrator email: ${activation.adminEmailUnavailable}`
            : ""}
        </p>
      </div>
      {activation.activationUrl ? (
        <SetupLinkPanel
          link={activation.activationUrl}
          title="Activation link"
          description="Opening it lets the administrator set a password and enrol an authenticator."
        />
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
          <p className="text-xs font-semibold text-stone-700">No link could be built</p>
          <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
            {activation.activationUrlUnavailable ?? "The identity provider returned no link."}
          </p>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-stone-700">Activation token</p>
        <p className="font-mono text-[11px] text-sky-950 break-all rounded-lg border border-stone-200 bg-white px-3 py-2">
          {activation.activationToken}
        </p>
      </div>
      <p className="text-xs font-semibold text-amber-700">
        Copy it now. It will not be shown again after you leave this page.
      </p>
    </div>
  );
}
