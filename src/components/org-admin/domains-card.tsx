"use client";

/**
 * DomainsCard — org_admin Domains card on /org-admin/settings.
 *
 * Responsibilities:
 *   - List the organization's verified + pending domains.
 *   - Surface the DNS-TXT challenge ONCE (immediately after a successful
 *     add). The raw record_value is never persisted, never logged, never
 *     re-fetched. A subsequent render resets the state to idle.
 *   - Offer Verify on pending rows, Set primary on verified non-primary
 *     rows, and Remove on non-primary rows.
 *   - Suppress the Remove affordance on the primary row by construction
 *     (the backend also enforces this).
 *
 * Security:
 *   - Org ID is derived server-side and is never read from the form.
 *   - All actions go through the server actions in
 *     ./../app/org-admin/settings/domains-actions.ts which re-validate
 *     the session, the org_admin role, and the org id on every call.
 *   - The verification token hash from the IDP is never read by the UI
 *     (the wire type excludes it).
 */

import {
  type AddOrganizationDomainState,
  type DeleteOrganizationDomainState,
  type SetPrimaryOrganizationDomainState,
  type VerifyOrganizationDomainState,
  addOrganizationDomainAction,
  deleteOrganizationDomainAction,
  setPrimaryOrganizationDomainAction,
  verifyOrganizationDomainAction,
} from "@/app/org-admin/settings/domains-actions";
import { ORG_ADMIN_DOMAINS_CARD_COPY } from "@/app/org-admin/settings/settings-helpers";
import { Button } from "@/components/ui/button";
import type { OrganizationDomainInfo } from "@/lib/types";
import { useActionState } from "react";

interface DomainsCardProps {
  domains: OrganizationDomainInfo[];
  /**
   * Non-null only when the IDP read returned an error AND we want to
   * surface that to the operator without breaking the page render.
   * Null when the list loaded successfully (even if empty).
   */
  loadError: string | null;
}

const addInitialState: AddOrganizationDomainState = { phase: "idle" };
const verifyInitialState: VerifyOrganizationDomainState = { phase: "idle" };
const removeInitialState: DeleteOrganizationDomainState = { phase: "idle" };
const primaryInitialState: SetPrimaryOrganizationDomainState = { phase: "idle" };

