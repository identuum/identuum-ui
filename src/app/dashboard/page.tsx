/**
 * org_user member dashboard — server component.
 *
 * Auth guard is enforced by the parent layout (dashboard/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Fetches the calling user's own profile via getOwnProfile() (server-side,
 * session cookies forwarded to IdP). Falls back to session validate data when
 * the profile call is unavailable. No client-side session validation needed.
 */

import type { Metadata } from "next";
import { getOwnProfile } from "@/lib/idp-admin-client";
import { getServerSession } from "@/lib/server-session";

export const metadata: Metadata = { title: "Dashboard — Identuum" };

export default async function DashboardPage() {
  // getServerSession() is cached per-request — the layout already called it.
  const [session, profile] = await Promise.all([getServerSession(), getOwnProfile()]);

  // Layout guarantees session exists and role is org_user at this point.
  const email = profile?.email ?? session?.user?.email ?? "—";
  const name = profile?.name ?? null;
  const role = profile?.role ?? session?.user?.role ?? "org_user";
  const orgName = profile?.organization_name ?? null;
  const domain = profile?.domain ?? null;
  const mfaEnabled = profile?.mfa_enabled ?? null;
  const emailVerified = profile?.email_verified ?? null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-sky-950">Overview</h1>
        <p className="text-sm text-stone-500 mt-0.5">Your account at a glance.</p>
      </div>

      {/* Identity card */}
      <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-6 py-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Signed in as</p>

        <div className="space-y-2">
          <InfoRow label="Email" value={email} />
          {name && <InfoRow label="Name" value={name} />}
          <InfoRow
            label="Role"
            value={
              <span className="inline-block text-xs font-medium text-stone-600 bg-stone-100 px-2 py-0.5 rounded">
                {role}
              </span>
            }
          />
          {(orgName || domain) && <InfoRow label="Organization" value={orgName ?? domain ?? "—"} />}
          {domain && orgName && <InfoRow label="Domain" value={domain} />}
          {mfaEnabled !== null && (
            <InfoRow
              label="Two-factor auth"
              value={
                mfaEnabled ? (
                  <span className="inline-block text-xs font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded">
                    Enabled
                  </span>
                ) : (
                  <span className="inline-block text-xs font-medium text-stone-400 bg-stone-100 px-2 py-0.5 rounded">
                    Not enrolled
                  </span>
                )
              }
            />
          )}
          {emailVerified !== null && (
            <InfoRow
              label="Email verified"
              value={
                emailVerified ? (
                  <span className="inline-block text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                    Verified
                  </span>
                ) : (
                  <span className="inline-block text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                    Unverified
                  </span>
                )
              }
            />
          )}
        </div>
      </div>

      {/* Feature placeholder cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PlaceholderCard
          title="Profile"
          description="Update your display name and contact information."
        />
        <PlaceholderCard
          title="Security"
          description="Manage your password and two-factor authentication."
        />
        <PlaceholderCard
          title="Applications"
          description="View applications you have authorized access to."
        />
        <PlaceholderCard
          title="Sessions"
          description="See where you are signed in and revoke access."
        />
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-xs text-stone-400">{label}</span>
      <span className="text-sm text-sky-950 font-medium">{value}</span>
    </div>
  );
}

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-5 py-4 opacity-60">
      <p className="text-sm font-semibold text-sky-950">{title}</p>
      <p className="text-xs text-stone-500 mt-1 leading-relaxed">{description}</p>
      <p className="text-xs text-stone-400 mt-3 font-medium">Coming soon</p>
    </div>
  );
}
