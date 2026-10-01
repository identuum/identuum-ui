"use client";

/**
 * D-021: the instance self-registration switch — the ceiling every
 * organization's own sign-up setting sits under. Off by default.
 */

import { useActionState } from "react";
import {
  type InstanceRegistrationState,
  setInstanceRegistrationAction,
} from "./self-registration-actions";

export function SelfRegistrationCard({ enabled }: { enabled: boolean | null }) {
  const [state, action, pending] = useActionState(setInstanceRegistrationAction, {
    enabled: enabled === true,
  } as InstanceRegistrationState);
  return (
    <div
      data-testid="instance-self-registration"
      className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-5 space-y-3"
    >
      <div>
        <p className="text-sm font-semibold text-sky-950">Self-registration</p>
        <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
          When on, each organization&apos;s administrator may let people sign up for it; when off,
          no organization accepts sign-ups.
        </p>
      </div>
      {enabled === null ? (
        <p className="text-xs text-stone-500">The setting could not be read.</p>
      ) : (
        <form action={action} className="flex items-center gap-3">
          <input type="hidden" name="enabled" value={state.enabled ? "false" : "true"} />
          <span className="text-xs font-medium text-sky-950">{state.enabled ? "On" : "Off"}</span>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-950 hover:bg-stone-50 disabled:opacity-60 shadow-sm"
          >
            {state.enabled ? "Turn off" : "Turn on"}
          </button>
        </form>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}
    </div>
  );
}
