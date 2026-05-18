"use client";

/**
 * MFAPolicyForm — lets org_admin toggle their organization's MFA requirement.
 *
 * Receives currentPolicy from the server component (fetched via getOwnOrganization).
 * Submits only the selected policy value — the server action derives the org ID
 * from the session, so no org ID is ever sent from the browser.
 */

import {
  type MFAPolicy,
  type UpdateMFAPolicyState,
  updateMFAPolicyAction,
} from "@/app/org-admin/settings/actions";
import { Button } from "@/components/ui/button";
import { useActionState } from "react";

interface MFAPolicyFormProps {
  currentPolicy: string;
}

const initialState: UpdateMFAPolicyState = { phase: "idle" };

const POLICIES: { value: MFAPolicy; label: string; description: string }[] = [
  {
    value: "optional",
    label: "Optional",
    description:
      "Users may enroll MFA at any time, but are not required to do so before signing in.",
  },
  {
    value: "required",
    label: "Required",
    description:
      "Users must enroll and complete MFA before login can finish. Existing sessions without MFA are revoked at next sign-in.",
  },
];

export function MFAPolicyForm({ currentPolicy }: MFAPolicyFormProps) {
  const [state, action, isPending] = useActionState(updateMFAPolicyAction, initialState);

  // Optimistically reflect the saved policy after a successful update.
  const effectivePolicy =
    state.phase === "success" ? state.mfa_policy : (currentPolicy as MFAPolicy);

  return (
    <form action={action} className="space-y-5">
      {/* Success banner */}
      {state.phase === "success" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          MFA policy updated successfully.
        </div>
      )}

      {/* Error banner */}
      {state.phase === "error" && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      {/* Policy radio options */}
      <fieldset className="space-y-3">
        <legend className="sr-only">MFA policy</legend>
        {POLICIES.map(({ value, label, description }) => (
          <label
            key={value}
            className={[
              "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
              effectivePolicy === value
                ? "border-sky-500 bg-sky-50/60"
                : "border-stone-200 bg-stone-50 hover:border-stone-300",
            ].join(" ")}
          >
            <input
              type="radio"
              name="mfa_policy"
              value={value}
              defaultChecked={effectivePolicy === value}
              className="mt-0.5 h-4 w-4 shrink-0 accent-sky-600"
            />
            <div>
              <span className="block text-sm font-semibold text-sky-950">{label}</span>
              <span className="block text-xs text-stone-500 mt-0.5 leading-relaxed">
                {description}
              </span>
            </div>
          </label>
        ))}
      </fieldset>

      <Button type="submit" loading={isPending} size="md">
        {isPending ? "Saving…" : "Save policy"}
      </Button>
    </form>
  );
}
