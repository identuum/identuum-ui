"use client";

import { SetupLinkPanel } from "@/components/shared/setup-link-panel";
import { useActionState, useState } from "react";
import { type InviteUserState, inviteOrgUserAction } from "./actions";

const initialState: InviteUserState = { phase: "form" };

const inputClass =
  "block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

const inputErrorClass =
  "block w-full rounded-lg border border-red-300 bg-stone-50 px-3 py-2 text-sm text-sky-950 " +
  "font-medium shadow-inner placeholder:text-stone-400 " +
  "focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-colors";

export function InviteUserSection() {
  const [open, setOpen] = useState(false);
  const [state, action, isPending] = useActionState(inviteOrgUserAction, initialState);

  function handleInviteAnother() {
    // Reset the form by re-mounting (action state resets via key)
    window.location.reload();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 shadow-sm transition-colors"
      >
        <span aria-hidden="true">+</span> Invite user
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-[1.5rem] border border-sky-100 bg-sky-50/50 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sky-950">Invite a new member</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
        >
          Cancel
        </button>
      </div>

      {state.phase === "success" ? (
        <div className="space-y-3">
          {state.noEmail ? (
            /* No-email / manual invite: setup link MUST be shared out-of-band */
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">Manual invite — share the setup link</p>
              <p className="text-xs text-stone-600 mt-1">
                No email was provided. Copy this one-time setup link and send it to the
                person out of band (e.g. Slack, SMS). It expires in 24 hours.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-semibold text-emerald-700">Invitation created</p>
              <p className="text-xs text-stone-500 mt-1">
                {state.setupUrl
                  ? "A backup setup link is shown below in case the email doesn't arrive."
                  : "An invitation has been sent to the email address."}
              </p>
            </div>
          )}

          {state.setupUrl && (
            <SetupLinkPanel
              link={state.setupUrl}
              title={state.noEmail ? "Setup link" : "Backup setup link"}
              description={
                state.noEmail
                  ? "Send this one-time link to the invitee out of band (e.g. Slack, SMS). It expires in 24 hours."
                  : "Use this backup link if the invitation email doesn't arrive. It expires in 24 hours."
              }
            />
          )}

          <button
            type="button"
            onClick={handleInviteAnother}
            className="text-xs text-sky-600 hover:text-sky-700 underline"
          >
            Invite another user
          </button>
        </div>
      ) : (
        <form action={action} className="space-y-3">
          {state.phase === "error" && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {state.error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="invite-email" className="block text-xs font-semibold text-stone-600">
              Email{" "}
              <span className="text-stone-400 font-normal">(optional — leave blank to get a link for manual delivery)</span>
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="off"
              placeholder="member@example.com"
              className={state.fieldErrors?.email ? inputErrorClass : inputClass}
            />
            {state.fieldErrors?.email && (
              <p className="text-xs text-red-600">{state.fieldErrors.email}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="invite-name" className="block text-xs font-semibold text-stone-600">
              Display name{" "}
              <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <input
              id="invite-name"
              name="name"
              type="text"
              autoComplete="off"
              placeholder="Jane Smith"
              className={inputClass}
            />
          </div>

          <div className="pt-1 flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60 shadow-sm transition-colors"
            >
              {isPending ? "Generating…" : "Generate setup link"}
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
