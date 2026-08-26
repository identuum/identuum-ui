"use client";

/**
 * LifecycleCard — operator surface for the org-admin SA disable/enable
 * lifecycle (slice identuum-20260530-service-account-disable-enable-ui).
 * Mounted between the Configuration card and the LinkToOAuthClientCard
 * on /org-admin/service-accounts/[id].
 *
 * Backend (gograph-verified in slice
 * identuum-20260530-service-account-disable-enable-backend):
 *   POST /api/v1/organizations/:id/service-accounts/:sa_id/disable
 *   POST /api/v1/organizations/:id/service-accounts/:sa_id/enable
 *   Both routes flip service_accounts.active without touching
 *   deleted_at. The existing GenerateTokensForClient lifecycle guard
 *   already refuses to mint client_credentials tokens for !sa.Active
 *   SAs — disable therefore takes effect for NEW tokens immediately.
 *
 * SECURITY invariants (pinned by Vitest):
 *   - The card renders NO client_secret / hash / credential / private-
 *     key / signing-key / token / cookie / session-id / raw metadata
 *     / IP / user-agent surface.
 *   - The form's only input is the literal `confirm` string ("DISABLE"
 *     for disable / "ENABLE" for enable); the serviceAccountId is
 *     curried via .bind so the form never carries it. The action
 *     server-side derives the organization id via getOwnOrganization()
 *     — the form never carries an organization_id either.
 *   - No write to localStorage / sessionStorage / cookies / URL.
 *   - No console.* call anywhere in this file.
 *   - The DISABLE flow uses a two-step expand + literal "DISABLE"
 *     type-to-confirm gate; the ENABLE flow uses an analogous "ENABLE"
 *     gate (lighter because re-enabling is reversible, but still an
 *     explicit POST form action — never an idle GET that a stray
 *     click could trigger).
 */

import { useActionState, useState } from "react";
import {
  type DisableSAState,
  disableServiceAccountAction,
  type EnableSAState,
  enableServiceAccountAction,
} from "../actions";

const initialDisableState: DisableSAState = { phase: "idle" };
const initialEnableState: EnableSAState = { phase: "idle" };

export interface LifecycleCardProps {
  serviceAccountId: string;
  serviceAccountName: string;
  /** Persistent server-rendered active state (from the SA list / get DTO). */
  active: boolean;
}

export function LifecycleCard({
  serviceAccountId,
  serviceAccountName,
  active,
}: LifecycleCardProps) {
  return (
    <section
      aria-labelledby="service-account-lifecycle-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100 flex items-start justify-between gap-4">
        <div>
          <h2 id="service-account-lifecycle-heading" className="text-sm font-semibold text-sky-950">
            Lifecycle
          </h2>
          <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
            {active
              ? "Active service accounts can mint new client_credentials tokens through their linked OAuth client. Disabling blocks new token issuance immediately; existing access tokens run to their natural expiry. No credential is rotated."
              : "Disabled service accounts cannot mint new client_credentials tokens. Re-enabling restores token issuance for the linked OAuth client (if otherwise valid). No new credential is issued by enabling."}
          </p>
        </div>
        <StatusBadge active={active} />
      </div>
      {active ? (
        <DisablePanel serviceAccountId={serviceAccountId} serviceAccountName={serviceAccountName} />
      ) : (
        <EnablePanel serviceAccountId={serviceAccountId} serviceAccountName={serviceAccountName} />
      )}
    </section>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        role="status"
        aria-label="Service account status: Active"
        className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"
      >
        Active
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-label="Service account status: Disabled"
      className="inline-flex items-center rounded-full border border-stone-200 bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-600"
    >
      Disabled
    </span>
  );
}

function DisablePanel({
  serviceAccountId,
  serviceAccountName,
}: {
  serviceAccountId: string;
  serviceAccountName: string;
}) {
  const bound = disableServiceAccountAction.bind(null, serviceAccountId);
  const [state, action, pending] = useActionState(bound, initialDisableState);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (state.phase === "success") {
    // The action's revalidatePath() invalidates this page so a
    // subsequent server re-render will toggle the StatusBadge from
    // Active → Disabled and swap this panel for the EnablePanel.
    // Until then, show a transient in-memory success banner that
    // narrates the new state.
    return (
      <div className="px-6 py-5 space-y-3">
        <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 space-y-1">
          <p className="font-semibold">Service account disabled.</p>
          <p className="text-xs leading-relaxed">
            <strong className="font-mono">{state.result.service_account_name}</strong> can no longer
            mint new client_credentials tokens through any linked OAuth client. No credential was
            issued or rotated.
          </p>
        </output>
      </div>
    );
  }

  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};

  if (!confirmOpen) {
    return (
      <div className="px-6 py-5">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
        >
          Disable service account
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="px-6 py-5 space-y-4">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {errorMessage}
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="disable-confirm" className="block text-xs font-medium text-sky-950">
          Type DISABLE to confirm
        </label>
        <input
          id="disable-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          required
          disabled={pending}
          className={
            fieldErrors.confirm
              ? "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors"
              : "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors"
          }
        />
        {fieldErrors.confirm && <p className="text-[11px] text-red-600">{fieldErrors.confirm}</p>}
        <p className="text-[10px] text-stone-400 leading-relaxed">
          Typing DISABLE and submitting disables{" "}
          <strong className="font-mono">{serviceAccountName}</strong>. New client_credentials token
          issuance is blocked immediately; existing tokens run to their natural expiry. No
          credential is rotated.
        </p>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
        >
          {pending ? "Disabling…" : "Disable service account"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(false)}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-stone-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function EnablePanel({
  serviceAccountId,
  serviceAccountName,
}: {
  serviceAccountId: string;
  serviceAccountName: string;
}) {
  const bound = enableServiceAccountAction.bind(null, serviceAccountId);
  const [state, action, pending] = useActionState(bound, initialEnableState);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (state.phase === "success") {
    return (
      <div className="px-6 py-5 space-y-3">
        <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 space-y-1">
          <p className="font-semibold">Service account enabled.</p>
          <p className="text-xs leading-relaxed">
            <strong className="font-mono">{state.result.service_account_name}</strong> can again
            mint new client_credentials tokens through its linked OAuth client (if otherwise valid).
            No new credential was issued.
          </p>
        </output>
      </div>
    );
  }

  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};

  if (!confirmOpen) {
    return (
      <div className="px-6 py-5">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Enable service account
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="px-6 py-5 space-y-4">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {errorMessage}
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="enable-confirm" className="block text-xs font-medium text-sky-950">
          Type ENABLE to confirm
        </label>
        <input
          id="enable-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          required
          disabled={pending}
          className={
            fieldErrors.confirm
              ? "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors"
              : "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors"
          }
        />
        {fieldErrors.confirm && <p className="text-[11px] text-red-600">{fieldErrors.confirm}</p>}
        <p className="text-[10px] text-stone-400 leading-relaxed">
          Typing ENABLE and submitting re-enables{" "}
          <strong className="font-mono">{serviceAccountName}</strong>. Token issuance resumes
          immediately for the linked OAuth client (if otherwise valid). No new credential is issued.
        </p>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          {pending ? "Enabling…" : "Enable service account"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(false)}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-stone-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
