"use client";

import { useActionState } from "react";
import { InviteIssuedPanel } from "@/components/shared/invite-issued-panel";
import { Button } from "@/components/ui/button";
import { type InviteUserState, inviteUserAction } from "../actions";

const initialState: InviteUserState = { phase: "form" };

const inputCls =
  "block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-sky-950 font-medium shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-colors";

export function InviteUserForm() {
  const [state, formAction, isPending] = useActionState(inviteUserAction, initialState);

  if (state.phase === "issued") {
    return (
      <div className="space-y-4">
        <InviteIssuedPanel invite={state.invite} />
        <div className="flex items-center gap-3">
          <a
            href="/org-admin/users"
            className="text-sm font-semibold text-sky-700 hover:text-sky-900 underline"
          >
            Back to users
          </a>
          <a
            href="/org-admin/users/new"
            className="text-sm font-semibold text-sky-700 hover:text-sky-900 underline"
          >
            Invite another
          </a>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {state.error}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="invite-email" className="block text-sm font-semibold text-stone-700">
          Email
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          className={inputCls}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="invite-name" className="block text-sm font-semibold text-stone-700">
          Name
        </label>
        <input id="invite-name" name="name" type="text" required className={inputCls} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="invite-role" className="block text-sm font-semibold text-stone-700">
          Role
        </label>
        <select id="invite-role" name="role" defaultValue="org_user" className={inputCls}>
          <option value="org_user">Member</option>
          <option value="org_admin">Admin</option>
        </select>
      </div>
      <Button type="submit" loading={isPending} disabled={isPending}>
        {isPending ? "Inviting…" : "Invite user"}
      </Button>
    </form>
  );
}
