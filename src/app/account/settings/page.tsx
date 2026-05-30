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
import { ChangePasswordForm } from "./change-password-form";
import { MfaSection } from "./mfa-section";
import { SessionsSection } from "./sessions-section";
import { PasskeySection } from "@/components/ui/passkey-section";
import { listOwnSessions } from "@/lib/idp-admin-client";
import { getServerSession } from "@/lib/server-session";
import type { Metadata } from "next";

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
  // already invoked it, so this call is free. We only need the MFA-state
  // projection from the IDP /api/v1/validate response (UI-FEATURES.md
  // Section 7). Treat undefined as unknown — older IDP builds may omit it.
  const session = tab === "mfa" ? await getServerSession() : null;
  const mfaEnabled = session?.user?.mfa_enabled;

  const sessionsResult = tab === "sessions" ? await listOwnSessions() : null;

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
            { label: "Passkeys", value: "passkeys" },
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
        <MfaSection mfaEnabled={mfaEnabled} reasonMfaRequired={reasonMfaRequired} />
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
              forbidden={!sessionsResult.ok && sessionsResult.forbidden}
              error={!sessionsResult.ok && !sessionsResult.forbidden}
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
            <PasskeySection />
          </div>
        </div>
      )}
    </div>
  );
}
