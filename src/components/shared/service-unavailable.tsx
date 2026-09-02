/**
 * ServiceUnavailable — THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02).
 *
 * The honest state for "the identity service could not answer": shown IN
 * PLACE by the route-segment layouts (and by /unavailable for callers that
 * cannot render). It is not a sign-in page and it does not touch cookies —
 * the session is still there; the IdP just could not confirm it right now.
 *
 * The correlation id is the operator's join key to the IdP's ERROR log
 * (AUTH-503 line with the same id). Retry-After is what the IdP asked for.
 * Server component, no client JS: "Try again" is a plain link to the current
 * URL (href="") so a reload re-runs the guard.
 */

export interface ServiceUnavailableProps {
  correlationId: string | null;
  retryAfterSeconds: number | null;
  status: number | null;
  /** where "Try again" goes; defaults to the current URL */
  retryHref?: string;
}

export function ServiceUnavailable({
  correlationId,
  retryAfterSeconds,
  status,
  retryHref = "",
}: ServiceUnavailableProps) {
  return (
    <div
      className="min-h-screen bg-stone-50 flex items-center justify-center px-4"
      data-testid="service-unavailable"
      data-correlation-id={correlationId ?? ""}
    >
      <div className="max-w-lg w-full rounded-[1.5rem] border border-stone-200 bg-white p-8 shadow-sm space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">
          Temporarily unavailable
        </p>
        <h1 className="text-lg font-bold text-sky-950 tracking-tight">
          The identity service could not confirm your session
        </h1>
        <p className="text-sm text-stone-500 leading-relaxed">
          This is not a sign-out. Your session was left as it was; the identity service did not
          answer
          {status !== null ? ` (HTTP ${status})` : " (no answer)"}
          {retryAfterSeconds !== null ? ` and asked for a retry in ${retryAfterSeconds}s` : ""}. Try
          again in a moment.
        </p>
        <dl className="rounded-xl bg-stone-50 border border-stone-100 p-3 text-xs text-stone-500">
          <dt className="font-semibold text-stone-600">Reference</dt>
          <dd
            className="font-mono text-stone-700 break-all"
            data-testid="service-unavailable-correlation-id"
          >
            {correlationId ?? "no correlation id (the service did not answer)"}
          </dd>
        </dl>
        <div className="flex gap-4">
          <a
            href={retryHref}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            data-testid="service-unavailable-retry"
          >
            Try again
          </a>
          <a
            href="/platform-status"
            className="text-sm text-stone-400 hover:text-stone-500 underline self-center"
          >
            View platform status
          </a>
        </div>
      </div>
    </div>
  );
}
