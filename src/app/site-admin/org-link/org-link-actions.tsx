"use client";

/**
 * Client component for AG org link/unlink actions.
 * Uses server actions from ./actions.ts via form submission.
 *
 * Security: no internal AG URLs, tokens, or secrets are included here.
 * Organization-only: renders org names only, no user/admin/credential data.
 */

import { useActionState } from "react";
import { linkOrgAction, unlinkOrgAction, importOrgAction, importAllOrgsAction } from "./actions";
import type { IDPOrgSummaryForLink, AGOrgSummaryWithLink, ImportAllBatchResult, OrgLinkWriteResult } from "@/lib/org-link-types";

interface OrgLinkActionsProps {
  agOrgs: AGOrgSummaryWithLink[];
  idpOrgs: IDPOrgSummaryForLink[];
  canAct: boolean;
}

interface IDPImportSectionProps {
  idpOrgs: IDPOrgSummaryForLink[];
  linkedIDPOrgIds: Set<string>;
  canAct: boolean;
}

const initialState: OrgLinkWriteResult = { ok: false };

function LinkForm({
  agOrg,
  idpOrgs,
  disabled,
}: {
  agOrg: AGOrgSummaryWithLink;
  idpOrgs: IDPOrgSummaryForLink[];
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: OrgLinkWriteResult, formData: FormData) => {
      const idpOrgId = formData.get("idp_org_id") as string;
      return linkOrgAction(agOrg.id, idpOrgId);
    },
    initialState
  );

  const eligibleIDP = idpOrgs.filter((o) => o.active && !o.deleted);

  return (
    <form action={action} className="flex items-center gap-2 flex-wrap">
      <select
        name="idp_org_id"
        disabled={disabled || pending || eligibleIDP.length === 0}
        required
        className="text-xs rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
      >
        <option value="">Select IDP org…</option>
        {eligibleIDP.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} {o.domain ? `(${o.domain})` : ""}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={disabled || pending}
        className="text-xs rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? "Linking…" : "Link"}
      </button>
      {state.ok === false && state.error_code && (
        <ActionError errorCode={state.error_code} message={state.message} />
      )}
      {state.ok && (
        <span className="text-xs text-emerald-600">Linked.</span>
      )}
    </form>
  );
}

function ActionError({ errorCode, message }: { errorCode: string; message?: string }) {
  if (errorCode === "ag_auth_required") {
    return (
      <span className="text-xs text-amber-600">
        AG operator login required. Sign in to AG and try again.
      </span>
    );
  }
  if (errorCode === "ag_forbidden") {
    return (
      <span className="text-xs text-red-600">
        AG access denied. Check your AG operator permissions.
      </span>
    );
  }
  return <span className="text-xs text-red-600">{message ?? errorCode}</span>;
}

function UnlinkForm({
  agOrg,
  idpOrgs,
  disabled,
}: {
  agOrg: AGOrgSummaryWithLink;
  idpOrgs: IDPOrgSummaryForLink[];
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: OrgLinkWriteResult) => {
      return unlinkOrgAction(agOrg.id);
    },
    initialState
  );

  const linkedIDPOrg = agOrg.linked_idp_org_id
    ? idpOrgs.find((o) => o.id === agOrg.linked_idp_org_id)
    : undefined;

  const linkedLabel = linkedIDPOrg
    ? `${linkedIDPOrg.name}${linkedIDPOrg.domain ? ` (${linkedIDPOrg.domain})` : ""}`
    : null;

  return (
    <form action={action} className="flex items-center gap-2 flex-wrap">
      {linkedLabel ? (
        <span className="text-xs text-stone-600 truncate max-w-[200px]">{linkedLabel}</span>
      ) : (
        <span className="text-xs text-stone-400 font-mono truncate max-w-[140px]" title={agOrg.linked_idp_org_id ?? undefined}>
          {agOrg.linked_idp_org_id?.slice(0, 8)}…
          <span className="ml-1 text-stone-400">(not in IDP)</span>
        </span>
      )}
      <button
        type="submit"
        disabled={disabled || pending}
        className="text-xs rounded-lg border border-stone-200 bg-white px-3 py-1.5 font-medium text-stone-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? "Unlinking…" : "Unlink"}
      </button>
      {state.ok === false && state.error_code && (
        <ActionError errorCode={state.error_code} message={state.message} />
      )}
      {state.ok && (
        <span className="text-xs text-emerald-600">Unlinked.</span>
      )}
    </form>
  );
}

