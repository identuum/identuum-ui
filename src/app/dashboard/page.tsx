/**
 * org_user member dashboard — server component.
 *
 * Auth guard is enforced by the parent layout (dashboard/layout.tsx).
 * This page does NOT repeat the guard.
 *
 * Fetches the calling user's own profile via getOwnProfile() (server-side,
 * session cookies forwarded to IdP). Falls back to session validate data when
 * the profile call is unavailable. No client-side session validation needed.
 *
 * UI-0912-A (OSS v0.9.12 C4): below the identity card, three cards — Profile,
 * Security, Sessions — each one link to its tab of /account/settings with the
 * facts the member's own reads return. Each card reads on its own, so one
 * failed read does not hide the others; a card that cannot read says so and
 * still links. No Applications card (owner Q4 b); no "Coming soon".
 */

import type { Metadata } from "next";
import {
  type MemberEmailStatus,
  memberEmailStatus,
  NOT_CONFIGURED_TEXT,
} from "@/lib/email-verification";
import {
  getOwnMfaStatus,
  type ListSessionsResult,
  listOwnSessions,
  type MfaStatusResult,
} from "@/lib/idp-account-client";
import { getOwnProfile } from "@/lib/idp-admin-client";
import { mailCeremoniesAvailable } from "@/lib/mail-capabilities";
import { getServerSession } from "@/lib/server-session";
import type { UserProfile } from "@/lib/types";
import { SendVerificationEmail } from "./send-verification-email";

const NOT_LOADED = "We could not load this right now. Open the page to see it.";

export const metadata: Metadata = { title: "Dashboard — Identuum" };

export default async function DashboardPage() {
  // getServerSession() is cached per-request — the layout already called it.
  const [session, profile, mfa, sessions, mailCeremonies] = await Promise.all([
    getServerSession(),
    getOwnProfile(),
    getOwnMfaStatus(),
    listOwnSessions(),
    mailCeremoniesAvailable(),
  ]);

  // Layout guarantees session exists and role is org_user at this point.
  const email = profile?.email ?? session?.user?.email ?? "—";
  const name = profile?.name ?? null;
  const role = profile?.role ?? session?.user?.role ?? "org_user";
  const orgName = profile?.organization_name ?? null;
  const domain = profile?.domain ?? null;
  const mfaEnabled = profile?.mfa_enabled ?? null;
  const emailVerified = profile?.email_verified ?? null;
  // UI-0912-A4: null on identuum-idp-ce (no C2 fields): today's row stays.
  const emailStatus = profile ? memberEmailStatus(profile) : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 data-testid="home" className="text-2xl font-extrabold tracking-tight text-sky-950">
          Overview
        </h1>
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
              label="Two-step sign-in"
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
          {emailStatus ? (
            <InfoRow
              label="Email address"
              value={
                <EmailStatus
                  status={emailStatus}
                  address={email}
                  mailReady={mailCeremonies}
                  offerSend={role !== "site_admin"}
                />
              }
            />
          ) : (
            emailVerified !== null && (
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
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <LinkCard title="Profile" href="/account/settings?tab=profile" link="Edit profile">
          <ProfileFacts profile={profile} />
        </LinkCard>
        <LinkCard title="Security" href="/account/settings?tab=password" link="Manage security">
          <SecurityFacts mfa={mfa} />
        </LinkCard>
        <LinkCard
          title="Sessions"
          href="/account/settings?tab=sessions"
          link="See devices and sign out"
        >
          <SessionFacts sessions={sessions} />
        </LinkCard>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-32 shrink-0 text-xs text-stone-400">{label}</span>
      <div className="min-w-0 break-words text-sm text-sky-950 font-medium">{value}</div>
    </div>
  );
}

/**
 * UI-0912-A4: how the mailbox was proven, or "Not verified yet" with the
 * send button. A server that cannot send email says so and offers no button
 * (owner rule 2026-10-12 18:05). The site_admin is never offered it.
 */
function EmailStatus({
  status,
  address,
  mailReady,
  offerSend,
}: {
  status: MemberEmailStatus;
  address: string;
  mailReady: boolean;
  offerSend: boolean;
}) {
  const badge = (
    <span
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${
        status.proven ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"
      }`}
    >
      {status.label}
    </span>
  );
  if (status.proven || !offerSend) return badge;
  if (!mailReady) {
    return <span className="text-xs font-normal text-amber-700">{NOT_CONFIGURED_TEXT}</span>;
  }
  return (
    <div className="space-y-2">
      {badge}
      <div className="font-normal">
        <SendVerificationEmail address={address} />
      </div>
    </div>
  );
}

/** The whole card is one link: one focus stop, Enter opens the page. */
function LinkCard({
  title,
  href,
  link,
  children,
}: {
  title: string;
  href: string;
  link: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="group block bg-white border border-stone-200 rounded-[1.5rem] shadow-sm px-5 py-4 hover:border-sky-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
    >
      <h2 className="text-sm font-semibold text-sky-950">{title}</h2>
      <div className="mt-1 space-y-1 text-xs text-stone-600 leading-relaxed break-words">
        {children}
      </div>
      <p className="mt-3 text-xs font-semibold text-sky-700 group-hover:underline">{link}</p>
    </a>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return <p className="text-amber-700">{children}</p>;
}

function ProfileFacts({ profile }: { profile: UserProfile | null }) {
  if (!profile) return <p>{NOT_LOADED}</p>;
  return (
    <>
      <p>Name: {profile.name ?? "not set"}</p>
      <p>Email: {profile.email}</p>
      <p className="text-stone-400">
        Your name and the details apps can ask for. Apps see only what you agree to share.
      </p>
    </>
  );
}

function SecurityFacts({ mfa }: { mfa: MfaStatusResult }) {
  if (!mfa.ok) {
    // CE and older servers do not serve /me/mfa/status: the card still links.
    // A 503 is a server that did not answer, not a missing route (F10): A-08.
    const noRoute = mfa.unavailable && mfa.statusCode !== 503;
    return <p>{noRoute ? "Manage your password and two-step sign-in." : NOT_LOADED}</p>;
  }
  if (!mfa.status.mfa_enabled) {
    return (
      <>
        <p>Two-step sign-in: Off</p>
        <Warning>Add a second sign-in step to protect your account.</Warning>
      </>
    );
  }
  const left = mfa.status.recovery_codes_remaining_count;
  return (
    <>
      <p>Two-step sign-in: On</p>
      <p>Backup codes left: {left}</p>
      {left === 0 && <Warning>No backup codes left. Make new ones.</Warning>}
      {left === 1 && <Warning>Only 1 backup code left. Make new ones.</Warning>}
      {left === 2 && <Warning>Only 2 backup codes left. Make new ones.</Warning>}
    </>
  );
}

function SessionFacts({ sessions }: { sessions: ListSessionsResult }) {
  if (!sessions.ok) return <p>{NOT_LOADED}</p>;
  const n = sessions.sessions.length;
  if (n === 0) return <p>No active sign-ins found.</p>;
  return <p>{n === 1 ? "Signed in on this device only." : `Signed in on ${n} devices.`}</p>;
}
