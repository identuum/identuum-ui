"use client";

/**
 * Bulk invite drawer.
 *
 * Operator pastes one row per line in the format "email,Display Name" (or
 * tab-separated). Up to 50 rows per batch. The server action enqueues a
 * background job; the UI then surfaces a "Check status" button that polls
 * GET /api/v1/jobs/:id on demand.
 *
 * SECURITY: the bulk_user_create result returns one-time activation tokens
 * per row. The wire helper (getBulkJobStatus) projects each token into a
 * server-built setup URL and immediately discards the raw token, so this
 * component never sees the token directly — only the projected URL.
 *
 * Setup URLs surface ONLY in this component's result panel, ONE TIME, via the
 * shared SetupLinkPanel primitive. They are not persisted to localStorage,
 * sessionStorage, cookies, URLs, or any other client-side store. They are
 * not auto-copied. They are not logged. The operator has to click the panel's
 * copy button to copy each link.
 */

import { useActionState, useState } from "react";
import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import {
  type BulkInviteState,
  bulkInviteUsersAction,
  type RefreshBulkJobState,
  refreshBulkJobAction,
} from "./actions";

const initialFormState: BulkInviteState = { phase: "form" };
const initialJobState: RefreshBulkJobState = { phase: "idle" };

const textareaClass =
  "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-mono shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const textareaErrorClass =
  "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-mono shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

export function BulkInviteSection() {
  const [open, setOpen] = useState(false);
  const [formState, formAction, formPending] = useActionState(
    bulkInviteUsersAction,
    initialFormState
  );
  const [jobState, jobAction, jobPending] = useActionState(refreshBulkJobAction, initialJobState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 shadow-sm transition-colors"
      >
        Bulk invite
      </button>
    );
  }

  const queuedJobId = formState.phase === "queued" ? formState.jobId : undefined;
  const job = jobState.phase === "loaded" ? jobState.job : undefined;
  const jobResults = job?.result?.results ?? [];
  const stillProcessing = !!job && (job.status === "queued" || job.status === "running");

  return (
    <div className="mt-4 rounded-[1.5rem] border border-sky-100 bg-sky-50/50 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sky-950">Bulk invite</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
        >
          Close
        </button>
      </div>

      {formState.phase === "queued" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-700">Job queued</p>
            <p className="text-xs text-stone-500 mt-1">
              {formState.entries} {formState.entries === 1 ? "row" : "rows"} accepted. The backend
              creates these users in the background. Click below to refresh status.
            </p>
            <p className="text-[10px] text-stone-400 mt-1 font-mono break-all">
              Job ID: {formState.jobId}
            </p>
          </div>

          <form action={jobAction} className="flex items-center gap-2">
            <input type="hidden" name="jobId" value={queuedJobId ?? ""} />
            <button
              type="submit"
              disabled={jobPending}
              className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
            >
              {jobPending ? "Checking…" : job ? "Refresh status" : "Check status"}
            </button>
            {job && (
              <span className="text-xs text-stone-500">
                Status: <span className="font-semibold text-sky-950">{job.status}</span>
              </span>
            )}
          </form>

          {jobState.phase === "error" && jobState.error && (
            <p className="text-xs text-red-600">{jobState.error}</p>
          )}

          {jobState.phase === "loaded" && jobState.warning && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              {jobState.warning}
            </div>
          )}

          {job?.result && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs text-stone-600">
                <span>
                  Created:{" "}
                  <span className="font-semibold text-emerald-700">{job.result.created}</span>
                </span>
                <span className="text-stone-300">·</span>
                <span>
                  Failed: <span className="font-semibold text-red-600">{job.result.failed}</span>
                </span>
                <span className="text-stone-300">·</span>
                <span>
                  Total: <span className="font-semibold text-sky-950">{job.result.total}</span>
                </span>
              </div>
              <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
                {jobResults.map((row, idx) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: bulk rows have no stable client key
                    key={idx}
                    className="px-4 py-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-sky-950 truncate">{row.email}</p>
                        {row.name && (
                          <p className="text-[10px] text-stone-400 truncate">{row.name}</p>
                        )}
                      </div>
                      {row.success ? (
                        <span className="shrink-0 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Created
                        </span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                          Failed
                        </span>
                      )}
                    </div>
                    {row.success && row.setup_url && (
                      <SetupLinkPanel
                        link={row.setup_url}
                        title="One-time setup link"
                        description="Share this link with the invitee out of band. It expires in 24 hours."
                        compact
                      />
                    )}
                    {!row.success && row.error_message && (
                      <p className="text-[10px] text-red-600 leading-tight">{row.error_message}</p>
                    )}
                  </li>
                ))}
              </ul>
              {stillProcessing && (
                <p className="text-[10px] text-stone-400 italic">
                  The job is still running. Click "Refresh status" again in a moment.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <form action={formAction} className="space-y-3">
          {formState.phase === "error" && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {formState.error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="bulk-entries" className="block text-xs font-semibold text-stone-600">
              Entries{" "}
              <span className="text-stone-400 font-normal">
                (one per line — format "email,Display Name" — up to 50)
              </span>
            </label>
            <textarea
              id="bulk-entries"
              name="entries"
              rows={6}
              spellCheck={false}
              autoComplete="off"
              placeholder={"alice@example.com,Alice Example\nbob@example.com,Bob Example"}
              className={formState.fieldErrors?.entries ? textareaErrorClass : textareaClass}
            />
            {formState.fieldErrors?.entries && (
              <p className="text-xs text-red-600">{formState.fieldErrors.entries}</p>
            )}
          </div>

          <div className="pt-1 flex gap-2">
            <button
              type="submit"
              disabled={formPending}
              className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
            >
              {formPending ? "Sending…" : "Send invites"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
