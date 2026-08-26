"use client";

/**
 * InvitePolicyForm — lets org_admin choose their organization's invite-policy
 * mode. Backed by the IDP organization-update API, which accepts the two
 * persisted booleans (`allow_public_registration` and
 * `require_registration_approval`). The form exposes the three documented
 * operator-visible modes; the server action derives the boolean pair from
 * the chosen mode so the invalid `(false, true)` combination cannot reach
 * the wire even if a malicious client tampered with the form.
 *
 * Persisted-row recovery: when the stored row is already in the invalid
 * combination (no matching documented mode), the form surfaces a warning
 * banner explaining that choosing any mode below will repair the row.
 */

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  type UpdateInvitePolicyState,
  updateInvitePolicyAction,
} from "@/app/org-admin/settings/actions";
import {
  deriveOrgAdminInvitePolicyMode,
  isValidInvitePolicyFlags,
  ORG_ADMIN_INVITE_POLICY_CARD_COPY,
  ORG_ADMIN_INVITE_POLICY_FORM_COPY,
  ORG_ADMIN_INVITE_POLICY_MODE_COPY,
  type OrgAdminInvitePolicyInput,
  type OrgAdminInvitePolicyMode,
} from "@/app/org-admin/settings/settings-helpers";
import { Button } from "@/components/ui/button";

interface InvitePolicyFormProps {
  policy: OrgAdminInvitePolicyInput;
}

const initialState: UpdateInvitePolicyState = { phase: "idle" };

const MODE_ORDER: ReadonlyArray<OrgAdminInvitePolicyMode> = [
  "invite-only",
  "public-with-approval",
  "public-immediate",
];

export function InvitePolicyForm({ policy }: InvitePolicyFormProps) {
  const [state, action, isPending] = useActionState(updateInvitePolicyAction, initialState);

  const initialPersistedValid = isValidInvitePolicyFlags(
    policy.allow_public_registration,
    policy.require_registration_approval
  );
  // When the persisted row is valid, deriveOrgAdminInvitePolicyMode returns
  // the matching mode. When it is invalid (false × true), we leave the radio
  // group with NO initial selection so the operator must explicitly choose
  // a mode to repair the row.
  const initialMode: OrgAdminInvitePolicyMode | null = initialPersistedValid
    ? deriveOrgAdminInvitePolicyMode(policy)
    : null;

  // Optimistically reflect the saved mode after a successful update so the
  // "currently selected" radio matches what the server now holds without
  // waiting for a full reload.
  const effectiveSavedMode: OrgAdminInvitePolicyMode | null =
    state.phase === "success" ? state.mode : initialMode;

  // The radio's tracked selection. Initialized from the effective saved mode
  // (or null if the row is invalid and no save has happened yet). Reset to
  // `effectiveSavedMode` whenever it changes (i.e. after a successful save
  // re-renders with the new persisted mode). Using a useEffect avoids the
  // set-during-render footgun and keeps the controlled radios in sync with
  // the server's projected state.
  const [selected, setSelected] = useState<OrgAdminInvitePolicyMode | null>(effectiveSavedMode);
  useEffect(() => {
    setSelected(effectiveSavedMode);
  }, [effectiveSavedMode]);

  const isUnchanged = selected !== null && selected === effectiveSavedMode;
  const isSaveDisabled = isPending || selected === null || isUnchanged;

  return (
    <form
      action={action}
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">
          {ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardTitle}
        </p>
        <p className="text-xs text-stone-400 mt-0.5">
          {ORG_ADMIN_INVITE_POLICY_CARD_COPY.cardSubtitle}
        </p>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Success banner */}
        {state.phase === "success" && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {ORG_ADMIN_INVITE_POLICY_FORM_COPY.successBanner}
          </div>
        )}

        {/* Error banner */}
        {state.phase === "error" && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {state.error}
          </div>
        )}

        {/* Invalid-stored-state banner (only when persisted row has no
            matching documented mode). */}
        {!initialPersistedValid && state.phase !== "success" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {ORG_ADMIN_INVITE_POLICY_FORM_COPY.invalidStateBanner}
          </div>
        )}

        {/* Mode radio group */}
        <fieldset className="space-y-3">
          <legend className="sr-only">{ORG_ADMIN_INVITE_POLICY_FORM_COPY.legend}</legend>
          {MODE_ORDER.map((mode) => {
            const copy = ORG_ADMIN_INVITE_POLICY_MODE_COPY[mode];
            const isChecked = selected === mode;
            return (
              <label
                key={mode}
                className={[
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                  isChecked
                    ? "border-sky-500 bg-sky-50/60"
                    : "border-stone-200 bg-stone-50 hover:border-stone-300",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="invite_policy_mode"
                  value={mode}
                  checked={isChecked}
                  onChange={() => setSelected(mode)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-sky-600"
                />
                <div>
                  <span className="block text-sm font-semibold text-sky-950">{copy.label}</span>
                  <span className="block text-xs text-stone-500 mt-0.5 leading-relaxed">
                    {copy.description}
                  </span>
                </div>
              </label>
            );
          })}
        </fieldset>

        {/* Save + footer hint */}
        <div className="flex flex-col gap-3">
          <Button type="submit" loading={isPending} size="md" disabled={isSaveDisabled}>
            {isPending
              ? ORG_ADMIN_INVITE_POLICY_FORM_COPY.savingLabel
              : ORG_ADMIN_INVITE_POLICY_FORM_COPY.saveLabel}
          </Button>

          <div className="border-t border-stone-100 pt-4 flex flex-col gap-1.5">
            <p className="text-xs text-stone-500 leading-relaxed">
              {ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHint}
            </p>
            <Link
              href={ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteHref}
              className="text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors w-fit"
            >
              {ORG_ADMIN_INVITE_POLICY_CARD_COPY.directInviteLinkLabel}
            </Link>
          </div>
        </div>
      </div>
    </form>
  );
}
