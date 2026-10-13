"use client";

/**
 * D3 (v0.9.13, owner Q5 a): the Applications tab of /account/settings. One
 * row per application the user has allowed (GET /api/v1/me/consents). Remove
 * access asks first; the question says how long the app may keep working,
 * from access_token_lifetime_seconds in the same answer. First-party
 * applications that never ask are not in the answer, so they are not listed.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { removeConfirmText, scopeWords } from "@/lib/consent-words";
import type { ListConsentsResult, OwnConsent } from "@/lib/idp-account-client";
import { type RemoveApplicationState, removeApplicationAccessAction } from "./application-actions";

/** The action's answer, with the application it was about. */
type SectionState = RemoveApplicationState & { clientId?: string; name?: string };

const initialState: SectionState = { phase: "idle" };

/** Stable, so it runs once when the question opens and not on every render. */
function focusOnMount(el: HTMLElement | null) {
  el?.focus();
}

export function ApplicationsSection({ result }: { result: ListConsentsResult }) {
  const consents = result.ok ? result.consents : [];
  // One action for the list, so its answer outlives the row it removed: the
  // list is read again without the app (review F1).
  const [state, formAction, isPending] = useActionState(
    async (prev: SectionState, formData: FormData): Promise<SectionState> => {
      const clientId = String(formData.get("client_id") ?? "");
      const name = consents.find((c) => c.clientId === clientId)?.name ?? "";
      return { ...(await removeApplicationAccessAction(prev, formData)), clientId, name };
    },
    initialState
  );
  const statusRef = useRef<HTMLParagraphElement>(null);
  const done = state.phase === "removed" || state.phase === "gone";
  // The removed row held the focus; it goes to the line that says what happened.
  useEffect(() => {
    if (state.phase === "removed" || state.phase === "gone") statusRef.current?.focus();
  }, [state]);

  const message =
    state.phase === "removed"
      ? `Access removed for ${state.name}.`
      : state.phase === "gone"
        ? "This app no longer has access."
        : "";
  // The live region exists before any removal, so the message is announced.
  const status = (
    <p
      ref={statusRef}
      role="status"
      tabIndex={-1}
      className={`text-sm font-medium text-emerald-700 focus:outline-none${message ? " pb-3" : ""}`}
    >
      {message}
    </p>
  );

  if (!result.ok) {
    return result.unavailable ? (
      <p className="text-sm text-stone-500">Not available on this server.</p>
    ) : (
      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
        Your applications could not be loaded. Try again.
      </div>
    );
  }
  // The removed app leaves at once, even before the list is read again.
  const shown = done ? consents.filter((c) => c.clientId !== state.clientId) : consents;
  return (
    <div>
      {status}
      {shown.length === 0 ? (
        <p className="text-sm text-stone-500">You have not allowed any applications yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {shown.map((c) => (
            <li key={c.clientId}>
              <ApplicationRow
                consent={c}
                lifetimeSeconds={result.accessTokenLifetimeSeconds}
                formAction={formAction}
                isPending={isPending}
                error={
                  state.phase === "error" && state.clientId === c.clientId ? state.error : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ApplicationRow({
  consent,
  lifetimeSeconds,
  formAction,
  isPending,
  error,
}: {
  consent: OwnConsent;
  lifetimeSeconds: number;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  error?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="py-3.5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold text-sky-950 break-words">{consent.name}</p>
        {consent.scopes.length > 0 && (
          <p className="text-xs text-stone-500 break-words">
            Can see: {scopeWords(consent.scopes).join(", ")}
          </p>
        )}
        <p className="text-xs text-stone-400">
          Allowed on <LocalTime value={consent.firstGrantedAt} style="date" />
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      {confirming ? (
        <form action={formAction} className="space-y-2 sm:max-w-xs">
          <input type="hidden" name="client_id" value={consent.clientId} />
          <p
            ref={focusOnMount}
            tabIndex={-1}
            className="text-xs text-stone-600 leading-relaxed focus:outline-none"
          >
            {removeConfirmText(consent.name, lifetimeSeconds)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="lg" loading={isPending}>
              Remove access
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="shrink-0"
          onClick={() => setConfirming(true)}
        >
          Remove access
        </Button>
      )}
    </div>
  );
}
