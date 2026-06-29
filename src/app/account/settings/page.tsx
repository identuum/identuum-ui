import { PasskeySection } from "@/components/ui/passkey-section";
import { getOwnMfaStatus, listOwnSessions } from "@/lib/idp-account-client";
import { getServerRuntimeState } from "@/lib/server-runtime-state";
import { getServerSession } from "@/lib/server-session";
import type { Metadata } from "next";
import { ChangePasswordForm } from "./change-password-form";
import { MfaSection } from "./mfa-section";
import { SessionsSection } from "./sessions-section";

/**
 * Account settings page — shared across all authenticated roles.
 *
 * Auth is enforced by the parent layout (account/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Tab routing: ?tab=password (default) | sessions | passkeys | mfa
 * Unknown values fall back to password.
 * Sessions are only fetched when the sessions tab is active.
 *
 * Section 8 of UI-FEATURES.md documents one explicit exception to the
 * password-default rule: when `?reason=mfa_required` is in the URL the page
 * opens on the MFA tab instead of the password tab. This is the entry
 * point used by the org-admin layout's MFA gate (UI-FEATURES.md Section 6)
 * so the redirected operator is not confused by landing on a password
 * form when the actual problem is missing MFA enrollment.
 *
 * Role-specific administrative settings live in their respective shells:
 *   - /site-admin/settings  → system / infrastructure settings
 *   - /org-admin/settings   → organization settings
 */

export const metadata: Metadata = { title: "Account Settings — Identuum" };

type Tab = "password" | "sessions" | "passkeys" | "mfa";

function parseTab(raw: string | string[] | undefined): Tab | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s === "password" || s === "sessions" || s === "passkeys" || s === "mfa") return s;
  return null;
}

function isMfaRequiredReason(raw: string | string[] | undefined): boolean {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return s === "mfa_required";
}

/**
 * Resolves the active tab.
 *
 * Precedence (UI-FEATURES.md Section 8 — explicit MFA exception):
 *   1. Explicit `?tab=mfa` always wins, regardless of reason.
 *   2. Otherwise, `?reason=mfa_required` defaults the tab to `mfa`.
 *   3. Otherwise, a recognised explicit `?tab=…` value wins.
 *   4. Otherwise, fall back to the documented default (`password`).
 *
 * Rules 2 and 3 are ordered intentionally: when both `reason=mfa_required`
 * and an unrelated `tab=…` (e.g. `?tab=sessions&reason=mfa_required`) are
 * present, the explicit tab is the operator's most-recent stated intent
 * and takes precedence. Only the empty / absent / unrecognised tab values
 * defer to the reason.
 */
