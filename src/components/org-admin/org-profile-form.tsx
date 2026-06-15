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
import {
  ORG_ADMIN_PROFILE_FORM_COPY,
  ORG_ADMIN_PROFILE_NAME_FIELD,
} from "@/app/org-admin/settings/settings-helpers";
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
          {ORG_ADMIN_PROFILE_FORM_COPY.successBanner}
        </div>
      )}

      {state.phase === "error" && state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      {/* Organization name */}
      <div className="space-y-1.5">
        <label
          htmlFor={ORG_ADMIN_PROFILE_NAME_FIELD.id}
          className="block text-sm font-semibold text-stone-700"
        >
          {ORG_ADMIN_PROFILE_FORM_COPY.nameLabel}{" "}
          <span className="text-red-500">{ORG_ADMIN_PROFILE_FORM_COPY.requiredMarker}</span>
        </label>
        <input
          id={ORG_ADMIN_PROFILE_NAME_FIELD.id}
          name={ORG_ADMIN_PROFILE_NAME_FIELD.name}
          type={ORG_ADMIN_PROFILE_NAME_FIELD.type}
          required={ORG_ADMIN_PROFILE_NAME_FIELD.required}
          maxLength={ORG_ADMIN_PROFILE_NAME_FIELD.maxLength}
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

      {/* Domain — read-only informational display.
          Uses plain <p> elements for the heading and helper copy
          rather than <label> + <p> (which fell through to ambient
          association with the Save submit button) or <dl>/<dt>/<dd>
          (which semantically associates the <dt> as a label for the
          <dd>). A <p> has no labeling semantics, so Playwright's
          getByLabel(/primary domain/i) returns 0. */}
      {domain && (
        <div className="space-y-1.5">
          <p className="block text-sm font-semibold text-stone-700">
            {ORG_ADMIN_PROFILE_FORM_COPY.domainLabel}
          </p>
          <div className="flex items-center gap-2">
            <p className="flex-1 rounded-xl border border-stone-200 bg-stone-100 px-4 py-2.5 text-sm text-stone-500 font-mono cursor-default">
              {domain}
            </p>
          </div>
          <p className="text-xs text-stone-400">{ORG_ADMIN_PROFILE_FORM_COPY.domainHelp}</p>
        </div>
      )}

      <Button type="submit" loading={isPending} size="md">
        {isPending
          ? ORG_ADMIN_PROFILE_FORM_COPY.savingLabel
          : ORG_ADMIN_PROFILE_FORM_COPY.saveLabel}
      </Button>
    </form>
  );
}
