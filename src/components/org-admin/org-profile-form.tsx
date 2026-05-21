"use client";

/**
 * OrgProfileForm — lets org_admin update their organization's display name.
 *
 * Domain is intentionally read-only: domain changes affect OIDC discovery
 * documents and SSO configurations, so they require additional verification
 * not currently supported by the self-service flow.
 */

import {
  type UpdateOrgProfileState,
  updateOrgProfileAction,
} from "@/app/org-admin/settings/actions";
import { Button } from "@/components/ui/button";
import { useActionState } from "react";

interface OrgProfileFormProps {
  currentName: string;
  domain: string | null | undefined;
}

const initialState: UpdateOrgProfileState = { phase: "idle" };

const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const inputErrorClass =
  "block w-full rounded-xl border border-red-300 bg-stone-50 px-4 py-2.5 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

export function OrgProfileForm({ currentName, domain }: OrgProfileFormProps) {
  const [state, action, isPending] = useActionState(updateOrgProfileAction, initialState);

  const displayName = state.phase === "success" ? state.name : currentName;

  return (
    <form action={action} className="space-y-5 max-w-md">
      {state.phase === "success" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-medium">
          Organization name updated.
        </div>
      )}

      {state.phase === "error" && state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      {/* Organization name */}
      <div className="space-y-1.5">
        <label htmlFor="org-name" className="block text-sm font-semibold text-stone-700">
          Organization name <span className="text-red-500">*</span>
        </label>
        <input
          id="org-name"
          name="name"
          type="text"
          required
          maxLength={100}
          defaultValue={displayName}
          key={displayName}
          className={
            state.phase === "error" && state.fieldErrors?.name ? inputErrorClass : inputClass
          }
        />
        {state.phase === "error" && state.fieldErrors?.name && (
          <p className="text-xs text-red-600">{state.fieldErrors.name}</p>
        )}
      </div>

      {/* Domain — read-only */}
      {domain && (
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-stone-700">Primary domain</label>
          <div className="flex items-center gap-2">
            <p className="flex-1 rounded-xl border border-stone-200 bg-stone-100 px-4 py-2.5 text-sm text-stone-500 font-mono cursor-default">
              {domain}
            </p>
          </div>
          <p className="text-xs text-stone-400">
            Domain changes affect OIDC discovery and SSO — contact your platform administrator.
          </p>
        </div>
      )}

      <Button type="submit" loading={isPending} size="md">
        {isPending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