function resolveTab(
  rawTab: string | string[] | undefined,
  rawReason: string | string[] | undefined
): Tab {
  const explicit = parseTab(rawTab);
  if (explicit) return explicit;
  if (isMfaRequiredReason(rawReason)) return "mfa";
  return "password";
}

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = resolveTab(params.tab, params.reason);
  const reasonMfaRequired = isMfaRequiredReason(params.reason);

  // getServerSession is React-cached per request; the parent layout has
  // already invoked it, so this call is free. /me/mfa/status is preferred
  // when present; validate.mfa_enabled remains the rolling-upgrade fallback.
  let session: Awaited<ReturnType<typeof getServerSession>> | null = null;
  let mfaStatusResult: Awaited<ReturnType<typeof getOwnMfaStatus>> | null = null;
  if (tab === "mfa") {
    [session, mfaStatusResult] = await Promise.all([getServerSession(), getOwnMfaStatus()]);
  }
  const mfaEnabled = mfaStatusResult?.ok
    ? mfaStatusResult.status.mfa_enabled
    : session?.user?.mfa_enabled;

  const sessionsResult = tab === "sessions" ? await listOwnSessions() : null;

  // Passkeys capability gate — landed by
  // agent-a-20260744-account-settings-passkeys-capability-gate per the
  // audit at agent-a-20260742 + the harness from agent-a-20260743.
  //
  // CE's /api/v1/component publishes `"webauthn": false` today; the
  // /api/v1/webauthn/* routes are not mounted, so an unconditional
  // PasskeySection would always 404 on its begin call and surface the
  // "Could not start passkey registration" error. We read the capability
  // off the SAME path account/layout.tsx already uses (the role-shell
  // pattern; cached by getServerRuntimeState's React cache) so the page
  // and the layout agree on the runtime view.
  //
  // When webauthnAvailable === false:
  //   - The Passkeys tab is hidden from the tab nav (most operators
  //     never see it; no broken button is reachable from normal nav).
  //   - An explicit ?tab=passkeys URL still resolves to the Passkeys
  //     surface, but renders a "Passkeys are not available on this
  //     backend" notice WITH NO Add button + NO PasskeySection mount,
  //     so even direct/bookmarked URLs do not reach the broken flow.
  //
  // When webauthnAvailable === true: every branch behaves as before.
  // Flipping the CE capability map + mounting WebAuthn (a separate
  // mini-track) requires no further UI change to re-enable the active
  // surface.
  const runtimeState = await getServerRuntimeState();
  const webauthnAvailable = Boolean(runtimeState?.components?.idp?.capabilities?.webauthn);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Account settings</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Your personal sign-in credentials and security settings.
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 flex-wrap">
        {(
          [
            { label: "Password", value: "password" },
            { label: "MFA", value: "mfa" },
            { label: "Sessions", value: "sessions" },
            ...(webauthnAvailable ? [{ label: "Passkeys", value: "passkeys" as Tab }] : []),
          ] as { label: string; value: Tab }[]
        ).map(({ label, value }) => (
          <a
            key={value}
            href={`/account/settings?tab=${value}`}
            aria-current={tab === value ? "page" : undefined}
            className={[
              "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
              tab === value
                ? "bg-sky-50 text-sky-700 border border-sky-200"
                : "text-stone-500 hover:bg-stone-100 hover:text-sky-950",
            ].join(" ")}
          >
            {label}
          </a>
        ))}
      </div>

      {/* Password tab */}
      {tab === "password" && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">Password</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Change your password. All active sessions are revoked on save.
            </p>
          </div>
          <div className="px-6 py-5">
            <ChangePasswordForm />
          </div>
        </div>
      )}

      {/* MFA tab */}
      {tab === "mfa" && (
        <MfaSection
          mfaEnabled={mfaEnabled}
          mfaStatus={mfaStatusResult?.ok ? mfaStatusResult.status : null}
          statusUnavailable={Boolean(
            mfaStatusResult && !mfaStatusResult.ok && mfaStatusResult.unavailable
          )}
          reasonMfaRequired={reasonMfaRequired}
        />
      )}

      {/* Sessions tab */}
      {tab === "sessions" && sessionsResult && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">Active sessions</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Your current sign-in sessions. Sign out individual sessions you no longer recognise.
            </p>
          </div>
          <div className="px-6 py-5">
            <SessionsSection
              sessions={sessionsResult.ok ? sessionsResult.sessions : []}
              unavailable={!sessionsResult.ok && sessionsResult.unavailable}
              error={!sessionsResult.ok && !sessionsResult.unavailable}
            />
          </div>
        </div>
      )}

      {/* Passkeys tab */}
      {tab === "passkeys" && (
        <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-sm font-semibold text-sky-950">Passkeys</p>
            <p className="text-xs text-stone-400 mt-0.5">
              Hardware keys and platform authenticators for passwordless sign-in.
            </p>
          </div>
          <div className="px-6 py-5">
            {webauthnAvailable ? <PasskeySection /> : <PasskeysUnavailableNotice />}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * PasskeysUnavailableNotice — rendered when CE's component capability
 * map declares `"webauthn": false` AND the operator has explicitly
 * navigated to ?tab=passkeys. Mirrors the `UnknownStatus` shape from
 * mfa-section.tsx so the tone is consistent with the rolling-upgrade
 * safety pattern.
 *
 * Critically does NOT mount `<PasskeySection />`, so the component's
 * mount-side `refresh()` call to `/api/v1/webauthn/credentials` and the
 * Add-passkey click handler that targets `/api/v1/webauthn/register/begin`
 * are NEVER reachable while the gate is closed. This is the structural
 * guarantee that the "Could not start passkey registration" error from
 * the user-reported regression cannot fire from this page.
 *
 * When CE later mounts WebAuthn and flips its capability to true, this
 * branch becomes unreachable (the parent gate flips) and no further UI
 * change is required to re-enable the active surface.
 */
function PasskeysUnavailableNotice() {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 text-[10px] font-bold"
      >
        ?
      </span>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-stone-600">
          Passkeys are not available on this backend
        </p>
        <p className="text-xs text-stone-500 leading-relaxed">
          This Identuum build does not advertise WebAuthn support, so the in-place passkey
          enrollment flow has been disabled. If you need passkey support, please contact your
          administrator.
        </p>
        <p className="text-xs text-stone-400 leading-relaxed">
          When the backend gains WebAuthn support, this tab will re-enable automatically — no action
          on your part is required.
        </p>
      </div>
    </div>
  );
}
