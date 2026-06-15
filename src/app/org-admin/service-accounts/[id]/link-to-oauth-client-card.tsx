"use client";

/**
 * LinkToOAuthClientCard — read+write card on the org-admin service-
 * account detail page. Lets an org_admin select one of their org's
 * registered OAuth clients and link this service account to it.
 *
 * Backend (gograph-verified in slice
 * identuum-20260530-service-account-oauth-client-link-backend):
 *   POST /api/v1/organizations/:id/service-accounts/:sa_id/oauth-clients/:oauth_client_id/link
 *   The mutation is a single column update on
 *   oauth_clients.service_account_id; NO new credential is issued and
 *   NO client secret / client secret_hash / service-account credential
 *   / private-key / token field is part of the response shape.
 *
 * SECURITY invariants (pinned by Vitest):
 *   - The card renders NO client secret / hash / credential / private-
 *     key / token / cookie / session-id surface — only operator-visible
 *     identifiers (client name + OAuth2 client_id string).
 *   - The form's only input is the selected OAuth client UUID; the
 *     serviceAccountId is curried via .bind so the form never carries
 *     it. The action server-side derives the organization id via
 *     getOwnOrganization() — the form never carries an organization_id
 *     either.
 *   - No write to localStorage / sessionStorage / cookies / URL.
 *   - No console.* call anywhere in this file.
 *   - The success-state copy explicitly tells the operator that NO new
 *     secret was issued and that the OAuth client's existing rotate-
 *     secret flow remains on the Applications detail page.
 */

import type { LinkedOAuthClientForServiceAccount } from "@/lib/idp-admin-client";
import type { OrgClientItem } from "@/lib/types";
import { useActionState, useState } from "react";
import {
  type LinkSAToOAuthClientState,
  type UnlinkSAFromOAuthClientState,
  linkServiceAccountToOAuthClientAction,
  unlinkServiceAccountFromOAuthClientAction,
} from "../actions";

const initialState: LinkSAToOAuthClientState = { phase: "idle" };
const initialUnlinkState: UnlinkSAFromOAuthClientState = { phase: "idle" };

const selectClass =
  "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 " +
  "font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 " +
  "transition-colors";

const selectErrorClass =
  "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-xs text-sky-950 " +
  "font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 " +
  "transition-colors";

export interface LinkToOAuthClientCardProps {
  serviceAccountId: string;
  serviceAccountName: string;
  /** All OAuth clients in the org, fetched server-side. May be empty. */
  oauthClients: OrgClientItem[];
  /** True when the server-side fetch failed (forbidden / network / etc.). */
  loadError: boolean;
  /**
   * OAuth clients CURRENTLY linked to this service account, fetched
   * server-side via listServiceAccountOAuthClients (slice
   * identuum-20260530-service-account-linked-clients-read-model-ui).
   * Empty array = nothing is currently linked → card opens on the
   * Form branch. One entry = the persistent linked-state panel
   * renders on first load. Multiple entries = the backend has
   * surfaced an invariant violation (>1 client per SA); the card
   * renders ALL of them with per-row Unlink affordances + an
   * operator-visible note so the situation can be reviewed.
   */
  initialLinkedClients: LinkedOAuthClientForServiceAccount[];
  /** True when the linked-clients server-side fetch failed (forbidden / network / etc.). */
  linkedClientsLoadError: boolean;
}