export function DomainsCard({ domains, loadError }: DomainsCardProps) {
  const [addState, addAction, addPending] = useActionState(
    addOrganizationDomainAction,
    addInitialState
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyOrganizationDomainAction,
    verifyInitialState
  );
  const [removeState, removeAction, removePending] = useActionState(
    deleteOrganizationDomainAction,
    removeInitialState
  );
  const [primaryState, primaryAction, primaryPending] = useActionState(
    setPrimaryOrganizationDomainAction,
    primaryInitialState
  );

  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">
          {ORG_ADMIN_DOMAINS_CARD_COPY.cardTitle}
        </p>
        <p className="text-xs text-stone-400 mt-0.5">{ORG_ADMIN_DOMAINS_CARD_COPY.cardSubtitle}</p>
      </div>

      <div className="px-6 py-5 space-y-5">
        {loadError && (
          <div
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {loadError}
          </div>
        )}

        {/* Add-domain success: render the single-shot DNS-TXT instructions.
            The record_value is shown here ONLY. We do not persist it, log
            it, or expose a "copy again later" affordance — copy now or
            re-add the domain. */}
        {addState.phase === "success" && (
          <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">
              {ORG_ADMIN_DOMAINS_CARD_COPY.challengeIntro.replace("{domain}", addState.domain)}
            </p>
            <p className="mt-1 text-xs text-emerald-900">
              {ORG_ADMIN_DOMAINS_CARD_COPY.challengeShownOnce}
            </p>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="font-medium text-emerald-900">
                {ORG_ADMIN_DOMAINS_CARD_COPY.challengeRecordNameLabel}
              </dt>
              <dd className="font-mono break-all">{addState.challenge.record_name}</dd>
              <dt className="font-medium text-emerald-900">
                {ORG_ADMIN_DOMAINS_CARD_COPY.challengeRecordTypeLabel}
              </dt>
              <dd className="font-mono">{addState.challenge.record_type}</dd>
              <dt className="font-medium text-emerald-900">
                {ORG_ADMIN_DOMAINS_CARD_COPY.challengeRecordValueLabel}
              </dt>
              <dd className="font-mono break-all">{addState.challenge.record_value}</dd>
              <dt className="font-medium text-emerald-900">
                {ORG_ADMIN_DOMAINS_CARD_COPY.challengeExpiresAtLabel}
              </dt>
              <dd className="font-mono">{addState.challenge.expires_at}</dd>
            </dl>
          </output>
        )}

        {addState.phase === "error" && (
          <div
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {addState.error}
          </div>
        )}

        {verifyState.phase === "success" && (
          <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {ORG_ADMIN_DOMAINS_CARD_COPY.verifySuccess.replace("{domain}", verifyState.domain)}
          </output>
        )}
        {verifyState.phase === "error" && (
          <div
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {verifyState.error}
          </div>
        )}

        {removeState.phase === "success" && (
          <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {ORG_ADMIN_DOMAINS_CARD_COPY.removeSuccess.replace("{domain}", removeState.domain)}
          </output>
        )}
        {removeState.phase === "error" && (
          <div
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {removeState.error}
          </div>
        )}

        {primaryState.phase === "success" && (
          <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {ORG_ADMIN_DOMAINS_CARD_COPY.primarySuccess.replace("{domain}", primaryState.domain)}
          </output>
        )}
        {primaryState.phase === "error" && (
          <div
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {primaryState.error}
          </div>
        )}

        {/* Domains list */}
        {domains.length === 0 ? (
          <p className="text-sm text-stone-500">{ORG_ADMIN_DOMAINS_CARD_COPY.emptyState}</p>
        ) : (
          <ul className="space-y-3">
            {domains.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-stone-200 p-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-sky-950">{d.domain}</span>
                    {d.is_primary && (
                      <span className="text-[10px] font-medium uppercase tracking-wide text-sky-700 bg-sky-100 px-2 py-0.5 rounded">
                        {ORG_ADMIN_DOMAINS_CARD_COPY.primaryBadge}
                      </span>
                    )}
                    <span
                      className={[
                        "text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded",
                        d.verified
                          ? "text-emerald-700 bg-emerald-100"
                          : "text-amber-800 bg-amber-100",
                      ].join(" ")}
                    >
                      {d.verified
                        ? ORG_ADMIN_DOMAINS_CARD_COPY.verifiedBadge
                        : ORG_ADMIN_DOMAINS_CARD_COPY.pendingBadge}
                    </span>
                  </div>
                  {!d.verified && d.verification_token_expires_at && (
                    <p className="text-xs text-stone-500">
                      {ORG_ADMIN_DOMAINS_CARD_COPY.challengeExpiresAtLabel}:{" "}
                      <span className="font-mono">{d.verification_token_expires_at}</span>
                    </p>
                  )}
                  {!d.verified && d.verification_attempts > 0 && (
                    <p className="text-xs text-stone-500">
                      {ORG_ADMIN_DOMAINS_CARD_COPY.attemptsLabel}: {d.verification_attempts}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  {/* Verify — only on pending rows */}
                  {!d.verified && (
                    <form action={verifyAction}>
                      <input type="hidden" name="domain_id" value={d.id} />
                      <input type="hidden" name="domain" value={d.domain} />
                      <Button type="submit" loading={verifyPending} size="sm" variant="secondary">
                        {ORG_ADMIN_DOMAINS_CARD_COPY.verifyButton}
                      </Button>
                    </form>
                  )}
                  {/* Set primary — only on verified, non-primary rows */}
                  {d.verified && !d.is_primary && (
                    <form action={primaryAction}>
                      <input type="hidden" name="domain_id" value={d.id} />
                      <input type="hidden" name="domain" value={d.domain} />
                      <Button type="submit" loading={primaryPending} size="sm" variant="secondary">
                        {ORG_ADMIN_DOMAINS_CARD_COPY.setPrimaryButton}
                      </Button>
                    </form>
                  )}
                  {/* Remove — never on primary rows */}
                  {!d.is_primary && (
                    <form action={removeAction}>
                      <input type="hidden" name="domain_id" value={d.id} />
                      <input type="hidden" name="domain" value={d.domain} />
                      <Button type="submit" loading={removePending} size="sm" variant="danger">
                        {ORG_ADMIN_DOMAINS_CARD_COPY.removeButton}
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Add-domain form */}
        <form action={addAction} className="flex flex-col gap-3 border-t border-stone-100 pt-5">
          <label htmlFor="org-admin-add-domain" className="text-sm font-medium text-sky-950">
            {ORG_ADMIN_DOMAINS_CARD_COPY.addLabel}
          </label>
          <p className="text-xs text-stone-500 -mt-2">{ORG_ADMIN_DOMAINS_CARD_COPY.addHelp}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="org-admin-add-domain"
              name="domain"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={ORG_ADMIN_DOMAINS_CARD_COPY.addPlaceholder}
              className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            />
            <Button type="submit" loading={addPending} size="md">
              {addPending
                ? ORG_ADMIN_DOMAINS_CARD_COPY.addingLabel
                : ORG_ADMIN_DOMAINS_CARD_COPY.addButton}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
