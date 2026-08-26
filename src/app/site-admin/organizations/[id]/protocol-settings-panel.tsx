"use client";

import { useActionState, useEffect, useState } from "react";
import type { AuthorizationServerPageBoundary } from "@/lib/capability-affordances";
import type { GetOrgProtocolSettingsResult, OrgProtocolSettings } from "@/lib/types";
import {
  type UpdateProtocolSettingsActionState,
  updateProtocolSettingsAction,
} from "./protocol-settings-actions";
import {
  formatSettingsSource,
  isDefaultUnset,
  protocolSettingsLoadErrorMessage,
} from "./protocol-settings-helpers";

interface ProtocolSettingsPanelProps {
  capabilityBoundary?: AuthorizationServerPageBoundary | null;
  orgId: string;
  /**
   * Null when the org ID is not available (org-admin page before session resolves).
   * ok=false when the IDP returned an error — the panel renders a per-reason message.
   */
  initialSettings: GetOrgProtocolSettingsResult | null;
}

const initialState: UpdateProtocolSettingsActionState = {};

/**
 * Interactive panel for site_admin to view and update an organization's
 * per-org protocol availability.
 *
 * UX contract:
 *   - Shows current enabled/disabled state for each protocol.
 *   - Shows whether settings are explicit (operator-configured) or default.
 *   - Provides checkboxes + Save button. Save calls the server action which
 *     calls PUT /api/v1/organizations/:id/protocol-settings.
 *   - On IDP unavailable (initialSettings=null), renders a non-crashing
 *     informational note instead of crashing the organization detail page.
 *   - Does NOT suggest anonymous public DCR.
 *   - Presents SCIM 2.0 as Enterprise/CE-only.
 *   - Does NOT expose tokens, secrets, IATs, or raw credential material.
 */
export function ProtocolSettingsPanel({
  capabilityBoundary,
  orgId,
  initialSettings,
}: ProtocolSettingsPanelProps) {
  const [state, action, isPending] = useActionState(updateProtocolSettingsAction, initialState);

  // Extract the concrete settings from the discriminated result.
  const effectiveSettings = initialSettings?.ok === true ? initialSettings.settings : null;

  // Local checkbox state — initialized from server-fetched settings.
  // Updated optimistically when the action succeeds.
  const [dcrEnabled, setDcrEnabled] = useState(
    effectiveSettings?.dynamic_client_registration_enabled ?? false
  );
  const [scimEnabled, setScimEnabled] = useState(effectiveSettings?.scim_enabled ?? false);

  // The current effective settings to display (source + timestamps).
  // Switches to the just-saved value when a save succeeds.
  const [displayedSettings, setDisplayedSettings] = useState<OrgProtocolSettings | null>(
    effectiveSettings
  );

  // When the action succeeds, update displayed settings from the response.
  useEffect(() => {
    if (state.ok && state.settings) {
      setDisplayedSettings(state.settings);
      setDcrEnabled(state.settings.dynamic_client_registration_enabled);
      setScimEnabled(state.settings.scim_enabled);
    }
  }, [state.ok, state.settings]);

  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100">
        <p className="text-sm font-semibold text-sky-950">Protocol settings</p>
        <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
          Controls per-organization availability of DCR Foundation. SCIM 2.0 provisioning is
          Enterprise/CE-only.
        </p>
      </div>

      {capabilityBoundary ? (
        <div className="px-6 py-5">
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold text-amber-800">{capabilityBoundary.title}</p>
            <p className="mt-1 text-xs text-amber-700 leading-relaxed">{capabilityBoundary.body}</p>
          </div>
        </div>
      ) : !initialSettings || !initialSettings.ok ? (
        <div className="px-6 py-5">
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
            {protocolSettingsLoadErrorMessage(initialSettings)}
          </div>
        </div>
      ) : (
        <div className="px-6 py-5 space-y-5">
          {/* Source indicator */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                displayedSettings?.source === "explicit"
                  ? "text-sky-700 bg-sky-50 border-sky-200"
                  : "text-stone-500 bg-stone-100 border-stone-200"
              }`}
            >
              {formatSettingsSource(displayedSettings?.source ?? "default")}
            </span>
            {displayedSettings && isDefaultUnset(displayedSettings) && (
              <span className="text-[10px] text-stone-400 leading-relaxed">
                No protocol setting has been explicitly enabled for this organization.
              </span>
            )}
          </div>

          <form action={action} className="space-y-4">
            <input type="hidden" name="org_id" value={orgId} />
            <input
              type="hidden"
              name="dynamic_client_registration_enabled"
              value={String(dcrEnabled)}
            />
            <input type="hidden" name="scim_enabled" value={String(scimEnabled)} />

            {/* DCR toggle */}
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <label className="relative block h-5 w-5">
                  <input
                    type="checkbox"
                    checked={dcrEnabled}
                    onChange={() => setDcrEnabled((v) => !v)}
                    disabled={isPending}
                    aria-label="Dynamic Client Registration enabled"
                    className="peer h-5 w-5 appearance-none rounded border-2 border-stone-300 bg-white transition-colors checked:border-sky-600 checked:bg-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="pointer-events-none absolute inset-0 hidden items-center justify-center text-white peer-checked:flex">
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                </label>
              </div>
              <div>
                <p className="text-xs font-semibold text-sky-950">Dynamic Client Registration</p>
                <p className="text-xs text-stone-500 leading-relaxed mt-0.5">
                  Allows registered applications to register new OAuth clients for this organization
                  via RFC 7591. Requires a valid IAT. Does not enable anonymous public registration.
                </p>
              </div>
            </div>

            {/* SCIM toggle */}
            <div className="flex items-start gap-3 opacity-75">
              <div className="mt-0.5 shrink-0">
                <label className="relative block h-5 w-5">
                  <input
                    type="checkbox"
                    checked={scimEnabled}
                    disabled
                    readOnly
                    aria-label="SCIM provisioning requires Enterprise or CE"
                    className="peer h-5 w-5 appearance-none rounded border-2 border-stone-300 bg-white transition-colors checked:border-sky-600 checked:bg-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="pointer-events-none absolute inset-0 hidden items-center justify-center text-white peer-checked:flex">
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                </label>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-sky-950">SCIM provisioning</p>
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    Enterprise/CE only
                  </span>
                </div>
                <p className="text-xs text-stone-500 leading-relaxed mt-0.5">
                  SCIM 2.0 provisioning is an Enterprise/CE capability. It is not available in
                  lower-tier protocol settings.
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
              <output className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-medium">
                Protocol settings saved.
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