export function LinkToOAuthClientCard({
  serviceAccountId,
  serviceAccountName,
  oauthClients,
  loadError,
  initialLinkedClients,
  linkedClientsLoadError,
}: LinkToOAuthClientCardProps) {
  const boundAction = linkServiceAccountToOAuthClientAction.bind(null, serviceAccountId);
  const [state, action, pending] = useActionState(boundAction, initialState);
  // The card has multiple branches. Render priority (top → bottom):
  //   1. Link `state.phase === "success"` → SuccessPanel (in-memory
  //      result of a just-completed link mutation; supersedes the
  //      server-rendered initialLinkedClients so the post-link UX is
  //      uninterrupted).
  //   2. Persistent linked-state from the server (initialLinkedClients
  //      is non-empty AND the operator has not yet clicked "Link
  //      another OAuth client" → LinkedStatePanel with per-client
  //      Unlink affordances). Survives hard reload.
  //   3. Linked-clients load-error branch (linkedClientsLoadError true
  //      → safe error message inside the card; the operator can still
  //      navigate, just cannot see/manage links).
  //   4. Form (default).
  //
  // `linkAgainNonce` lets the operator dismiss either the
  // UnlinkSuccessPanel or the persistent linked-state and return to
  // the Form ("Link another OAuth client" button). useActionState
  // cannot be imperatively reset; this local nonce gates the view.
  // The in-memory link `state` survives once the operator has visibly
  // moved past it.
  const [linkAgainNonce, setLinkAgainNonce] = useState(0);

  if (linkAgainNonce > 0) {
    return (
      <CardShell>
        <Form
          serviceAccountName={serviceAccountName}
          oauthClients={oauthClients}
          loadError={loadError}
          state={initialState}
          action={action}
          pending={pending}
        />
      </CardShell>
    );
  }

  if (state.phase === "success") {
    return (
      <CardShell>
        <SuccessPanel
          serviceAccountId={serviceAccountId}
          linked={state.linked}
          onLinkAgain={() => setLinkAgainNonce((n) => n + 1)}
        />
      </CardShell>
    );
  }

  if (initialLinkedClients.length > 0) {
    return (
      <CardShell>
        <LinkedStatePanel
          serviceAccountId={serviceAccountId}
          linkedClients={initialLinkedClients}
          onLinkAgain={() => setLinkAgainNonce((n) => n + 1)}
        />
      </CardShell>
    );
  }

  if (linkedClientsLoadError) {
    return (
      <CardShell>
        <LinkedStateLoadErrorPanel
          serviceAccountName={serviceAccountName}
          oauthClients={oauthClients}
          loadError={loadError}
          state={state}
          action={action}
          pending={pending}
        />
      </CardShell>
    );
  }

  return (
    <CardShell>
      <Form
        serviceAccountName={serviceAccountName}
        oauthClients={oauthClients}
        loadError={loadError}
        state={state}
        action={action}
        pending={pending}
      />
    </CardShell>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-labelledby="link-to-oauth-client-heading"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-stone-100">
        <h2 id="link-to-oauth-client-heading" className="text-sm font-semibold text-sky-950">
          Link to OAuth client
        </h2>
        <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
          Link this service account to an existing OAuth client in your organization so it can issue
          tokens via the client_credentials grant. No new credential is issued by linking or
          unlinking — the OAuth client{"'"}s existing client secret continues to be the
          authentication credential, and its rotation flow remains on the Applications detail page.
        </p>
      </div>
      {children}
    </section>
  );
}

function Form({
  serviceAccountName,
  oauthClients,
  loadError,
  state,
  action,
  pending,
}: {
  serviceAccountName: string;
  oauthClients: OrgClientItem[];
  loadError: boolean;
  state: LinkSAToOAuthClientState;
  action: (payload: FormData) => void;
  pending: boolean;
}) {
  const errorMessage = state.phase === "error" ? state.error : null;
  const fieldErrors = state.phase === "error" ? (state.fieldErrors ?? {}) : {};

  if (loadError) {
    return (
      <div className="px-6 py-5">
        <p className="text-xs text-red-600 leading-relaxed">
          Could not load your organization{"'"}s OAuth clients. Reload the page or try again later.
        </p>
      </div>
    );
  }

  if (oauthClients.length === 0) {
    return (
      <div className="px-6 py-5 space-y-3">
        <p className="text-xs text-stone-500 leading-relaxed">
          No OAuth clients are registered in your organization yet. Create one before you can link
          this service account.
        </p>
        <a
          href="/org-admin/applications/new"
          className="inline-flex items-center rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Create OAuth client
        </a>
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
        <label htmlFor="link-oauth-client-id" className="block text-xs font-medium text-sky-950">
          OAuth client
        </label>
        <select
          id="link-oauth-client-id"
          name="oauth_client_id"
          required
          defaultValue=""
          disabled={pending}
          className={fieldErrors.oauth_client_id ? selectErrorClass : selectClass}
        >
          <option value="" disabled>
            Select an OAuth client
          </option>
          {oauthClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.client_id})
            </option>
          ))}
        </select>
        {fieldErrors.oauth_client_id && (
          <p className="text-xs text-red-600">{fieldErrors.oauth_client_id}</p>
        )}
        <p className="text-[10px] text-stone-400 leading-relaxed">
          Linking this service account to the selected OAuth client makes the client{"'"}s{" "}
          <span className="font-mono">client_credentials</span> grant resolve{" "}
          <strong>{serviceAccountName}</strong>
          {"'"}s role and scopes. Selecting a different client later changes the binding; the OAuth
          client{"'"}s existing secret is not affected.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          {pending ? "Linking…" : "Link to OAuth client"}
        </button>
      </div>
    </form>
  );
}

