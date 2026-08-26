"use client";

import { useActionState, useEffect, useState } from "react";
import type { AgPolicyPackSettings } from "@/lib/types";
import {
  type UpdatePolicyPackSettingsActionState,
  updatePolicyPackSettingsAction,
} from "./policy-pack-settings-actions";

interface PolicyPackSettingsPanelProps {
  /**
   * Null when the AG backend is unavailable or returned an error.
   * The panel renders a non-crashing degraded state in this case.
   */
  initialSettings: AgPolicyPackSettings | null;
}

const initialState: UpdatePolicyPackSettingsActionState = {};

/**
 * Interactive panel for AG operators to view and toggle PolicyPacks enforcement.
 *
 * UX contract:
 *   - Shows current policy_packs_enabled state from the AG backend.
 *   - Provides a toggle + Save button; Save calls the server action which
 *     calls PATCH /api/v1/policy-packs/settings.
 *   - Explains that a 503 from the AG backend means fail-closed enforcement,
 *     not the same as the operator having disabled PolicyPacks.
 *   - On AG unavailable (initialSettings=null), renders a non-crashing
 *     informational note.
 *   - Does NOT imply CE/commercial PolicyPacks features are available.
 *   - Does NOT expose tokens, secrets, or credential material.
 */
export function PolicyPackSettingsPanel({ initialSettings }: PolicyPackSettingsPanelProps) {
  const [state, action, isPending] = useActionState(updatePolicyPackSettingsAction, initialState);

  const [enabled, setEnabled] = useState(initialSettings?.policy_packs_enabled ?? true);
  const [displayedSettings, setDisplayedSettings] = useState<AgPolicyPackSettings | null>(
    initialSettings
  );

  useEffect(() => {
    if (state.ok && state.settings) {
      setDisplayedSettings(state.settings);
      setEnabled(state.settings.policy_packs_enabled);
    }
  }, [state.ok, state.settings]);

  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">PolicyPacks settings</p>
        <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
          Controls whether PolicyPacks enforcement is active for the organization associated with
          your current AG operator session.
        </p>
      </div>

      {initialSettings === null ? (
        <div className="px-6 py-5">
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700 leading-relaxed">
            <strong>PolicyPacks settings unavailable.</strong> The AG backend could not return
            current settings. If the AG returned a 503, enforcement is fail-closed — PolicyPacks is
            enforced, not disabled. This is not the same as setting PolicyPacks to disabled. Check
            that identuum-ag is running and accessible.
          </div>
        </div>
      ) : (
        <div className="px-6 py-5 space-y-5">
          {/* Fail-closed note */}
          <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
            <p className="text-xs text-sky-700 leading-relaxed">
              <strong>Note on 503 errors.</strong> If the AG backend encounters an error reading
              settings, it responds with 503 and continues enforcing PolicyPacks (fail-closed). A
              503 is not the same as the operator setting PolicyPacks to disabled — only this toggle
              disables enforcement.
            </p>
          </div>

          <form action={action} className="space-y-4">
            <input type="hidden" name="policy_packs_enabled" value={String(enabled)} />

            {/* Toggle */}
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => setEnabled((v) => !v)}
                  disabled={isPending}
                  aria-label="PolicyPacks enforcement enabled"
                  className={`relative inline-flex h-5 w-9 items-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                    enabled ? "bg-sky-600 border-sky-600" : "bg-stone-200 border-stone-200"
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      enabled ? "translate-x-3.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              <div>
                <p className="text-xs font-semibold text-sky-950">PolicyPacks enforcement</p>
                <p className="text-xs text-stone-500 leading-relaxed mt-0.5">
                  {displayedSettings?.policy_packs_enabled
                    ? "Enabled — PolicyPacks are currently enforced for this organization."
                    : "Disabled — PolicyPacks enforcement is off for this organization."}
                </p>
              </div>
            </div>

            {/* Error banner */}
            {state.error && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-600">
                {state.error}
              </div>
            )}

            {/* Success banner */}
            {state.ok && (
              <output className="block rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-medium">
                PolicyPacks settings saved.
              </output>
            )}

            {/* Save button */}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl h-8 px-4 text-xs font-semibold bg-sky-600 text-white hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPending && (
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                {isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
