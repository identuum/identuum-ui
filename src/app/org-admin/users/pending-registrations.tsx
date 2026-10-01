"use client";

/**
 * D-021: self-registrants held for the organization's approval, each with
 * Approve and Reject. Reject deletes the account, so it asks first.
 */

import { useActionState, useState } from "react";
import { LocalTime } from "@/components/ui/local-time";
import type { PendingRegistration } from "@/lib/idp-registration-client";
import {
  type ApproveRegistrationState,
  approveRegistrationAction,
  type RejectRegistrationState,
  rejectRegistrationAction,
} from "./actions";

export function PendingRegistrations({ registrations }: { registrations: PendingRegistration[] }) {
  if (registrations.length === 0) return null;
  return (
    <section
      data-testid="pending-registrations"
      className="bg-white border border-violet-200 rounded-[1.5rem] shadow-sm overflow-hidden"
    >
      <div className="px-5 py-3 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Sign-ups waiting for approval</p>
        <p className="text-xs text-stone-500 mt-0.5">
          Approve lets the person sign in; reject deletes the account.
        </p>
      </div>
      <ul className="divide-y divide-stone-100">
        {registrations.map((r) => (
          <PendingRow key={r.id} registration={r} />
        ))}
      </ul>
    </section>
  );
}

function PendingRow({ registration: r }: { registration: PendingRegistration }) {
  const [approve, approveAction, approving] = useActionState(approveRegistrationAction, {
    phase: "idle",
  } as ApproveRegistrationState);
  const [reject, rejectAction, rejecting] = useActionState(rejectRegistrationAction, {
    phase: "idle",
  } as RejectRegistrationState);
  const [confirming, setConfirming] = useState(false);
  const done =
    approve.phase === "success" ? "Approved." : reject.phase === "success" ? "Rejected." : null;
  const error =
    approve.phase === "error" ? approve.error : reject.phase === "error" ? reject.error : null;
  const busy = approving || rejecting;
  return (
    <li
      className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap"
      data-testid="pending-registration"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-sky-950 truncate">{r.email}</p>
        <p className="text-xs text-stone-400">
          {r.name ? `${r.name} · ` : ""}
          <LocalTime value={r.created_at} style="date" />
        </p>
      </div>
      {done ? (
        <p className="text-xs font-medium text-emerald-700">{done}</p>
      ) : (
        <div className="flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-xs text-stone-600">Delete this sign-up?</span>
              <form action={rejectAction}>
                <input type="hidden" name="userId" value={r.id} />
                <button
                  type="submit"
                  disabled={busy}
                  className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-2.5 py-1 rounded-lg disabled:opacity-60"
                >
                  {rejecting ? "…" : "Reject"}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs font-medium text-stone-500 hover:text-stone-700"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <form action={approveAction}>
                <input type="hidden" name="userId" value={r.id} />
                <button
                  type="submit"
                  disabled={busy}
                  className="text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 px-2.5 py-1 rounded-lg disabled:opacity-60"
                >
                  {approving ? "…" : "Approve"}
                </button>
              </form>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(true)}
                className="text-xs font-medium text-stone-500 hover:text-red-600"
              >
                Reject…
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </li>
  );
}
