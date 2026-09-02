# Session states: unavailable is not expired

THE-UNAVAILABLE-IS-NOT-EXPIRED (2026-09-02). Owner ruling: **"Three states
everywhere: authenticated; unauthenticated (real verdict — redirect as today);
unavailable (503/network — NO login redirect). Unavailable renders an honest
'service unavailable' state showing the correlation_id; the session cookie is
NOT cleared."**

## What was wrong (measured)

`getServerSession()` retried a 5xx / network failure up to 6 times (200·2^n ms
back-off, ≈ 6 s, plus a 4 s timeout per attempt — worst case ≈ 26 s), ignored
the IdP's `Retry-After: 1`, then collapsed to `null`. Every consumer read
`null` as "no session": the four route-segment layouts (site-admin,
org-admin, dashboard, account) and 56 server actions redirected to
`/login?reason=session_expired`. An identity-service outage was shown to a
human as a false verdict — and, because /login is where the user then signs
in again, the outage cost a session that was never dead. (The OP's side of
this, AUTH-503 — a store error answered as an unlogged 401 — was closed the
same day in identuum-idp-oss; it now answers `503` with `Retry-After: 1`, an
`X-Request-ID`, and `{"correlation_id"}`.)

## What holds now

| state | how it is recognised | what the UI does |
|---|---|---|
| `authenticated` | validate 200 | proceed; the layout applies its role rules |
| `unauthenticated` | validate 4xx (401 with the IdP's `reason`, or any other 4xx) | the VERDICT: redirect to `/login?reason=session_expired`, exactly as before |
| `unavailable` | validate 5xx, or no answer, for the whole retry budget | NO redirect to /login, NO cookie touched. Layouts render `ServiceUnavailable` in place (URL stays; "Try again" reloads). Server actions / data helpers that go through `getServerSession()` are sent to `/unavailable?cid=…&status=…&retry=…`. The correlation id is shown as the reference; it is the join key to the IdP's `AUTH-503` ERROR line. |

Code: `src/lib/server-session.ts` (`getServerSessionState()` — the tri-state
truth, cached per request; `getServerSession()` — the old shape for its 91
consumers, an outage becomes a redirect to `/unavailable`, never `null`),
`src/lib/session-guard.ts` (`decideSessionGuard`, the pure decision the
layouts apply), `src/components/shared/service-unavailable.tsx`,
`src/app/unavailable/page.tsx`.

## Retry policy and its cap

- Total wall-clock cap per request: **8 s** (`SESSION_VALIDATE_TOTAL_CAP_MS`),
  fetch timeouts included — a server render must answer.
- Each attempt ≤ 4 s (`SESSION_VALIDATE_ATTEMPT_TIMEOUT_MS`) or the remaining
  budget.
- Wait between attempts: the IdP's `Retry-After` (seconds or HTTP-date) when
  present, else 200·2^n ms back-off; either capped at 2 s
  (`SESSION_VALIDATE_MAX_WAIT_MS`); a wait that leaves no room for a useful
  attempt ends the loop.
- A 4xx never retries — it is the verdict.

Against the OP's `Retry-After: 1` this gives at most about 5 attempts in
8 s, the first retry after 1 s (not 200 ms).

## Logout when the IdP is unavailable — the decision

`POST /api/auth/logout` forwards the cookies to the IdP's logout and then
expires the browser's own auth cookies. When the IdP answers 5xx or cannot be
reached, the **server-side revocation is not confirmed** and the route
**still clears this browser's cookies** — deliberately: the user asked to
leave this device, and a browser that keeps a session it was told to drop is
the worse outcome. It is never silent: the server log carries
`[logout] IdP … (correlation_id=…): server-side session revocation NOT
confirmed; clearing this browser's cookies anyway`, and the redirect goes to
`/login?reason=signed_out_locally` instead of `/login` so the state can be
told apart. Other devices may still hold the session until it expires or is
revoked from the account's sessions page.

The OP-side logout handlers (OIDC end-session, front-channel logout in
identuum-idp-oss) apply the same pattern since THE-LOGOUT-THAT-CANNOT-REVOKE
(2026-09-02): on a store error the cookie is still cleared, the AUTH-503
line and the audit event `user_session.logout.revocation_unconfirmed` are
recorded, and the answer carries `X-Identuum-Logout: revocation_unconfirmed`
(see identuum-idp-oss docs/TESTING-OPERATORS.md, "Logout when the store
cannot answer").

## What did NOT change

- The two client-side `window.location = "/login?reason=session_expired"`
  in the MFA forms fire only on the API client's typed `SESSION_EXPIRED`
  error, raised solely when the IdP's error text says "session invalid" /
  "session not found" (a verdict on the pending-login session), never on a
  5xx.
- The account-settings redirects after "disable MFA" / "revoke this session"
  are intentional sign-outs on success, not verdicts.

## Rule and harness

- `UNAVAILABLE-NOT-EXPIRED-1` (vitest, `src/__tests__/unavailable-not-expired.test.ts`,
  red-proved by mutation): a 503 with correlation id + Retry-After is
  `unavailable` (never `null`, never `/login`, cookies untouched); the guard
  renders in place for an outage and redirects only for a verdict; a genuine
  401 is `unauthenticated` with the IdP's reason and never retries;
  Retry-After is honored inside the 8 s cap; logout on a 503 clears the
  cookies AND names it.
- `e2e/unavailable-not-expired.spec.ts` (devloop): repoints the UI's runtime
  config at a local 503 stub (Retry-After 1, X-Request-ID, correlation_id):
  the unavailable state renders with the id, no /login, cookies kept; stub
  removed → the session resumes without re-login; cookies dropped → the real
  verdict still lands on `/login?reason=session_expired`.
