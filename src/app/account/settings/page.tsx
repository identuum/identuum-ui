/**
 * Account settings page — shared across all authenticated roles.
 *
 * Auth is enforced by the parent layout (account/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Tab routing: ?tab=password (default) | sessions | passkeys
 * Unknown values fall back to password.
 * Sessions are only fetched when the sessions tab is active.
 *
 * Role-specific administrative settings live in their respective shells:
 *   - /site-admin/settings  → system / infrastructure settings
 *   - /org-admin/settings   → organization settings
 */
import { ChangePasswordForm } from "./change-password-form";
import { SessionsSection } from "./sessions-section";
import { PasskeySection } from "@/components/ui/passkey-section";
import { listOwnSessions } from "@/lib/idp-admin-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Account Settings — Identuum" };

type Tab = "password" | "sessions" | "passkeys";

function parseTab(raw: string | string[] | undefined): Tab {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s === "sessions" || s === "passkeys") return s;
  return "password";
}

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = parseTab(params.tab);

  const sessionsResult = tab === "sessions" ? await listOwnSessions() : null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Account settings</h1>
        <p className="text-sm text-stone-500 mt-0.5">Your personal sign-in credentials and security settings.</p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1">
        {(
          [
            { label: "Password", value: "password" },
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
