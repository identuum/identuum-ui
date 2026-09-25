"use client";

/**
 * Sessions section for /account/settings.
 *
 * Receives server-fetched session data as props — no direct API calls from
 * the browser. The OSS /me session endpoint intentionally returns no
 * session IDs; revoke actions derive identity from the current principal.
 */

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import type { SessionItem } from "@/lib/idp-account-client";
import { revokeSessionAction } from "./session-actions";
import { selectActiveSessions } from "./sessions-helpers";

interface SessionsSectionProps {
  sessions: SessionItem[];
  /** True when the IDP runtime does not expose the /me sessions endpoint. */
  unavailable: boolean;
  /** True when the list fetch failed for a reason other than unavailable runtime. */
  error: boolean;
  /**
   * True when the IdP refused the list (403): it answers a site_admin's
   * GET /api/v1/sessions 403 by design (identuum-idp-oss sessions.go). Not an
   * error to retry.
   */
  forbidden?: boolean;
}

export function SessionsSection({ sessions, unavailable, error, forbidden }: SessionsSectionProps) {
  if (forbidden) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
        <p className="text-xs text-stone-500 leading-relaxed">
          Session management is not available for administrator accounts. Use the account menu to
          sign out of this browser session.
        </p>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
        <p className="text-xs text-stone-500 leading-relaxed">
          Session management is not available from this IDP runtime. Use the account menu to sign
          out of the current browser session.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
        Could not load sessions. Reload the page to retry.
      </div>
    );
  }

  const activeSessions = selectActiveSessions(sessions);

  if (activeSessions.length === 0) {
    return <p className="text-sm text-stone-400">No active sessions found.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <SessionActionForm
          actionKind="revoke_current"
          confirmLiteral="CURRENT"
          title="Sign out here"
          description="End only this browser session."
          buttonLabel="Sign out current"
          signedOutOnSuccess
        />
        <SessionActionForm
          actionKind="revoke_others"
          confirmLiteral="OTHERS"
          title="Sign out others"
          description="Keep this browser signed in."
          buttonLabel="Sign out others"
        />
        <SessionActionForm
          actionKind="revoke_all"
          confirmLiteral="ALL"
          title="Sign out everywhere"
          description="End every browser session."
          buttonLabel="Sign out all"
          signedOutOnSuccess
        />
      </div>

      <div className="divide-y divide-stone-100">
        {activeSessions.map((s) => (
          <SessionRow key={s.id} session={s} />
        ))}
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: SessionItem }) {
  return (
    <div className="py-3.5">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          {session.is_current && (
            <span className="inline-flex items-center rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
              This session
            </span>
          )}
          <span className="text-xs text-stone-500">
            Started <LocalTime value={session.created_at} />
          </span>
        </div>
        {session.last_used_at && (
          <p className="text-xs text-stone-400">
            Last used <LocalTime value={session.last_used_at} />
          </p>
        )}
        {session.ip_address && (
          <p className="text-xs text-stone-400 font-mono">{session.ip_address}</p>
        )}
        {session.user_agent && (
          <p className="text-xs text-stone-400 truncate max-w-[340px]" title={session.user_agent}>
            {session.user_agent}
          </p>
        )}
      </div>
    </div>
  );
}

function SessionActionForm({
  actionKind,
  confirmLiteral,
  title,
  description,
  buttonLabel,
  signedOutOnSuccess = false,
}: {
  actionKind: "revoke_current" | "revoke_others" | "revoke_all";
  confirmLiteral: string;
  title: string;
  description: string;
  buttonLabel: string;
  signedOutOnSuccess?: boolean;
}) {
  const [state, action, isPending] = useActionState(revokeSessionAction, {});
  const [confirm, setConfirm] = useState("");
  const trimmed = confirm.trim();
  const disabled = isPending || trimmed !== confirmLiteral;

  useEffect(() => {
    if (state.success && state.signedOut && signedOutOnSuccess) {
      window.location.assign("/login?reason=session_expired");
    }
  }, [signedOutOnSuccess, state]);

  return (
    <form action={action} className="rounded-xl border border-stone-200 bg-stone-50 p-3 space-y-2">
      <input type="hidden" name="action" value={actionKind} />
      <div>
        <p className="text-xs font-semibold text-sky-950">{title}</p>
        <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <label className="block text-[11px] font-medium text-stone-500">
        Type {confirmLiteral} to confirm
        <input
          name="confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isPending || state.success}
          className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-mono text-stone-800 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
        />
      </label>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.success && !state.signedOut && (
        <p className="text-xs font-medium text-emerald-600">Sessions revoked.</p>
      )}
      <Button
        type="submit"
        variant={actionKind === "revoke_all" ? "danger" : "secondary"}
        size="sm"
        loading={isPending}
        disabled={disabled || state.success}
        className="w-full"
      >
        {isPending ? "Revoking…" : buttonLabel}
      </Button>
    </form>
  );
}
