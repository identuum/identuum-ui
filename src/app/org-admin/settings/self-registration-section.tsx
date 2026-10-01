"use client";

/**
 * D-021: the organization's self-registration policy. Open, approval, email
 * verification (only where the IdP can send mail) and email domains, plus
 * the organization's sign-up link. Read-only, with a note, while the
 * installation's self-registration is off.
 */

import { useActionState } from "react";
import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import type { OrgRegistrationSettings } from "@/lib/idp-registration-client";
import { type OrgRegistrationState, setOrgRegistrationAction } from "./registration-actions";

export const SELF_REGISTRATION_COPY = {
  instanceOff:
    "Self-registration is off for this installation, so this organization cannot accept sign-ups. A site administrator can turn it on.",
  noMail:
    "Email verification needs email delivery, which is not configured on the identity provider.",
};

export function SelfRegistrationSection({
  orgId,
  slug,
  initial,
  mailDelivery,
  instanceOff,
}: {
  orgId: string;
  slug: string;
  initial: OrgRegistrationSettings | null;
  mailDelivery: boolean;
  instanceOff: boolean;
}) {
  const [state, action, pending] = useActionState(setOrgRegistrationAction, {
    settings: initial ?? {
      allow_public_registration: false,
      require_registration_approval: false,
      verify_email: false,
      email_domains: [],
    },
    instanceOff,
  } as OrgRegistrationState);
  const s = state.settings;
  const locked = state.instanceOff === true;
  const link =
    typeof window === "undefined"
      ? `/register/${slug}`
      : `${window.location.origin}/register/${slug}`;
  return (
    <section
      data-testid="org-self-registration"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-5 space-y-4"
    >
      <div>
        <p className="text-sm font-semibold text-sky-950">Self-registration</p>
        <p className="text-xs text-stone-500 mt-0.5">
          Let people create their own account in this organization. They are always regular users,
          never administrators.
        </p>
      </div>
      {initial === null ? (
        <p className="text-xs text-stone-500">The setting could not be read.</p>
      ) : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="org_id" value={orgId} />
          {locked && (
            <p className="text-xs text-amber-700" data-testid="self-registration-instance-off">
              {SELF_REGISTRATION_COPY.instanceOff}
            </p>
          )}
          <fieldset disabled={locked || pending} className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-sky-950">
              <input type="checkbox" name="allow" defaultChecked={s.allow_public_registration} />
              Allow sign-up
            </label>
            <label className="flex items-center gap-2 text-xs text-sky-950">
              <input
                type="checkbox"
                name="approval"
                defaultChecked={s.require_registration_approval}
              />
              Hold new accounts until an administrator approves them
            </label>
            <label className="flex items-center gap-2 text-xs text-sky-950">
              <input
                type="checkbox"
                name="verify"
                defaultChecked={s.verify_email}
                disabled={!mailDelivery}
              />
              Require a verified email before the first sign-in
            </label>
            {!mailDelivery && (
              <p className="text-xs text-stone-500 pl-6">{SELF_REGISTRATION_COPY.noMail}</p>
            )}
            <label
              htmlFor="registration-domains"
              className="block text-xs font-semibold text-stone-700"
            >
              Allowed email domains (optional, separated by commas)
            </label>
            <input
              id="registration-domains"
              name="domains"
              defaultValue={s.email_domains.join(", ")}
              className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 shadow-sm"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </fieldset>
          {state.saved && <p className="text-xs text-emerald-700">Saved.</p>}
          {state.error && (
            <p role="alert" className="text-xs text-red-600">
              {state.error}
            </p>
          )}
        </form>
      )}
      {s.allow_public_registration && !locked && (
        <SetupLinkPanel
          link={link}
          title="Sign-up link"
          description="Share it with the people who should be able to create an account."
        />
      )}
    </section>
  );
}
