"use client";

/**
 * ServiceAccountExpiryForm — the org_admin sets their organization's default
 * service-account expiry in days (OSS-SA-EXPIRY-2): 0 = no expiry, 1 to 3650.
 *
 * Receives the stored value from the server component (getOwnOrganization).
 * Submits only the number — the server action takes the organization from the
 * session and checks the range; noValidate leaves that check, and its message,
 * to the action rather than the browser.
 */

import { useActionState } from "react";
import {
  type UpdateServiceAccountExpiryState,
  updateServiceAccountExpiryAction,
} from "@/app/org-admin/settings/actions";
import {
  describeServiceAccountExpiry,
  ORG_ADMIN_SA_EXPIRY_COPY,
} from "@/app/org-admin/settings/settings-helpers";
import { Button } from "@/components/ui/button";

interface ServiceAccountExpiryFormProps {
  currentDays: number | undefined;
}

const initialState: UpdateServiceAccountExpiryState = { phase: "idle" };

export function ServiceAccountExpiryForm({ currentDays }: ServiceAccountExpiryFormProps) {
  const [state, action, isPending] = useActionState(updateServiceAccountExpiryAction, initialState);
  const effectiveDays = state.phase === "success" ? state.days : currentDays;

  return (
    <form action={action} noValidate className="space-y-5">
      {state.phase === "success" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {ORG_ADMIN_SA_EXPIRY_COPY.successBanner}
        </div>
      )}
      {state.phase === "error" && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {state.error}
        </div>
      )}

      <p className="text-sm text-stone-600" data-testid="sa-expiry-current">
        {ORG_ADMIN_SA_EXPIRY_COPY.currentLabel}:{" "}
        <span className="font-semibold text-sky-950">
          {describeServiceAccountExpiry(effectiveDays)}
        </span>
      </p>

      <div className="space-y-1.5">
        <label
          htmlFor="service_account_expiry_days"
          className="block text-sm font-medium text-stone-700"
        >
          {ORG_ADMIN_SA_EXPIRY_COPY.label}
        </label>
        <input
          id="service_account_expiry_days"
          name="service_account_expiry_days"
          type="number"
          inputMode="numeric"
          min={0}
          max={3650}
          step={1}
          defaultValue={effectiveDays ?? ""}
          key={effectiveDays ?? "unset"}
          aria-describedby="service_account_expiry_days_help"
          className="w-40 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-sky-950 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
        <p id="service_account_expiry_days_help" className="text-xs text-stone-500 leading-relaxed">
          {ORG_ADMIN_SA_EXPIRY_COPY.help}
        </p>
      </div>

      <Button type="submit" loading={isPending} size="md">
        {isPending ? ORG_ADMIN_SA_EXPIRY_COPY.savingLabel : ORG_ADMIN_SA_EXPIRY_COPY.saveLabel}
      </Button>
    </form>
  );
}
