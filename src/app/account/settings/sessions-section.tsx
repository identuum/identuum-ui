"use client";

/**
 * Sessions section for /account/settings.
 *
 * Receives server-fetched session data as props — no direct API calls from
 * the browser. Session IDs are placed only in hidden form fields for the
 * revoke action; they are not rendered as visible text.
 *
 * site_admin accounts receive a 403 from the backend for session listing;
 * the parent page passes forbidden=true and this component renders an
 * informational note instead of a list.
 */

import { Button } from "@/components/ui/button";
import { useActionState } from "react";
import type { SessionItem } from "@/lib/idp-admin-client";
import { type RevokeSessionState, revokeSessionAction } from "./session-actions";

interface SessionsSectionProps {
  sessions: SessionItem[];
  /** True when the backend returned 403 (site_admin — not supported by design). */
  forbidden: boolean;
  /** True when the list fetch failed for a reason other than 403. */
  error: boolean;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export function SessionsSection({ sessions, forbidden, error }: SessionsSectionProps) {
  if (forbidden) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
        <p className="text-xs text-stone-500 leading-relaxed">
          Session management is not available for administrator accounts. Use the sign-out option
          to end your current session.
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

  const activeSessions = sessions.filter((s) => s.is_active);

  if (activeSessions.length === 0) {
    return (
      <p className="text-sm text-stone-400">No active sessions found.</p>
    );
  }

  return (
    <div className="divide-y divide-stone-100">
      {activeSessions.map((s) => (
        <SessionRow key={s.id} session={s} />
      ))}
    </div>
  );
}

function SessionRow({ session }: { session: SessionItem }) {
  const [state, action, isPending] = useActionState(revokeSessionAction, {});

  if (state.success) {
    return (
      <div className="py-3 flex items-center justify-between gap-4">
        <span className="text-xs text-emerald-600 font-medium">Signed out.</span>
      </div>
    );
  }

  return (
    <div className="py-3.5 flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          {session.is_current && (
            <span className="inline-flex items-center rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
              This session
            </span>
          )}
          <span className="text-xs text-stone-500">
            Started {formatDate(session.created_at)}
          </span>
        </div>
        {session.last_used_at && (
          <p className="text-xs text-stone-400">
            Last used {formatDate(session.last_used_at)}
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
        {state.error && (
          <p className="text-xs text-red-600 mt-1">{state.error}</p>
        )}
      </div>

      {/* Only non-current sessions can be individually revoked */}
      {!session.is_current && (
        <form action={action} className="shrink-0">
          {/* session_id is an opaque revocation handle — not displayed */}
          <input type="hidden" name="session_id" value={session.id} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            loading={isPending}
            disabled={isPending}
            className="text-red-600 hover:text-red-800 hover:bg-red-50"
          >
            {isPending ? "Signing out…" : "Sign out"}
          </Button>
        </form>
      )}
    </div>
  );
}