export function OrgLinkActions({ agOrgs, idpOrgs, canAct }: OrgLinkActionsProps) {
  if (agOrgs.length === 0) {
    return <p className="text-xs text-stone-400">No AG organizations found.</p>;
  }

  return (
    <div className="space-y-3">
      {agOrgs.map((agOrg) => (
        <div
          key={agOrg.id}
          className="rounded-xl border border-stone-200 bg-white p-4 space-y-2"
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                agOrg.status === "active" ? "bg-emerald-500" : "bg-stone-300"
              }`}
            />
            <p className="text-sm font-medium text-sky-950">
              {agOrg.display_name || agOrg.name}
            </p>
            <span
              className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ml-auto ${
                agOrg.link_status === "linked"
                  ? "bg-sky-100 text-sky-700"
                  : "bg-stone-100 text-stone-500"
              }`}
            >
              {agOrg.link_status}
            </span>
          </div>

          {!canAct ? (
            <p className="text-xs text-stone-400">
              Link/unlink unavailable — requires IDP, AG, and an active AG operator session.
            </p>
          ) : agOrg.link_status === "linked" ? (
            <UnlinkForm agOrg={agOrg} idpOrgs={idpOrgs} disabled={false} />
          ) : (
            <LinkForm agOrg={agOrg} idpOrgs={idpOrgs} disabled={idpOrgs.length === 0} />
          )}
        </div>
      ))}
    </div>
  );
}

function ImportForm({
  idpOrg,
  disabled,
}: {
  idpOrg: IDPOrgSummaryForLink;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: OrgLinkWriteResult, formData: FormData) => {
      const name = (formData.get("ag_name") as string) || idpOrg.name;
      return importOrgAction(idpOrg.id, name);
    },
    initialState
  );

  return (
    <form action={action} className="flex items-center gap-2 flex-wrap">
      <input
        type="text"
        name="ag_name"
        defaultValue={idpOrg.name}
        disabled={disabled || pending}
        placeholder="AG org name"
        className="text-xs rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-stone-700 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50 w-48"
      />
      <button
        type="submit"
        disabled={disabled || pending}
        className="text-xs rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? "Importing…" : "Import into AG"}
      </button>
      {state.ok === false && state.error_code && (
        <ActionError errorCode={state.error_code} message={state.message} />
      )}
      {state.ok && (
        <span className="text-xs text-emerald-600">Imported and linked.</span>
      )}
    </form>
  );
}

const initialBatchResult: ImportAllBatchResult = { ok: false, imported: 0, skipped: 0, failed: 0, message: "" };

function ImportAllForm({
  displayCount,
  disabled,
}: {
  /** Display-only count for the button label. Server re-derives candidates independently. */
  displayCount: number;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: ImportAllBatchResult) => importAllOrgsAction(),
    initialBatchResult
  );

  const hasResult = state.imported > 0 || state.skipped > 0 || state.failed > 0;

  return (
    <form action={action} className="flex items-center gap-3 flex-wrap">
      <button
        type="submit"
        disabled={disabled || pending || displayCount === 0}
        className="text-xs rounded-lg bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending
          ? "Importing…"
          : `Import all ${displayCount} organizations into AG`}
      </button>
      <span className="text-[10px] text-stone-400">
        Organizations only — no users, admins, or roles.
      </span>
      {hasResult && (
        <span className={`text-xs ${state.ok ? "text-emerald-600" : "text-red-600"}`}>
          {state.message}
        </span>
      )}
      {!hasResult && state.error_code && (
        <ActionError errorCode={state.error_code} message={state.message} />
      )}
    </form>
  );
}

export function IDPImportSection({ idpOrgs, linkedIDPOrgIds, canAct }: IDPImportSectionProps) {
  const unlinkedIDPOrgs = idpOrgs.filter(
    (o) => o.active && !o.deleted && !linkedIDPOrgIds.has(o.id)
  );

  if (unlinkedIDPOrgs.length === 0) {
    return (
      <p className="text-xs text-stone-400">
        All active IDP organizations are already linked to AG organizations.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {canAct && unlinkedIDPOrgs.length > 1 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-xs font-medium text-sky-800 mb-2">
            Import all {unlinkedIDPOrgs.length} unlinked organizations at once
          </p>
          <ImportAllForm displayCount={unlinkedIDPOrgs.length} disabled={false} />
        </div>
      )}
      <div className="space-y-3">
      {unlinkedIDPOrgs.map((idpOrg) => (
        <div
          key={idpOrg.id}
          className="rounded-xl border border-stone-200 bg-white p-4 space-y-2"
        >
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-stone-300" />
            <p className="text-sm font-medium text-sky-950">{idpOrg.name}</p>
            {idpOrg.domain && (
              <span className="text-xs text-stone-400">{idpOrg.domain}</span>
            )}
            <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ml-auto bg-stone-100 text-stone-500">
              not in AG
            </span>
          </div>

          {!canAct ? (
            <p className="text-xs text-stone-400">
              Import unavailable — requires IDP, AG, and an active AG operator session.
            </p>
          ) : (
            <ImportForm idpOrg={idpOrg} disabled={false} />
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
