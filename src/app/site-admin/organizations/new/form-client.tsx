"use client";

import { Button } from "@/components/ui/button";
import { useActionState } from "react";
import { type CreateOrgActionState, createOrgAction } from "./actions";

const initialState: CreateOrgActionState = {};

/** Warm brand input style used inline in forms that cannot import the Input
    shared component directly due to colocation constraints. */
const inputClass =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

export function CreateOrgForm() {
  const [state, action, isPending] = useActionState(createOrgAction, initialState);

  // Show success panel when creation succeeded.
  // The form is hidden so it cannot be re-submitted by accident.
  if (state.success) {
    return <SuccessPanel success={state.success} />;
  }

  return (
    <form action={action} className="space-y-5 max-w-lg">
      {/* Global error */}
      {state.error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.error}
        </div>
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <label htmlFor="org-name" className="block text-sm font-semibold text-stone-700">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          name="name"
          id="org-name"
          type="text"
          required
          maxLength={255}
          placeholder="Acme Corp"
          autoComplete="off"
          className={inputClass}
        />
        {state.fieldErrors?.name && (
          <p className="text-xs text-red-600">{state.fieldErrors.name}</p>
        )}
      </div>

      {/* Domain */}
      <div className="space-y-1.5">
        <label htmlFor="org-domain" className="block text-sm font-semibold text-stone-700">
          Domain <span className="text-red-500">*</span>
        </label>
        <input
          name="domain"
          id="org-domain"
          type="text"
          required
          maxLength={253}
          placeholder="acme.com"
          autoComplete="off"
          className={inputClass}
        />
        <p className="text-xs text-stone-400">
          The organization&apos;s primary domain, e.g. acme.com
        </p>
        {state.fieldErrors?.domain && (
          <p className="text-xs text-red-600">{state.fieldErrors.domain}</p>
        )}
      </div>

      {/* Initial admin email (optional) */}
      <div className="space-y-1.5">
        <label htmlFor="org-admin-email" className="block text-sm font-semibold text-stone-700">
          Initial admin email
        </label>
        <input
          name="admin_email"
          id="org-admin-email"
          type="email"
          maxLength={255}
          placeholder="admin@acme.com"
          autoComplete="off"
          className={inputClass}
        />
        <p className="text-xs text-stone-400 leading-relaxed">
          Optional. If provided, creates an initial org admin user and requests an activation email
          (delivery depends on IdP SMTP configuration). If omitted, a shell organization is created
          with no admin.
        </p>
        {state.fieldErrors?.admin_email && (
          <p className="text-xs text-red-600">{state.fieldErrors.admin_email}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? "Creating…" : "Create organization"}
        </Button>
        <a
          href="/site-admin/organizations"
          className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

function SuccessPanel({ success }: { success: NonNullable<CreateOrgActionState["success"]> }) {
  const { orgId, orgName, orgDomain, adminEmail, activationToken } = success;

  return (
    <div className="max-w-lg space-y-5">
      {/* Primary confirmation */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
        <p className="text-sm font-semibold text-emerald-700">Organization created</p>
        <p className="text-xs text-stone-500 mt-1">
          <span className="font-medium text-sky-950">{orgName}</span>{" "}
          <span className="font-mono text-stone-400">({orgDomain})</span> was created successfully.
        </p>
      </div>

      {/* Case: air-gapped mode — token returned, must be delivered manually */}
      {activationToken && adminEmail && (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-700">
              Air-gapped mode: manual token delivery required
            </p>
            <p className="text-xs text-stone-500 mt-1 leading-relaxed">
              Email delivery is not configured. The one-time activation token below must be
              delivered securely to <span className="font-mono text-sky-950">{adminEmail}</span> so
              they can activate their account. The token expires in 24 hours.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              One-time activation token
            </p>
            {/* Token displayed for copy — never placed in URL or storage */}
            <pre className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-sky-950 break-all whitespace-pre-wrap font-mono overflow-x-auto shadow-inner">
              {activationToken}
            </pre>
            <p className="text-xs text-amber-600 leading-relaxed">
              ⚠ Copy this token now. It will not be shown again after you leave this page. Deliver
              it to <span className="font-mono">{adminEmail}</span> through a secure channel.
            </p>
          </div>
        </div>
      )}

      {/* Case: normal mode, email provided. */}
      {!activationToken && adminEmail && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-xs text-stone-500">
            If email delivery is configured on the IdP, an activation email was requested for{" "}
            <span className="font-mono font-medium text-sky-950">{adminEmail}</span>. If the email
            does not arrive, verify the IdP&apos;s SMTP configuration or use the resend activation
            option when available.
          </p>
        </div>
      )}

      {/* Case: no admin email — shell org created */}
      {!adminEmail && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-xs text-stone-500">
            No initial admin was assigned. The organization is a shell and remains inactive until an
            admin claims it.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-3 flex-wrap">
        {orgId && (
          <a
            href={`/site-admin/organizations/${orgId}`}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm transition-colors"
          >
            View organization →
          </a>
        )}
        <a
          href="/site-admin/organizations"
          className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
        >
          View all organizations
        </a>
        <a
          href="/site-admin/organizations/new"
          className="text-sm text-stone-500 hover:text-sky-950 transition-colors"
        >
          Create another
        </a>
      </div>
    </div>
  );
}