function SuccessPanel({
  serviceAccountId,
  linked,
  onLinkAgain,
}: {
  serviceAccountId: string;
  linked: {
    organization_id: string;
    service_account_id: string;
    oauth_client_uuid: string;
    oauth_client_identifier: string;
  };
  onLinkAgain: () => void;
}) {
  // Bind both ids onto the unlink action so the form never carries
  // either UUID; the operator only confirms the "UNLINK" literal.
  const boundUnlink = unlinkServiceAccountFromOAuthClientAction.bind(
    null,
    serviceAccountId,
    linked.oauth_client_uuid
  );
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(
    boundUnlink,
    initialUnlinkState
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (unlinkState.phase === "success") {
    return <UnlinkSuccessPanel unlinked={unlinkState.unlinked} onLinkAgain={onLinkAgain} />;
  }

  const errorMessage = unlinkState.phase === "error" ? unlinkState.error : null;
  const fieldErrors = unlinkState.phase === "error" ? (unlinkState.fieldErrors ?? {}) : {};

  return (
    <div className="px-6 py-5 space-y-4">
      <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 space-y-1.5">
        <p className="font-semibold">Service account linked to OAuth client.</p>
        <p className="text-xs leading-relaxed">
          No new secret was issued. The OAuth client{"'"}s existing client secret continues to
          authenticate; its rotation flow is on the Applications detail page.
        </p>
      </output>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Link details</p>
        </div>
        <dl className="px-6 py-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="font-medium text-stone-500">OAuth client</dt>
          <dd className="font-mono text-sky-950 break-all">{linked.oauth_client_identifier}</dd>
          <dt className="font-medium text-stone-500">OAuth client UUID</dt>
          <dd className="font-mono text-sky-950 break-all">{linked.oauth_client_uuid}</dd>
        </dl>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <a
          href={`/org-admin/applications/${encodeURIComponent(linked.oauth_client_uuid)}`}
          className="inline-flex items-center rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Open Application detail →
        </a>
      </div>

      {/* Unlink subform — confirmation gate ("UNLINK" literal) lives
          server-side too (the action re-checks it). Two-step expand
          so a single click cannot send the destructive call. */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Unlink OAuth client</p>
          <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
            Sets the OAuth client{"'"}s service account binding back to empty. No new credential is
            issued and the OAuth client{"'"}s existing client secret is not affected — only the
            client_credentials grant{"'"}s resolution of this service account is removed.
          </p>
        </div>
        {confirmOpen ? (
          <form action={unlinkAction} className="px-6 py-5 space-y-4">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
              >
                {errorMessage}
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="unlink-confirm" className="block text-xs font-medium text-sky-950">
                Type UNLINK to confirm
              </label>
              <input
                id="unlink-confirm"
                name="confirm"
                type="text"
                autoComplete="off"
                required
                disabled={unlinkPending}
                className={
                  fieldErrors.confirm
                    ? "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors"
                    : "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors"
                }
              />
              {fieldErrors.confirm && <p className="text-xs text-red-600">{fieldErrors.confirm}</p>}
              <p className="text-[10px] text-stone-400 leading-relaxed">
                Typing UNLINK and submitting removes the binding between this service account and{" "}
                <strong className="font-mono">{linked.oauth_client_identifier}</strong>.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={unlinkPending}
                className="inline-flex items-center justify-center rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
              >
                {unlinkPending ? "Unlinking…" : "Unlink OAuth client"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={unlinkPending}
                className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-stone-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="px-6 py-5">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
            >
              Unlink OAuth client
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function UnlinkSuccessPanel({
  unlinked,
  onLinkAgain,
}: {
  unlinked: {
    organization_id: string;
    service_account_id: string;
    previously_linked_oauth_client_uuid: string;
    previously_linked_oauth_client_identifier: string;
  };
  onLinkAgain: () => void;
}) {
  return (
    <div className="px-6 py-5 space-y-4">
      <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 space-y-1.5">
        <p className="font-semibold">OAuth client unlinked.</p>
        <p className="text-xs leading-relaxed">
          No new credential was issued and the OAuth client{"'"}s existing client secret is
          unchanged — only the binding between this service account and the OAuth client was
          removed.
        </p>
      </output>

      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-sky-950">Unlink details</p>
        </div>
        <dl className="px-6 py-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="font-medium text-stone-500">Previously linked OAuth client</dt>
          <dd className="font-mono text-sky-950 break-all">
            {unlinked.previously_linked_oauth_client_identifier}
          </dd>
          <dt className="font-medium text-stone-500">OAuth client UUID</dt>
          <dd className="font-mono text-sky-950 break-all">
            {unlinked.previously_linked_oauth_client_uuid}
          </dd>
        </dl>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onLinkAgain}
          className="inline-flex items-center rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Link another OAuth client
        </button>
        <a
          href={`/org-admin/applications/${encodeURIComponent(unlinked.previously_linked_oauth_client_uuid)}`}
          className="inline-flex items-center rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Open Application detail →
        </a>
      </div>
    </div>
  );
}

// ── Persistent linked-state UI (slice identuum-20260530-service-account-linked-clients-read-model-ui) ──

function LinkedStatePanel({
  serviceAccountId,
  linkedClients,
  onLinkAgain,
}: {
  serviceAccountId: string;
  linkedClients: LinkedOAuthClientForServiceAccount[];
  onLinkAgain: () => void;
}) {
  // multiple-linked-clients note. The backend deliberately surfaces an
  // invariant violation (>1 client per SA) rather than silently
  // hiding it; the UI mirrors that operator-visibility posture.
  const violation = linkedClients.length > 1;
  return (
    <div className="px-6 py-5 space-y-4">
      <output className="block rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 space-y-1.5">
        <p className="font-semibold">
          {linkedClients.length === 1
            ? "Currently linked OAuth client."
            : `Currently linked OAuth clients (${linkedClients.length}).`}
        </p>
        <p className="text-xs leading-relaxed">
          {violation
            ? "More than one OAuth client is currently linked to this service account. This is unexpected — review each row below; you can unlink each individually. No new credential was issued and the OAuth clients' existing client secrets are unchanged."
            : "No new credential was issued and the OAuth client's existing client secret is unchanged. The OAuth client's rotation flow remains on the Applications detail page."}
        </p>
      </output>

      <ul className="space-y-3">
        {linkedClients.map((c) => (
          <PersistentLinkedClientRow key={c.id} serviceAccountId={serviceAccountId} client={c} />
        ))}
      </ul>

      <div className="flex items-center gap-3 flex-wrap pt-1">
        <button
          type="button"
          onClick={onLinkAgain}
          className="inline-flex items-center rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
        >
          Link another OAuth client
        </button>
      </div>
    </div>
  );
}

function PersistentLinkedClientRow({
  serviceAccountId,
  client,
}: {
  serviceAccountId: string;
  client: LinkedOAuthClientForServiceAccount;
}) {
  // Each row owns its own unlink action state so unlinking one client
  // does not affect the others when multiple are linked (invariant
  // violation case). After successful unlink the row collapses to a
  // small "Unlinked." confirmation; the operator can refresh to fully
  // reconcile the linked-state list. We do NOT mutate the parent's
  // initialLinkedClients prop from the row — that would require
  // hoisting state and contradict the server-driven model. A future
  // slice could replace the post-unlink confirmation with a
  // router.refresh() if the operator pattern demands it.
  const boundUnlink = unlinkServiceAccountFromOAuthClientAction.bind(
    null,
    serviceAccountId,
    client.id
  );
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(
    boundUnlink,
    initialUnlinkState
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (unlinkState.phase === "success") {
    return (
      <li>
        <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 space-y-1.5">
          <p className="font-semibold">OAuth client unlinked.</p>
          <p className="text-[11px] leading-relaxed">
            <span className="font-mono">{client.client_id}</span> was unlinked. No new credential
            was issued. Reload the page or click <em>Link another OAuth client</em> to manage links
            again.
          </p>
        </output>
      </li>
    );
  }

  const errorMessage = unlinkState.phase === "error" ? unlinkState.error : null;
  const fieldErrors = unlinkState.phase === "error" ? (unlinkState.fieldErrors ?? {}) : {};

  return (
    <li className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 space-y-1">
        <p className="text-sm font-semibold text-sky-950 break-all">{client.name}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[11px]">
          <dt className="font-medium text-stone-500">OAuth client</dt>
          <dd className="font-mono text-sky-950 break-all">{client.client_id}</dd>
          <dt className="font-medium text-stone-500">OAuth client UUID</dt>
          <dd className="font-mono text-sky-950 break-all">{client.id}</dd>
          <dt className="font-medium text-stone-500">Visibility</dt>
          <dd className="text-sky-950">{client.is_public ? "Public" : "Confidential"}</dd>
          <dt className="font-medium text-stone-500">Status</dt>
          <dd className="text-sky-950">{client.active ? "Active" : "Inactive"}</dd>
        </dl>
      </div>
      <div className="px-6 py-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href={`/org-admin/applications/${encodeURIComponent(client.id)}`}
            className="inline-flex items-center rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
          >
            Open Application detail →
          </a>
          {!confirmOpen && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
            >
              Unlink OAuth client
            </button>
          )}
        </div>
        {confirmOpen && (
          <form action={unlinkAction} className="space-y-3 pt-2">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600"
              >
                {errorMessage}
              </div>
            )}
            <div className="space-y-1">
              <label
                htmlFor={`unlink-confirm-${client.id}`}
                className="block text-xs font-medium text-sky-950"
              >
                Type UNLINK to confirm
              </label>
              <input
                id={`unlink-confirm-${client.id}`}
                name="confirm"
                type="text"
                autoComplete="off"
                required
                disabled={unlinkPending}
                className={
                  fieldErrors.confirm
                    ? "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors"
                    : "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors"
                }
              />
              {fieldErrors.confirm && (
                <p className="text-[11px] text-red-600">{fieldErrors.confirm}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={unlinkPending}
                className="inline-flex items-center justify-center rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
              >
                {unlinkPending ? "Unlinking…" : "Unlink OAuth client"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={unlinkPending}
                className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-stone-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

function LinkedStateLoadErrorPanel({
  serviceAccountName,
  oauthClients,
  loadError,
  state,
  action,
  pending,
}: {
  serviceAccountName: string;
  oauthClients: OrgClientItem[];
  loadError: boolean;
  state: LinkSAToOAuthClientState;
  action: (payload: FormData) => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-0">
      <div
        role="alert"
        className="mx-6 mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed"
      >
        Could not load the OAuth clients currently linked to this service account. The link form
        below still works for new links; existing links may not be shown. Reload the page to try
        again.
      </div>
      <Form
        serviceAccountName={serviceAccountName}
        oauthClients={oauthClients}
        loadError={loadError}
        state={state}
        action={action}
        pending={pending}
      />
    </div>
  );
}
