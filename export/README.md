# Static UI feasibility proof

This remains a representative prototype, not the complete production UI.
`pnpm build:export` produces `out/`; the Go runtime serves that directory when
its existing prototype UI directory setting is supplied. `pnpm build` continues
to build the Next standalone deployment. Neither build changes the issuer or
the deployment's public URLs.

## Shared behavior and remaining duplication

Both deployments now execute `src/lib/session-validation.ts` for session verdicts,
retry timing, Retry-After handling, and the total validation budget. The static
adapter supplies the in-process BFF transport; the Next adapter supplies its
server-side request. Role destinations come from the existing `role-routing`
module. Since PLAN-D-4 every page the export serves is the Next app's own
module (the org-admin and site-admin areas, the public ceremony and
appliance-state pages, sign-in, the org_user dashboard and account settings);
what the export keeps of its own is the boot ladder, the boundary's sign-out
and the sign-in reason banner for the boundary's logout outcomes
(export/src/login-route.tsx). It must not replace the Next deployment before
the remaining acceptance gates named below have run.

## Security contract

Go remains the authority for every resource request. The boundary lifts an
HttpOnly access cookie only in the absence of explicit Authorization, strips
the Cookie header, restricts destinations to the API, and requires the request
header plus a valid same-origin or explicitly allowlisted Origin for mutations.
The direct JSON logout endpoints also require the request header for cookie
credentials. The Next logout form requires its own Origin before forwarding.

Logout distinguishes confirmed revocation, confirmed browser-only clearing,
and no confirmation. A failed store read/write is not a 204 success. Logout can
revoke from the refresh cookie after the access cookie expires. Explicit Bearer
credentials do not also select a different ambient refresh-cookie session.
Static file opens are confined to the export root, including symlink resolution.

The static browser adapter automatically renews expired or absent access
credentials through POST `/bff/session/refresh`. That route accepts only the
HttpOnly refresh cookie, requires the request header and a same-origin Origin
when present, rejects explicit Authorization, and returns no token body. It
uses the existing persisted rotation, replay, account-status and session-lifetime
checks. Access-token lifetimes, original authentication time and MFA assurance
are preserved; refresh is not a fresh login or a step-up ceremony.
Browser renewal retains the existing success and detected-reuse audit events;
those events carry no token or session-ID metadata. Failed access-token issuance
does not emit a success event.

Concurrent reads in one page share a renewal. Across pages/processes the store's
compare-and-set decides the winner; a grace response never writes its old
refresh cookie over the winner's successor. Safe reads retry at most once.
Cancelling one caller ends only its own wait; shared renewal has its own bounded
timeout. A delayed 401 from before a completed renewal retries the read with the
current cookies rather than rotating again. This coordination is per page, not
a claim of browser-wide serialization.
Protected mutations validate/renew before submission and are never replayed.
Login and logout do not trigger renewal. Requests are bounded and redirects are
refused. Refresh outages remain unavailable, with no cookie clearing. A failure
after persisted rotation but before cookie delivery may ultimately require
reauthentication; the adapter does not reverse rotation or weaken reuse checks
to recover a lost successor. Next standalone behavior is unchanged.

## Evidence boundaries

The Go boundary tests exercise real role middleware and the user service for
same-tenant, wrong-tenant, ordinary-user and anonymous requests. Existing direct
login tests separately prove that an administrator without the required MFA
proof receives no authenticated cookies. These are server request proofs, not a
claim that a browser ceremony ran on a fresh database.

The fresh-install browser proof was repeated successfully on the rebuilt binary
against an isolated, migrated, unbootstrapped database. The operator-backed CE
smoke tests and the complete repository gates remain required before acceptance.
Unit tests and successful builds do not substitute for those checks. Asset
publication, provenance custody and removal of the UI service remain later owner
decisions.

The automatic-refresh browser proofs use the real exported UI and Go binary
against a disposable, migrated and bootstrapped PostgreSQL database. Removing
only the access cookie must renew on a guarded reload and before one profile
mutation, with a different HttpOnly refresh cookie after each renewal and only
one mutation request. Pausing the labelled fixture database must instead leave
the refresh cookie intact, show unavailable and submit no profile mutation.
These prove missing-access renewal and a store outage; they do not stand in for
clock-expiry or the operator-backed CE smoke ceremony.

With `IDENTUUM_E2E_EXPORT_SECONDARY_BASE_URL`, a separate proof submits the same
refresh cookie concurrently to two Go processes sharing the fixture database.
Both requests may succeed within the existing predecessor grace window, but
exactly one response must set a new refresh cookie. After the unchanged
10-second grace window, predecessor reuse must be refused; the winning
successor must then be refused by the other process because family revocation
is shared. A control with separate databases fails the same proof.
The second URL must use a distinct loopback port on the same host. Both fixture
processes use the same issuer and encryption configuration; the existing
`IDENTUUM_IDP_ALLOW_MULTI_REPLICA=true` option permits the isolated experiment.
This does not qualify OSS for production multi-replica deployment, force a
particular SQL interleaving, or replace a process-restart proof.

A separate live restart measurement retains the browser context in memory,
stops the Go process, and starts a new process against the same PostgreSQL
database and unchanged encryption configuration. Renewal after that restart
was accepted; after confirmed UI logout, another restart still refused the
revoked refresh cookie. No browser state or enrollment secret was written to
a file. This is a manual fixture measurement, not an additional Playwright
test case. Natural access-token expiry is a separate measurement: runtime
wiring retains the service's one-hour access-token lifetime.

The live clock proof completed on 2026-09-23 with the issued lifetime measured
as 3,600 seconds. It waited for that token's real expiration without changing
the clock, cookie expiry or token configuration. Go then refused the original
access token with 401; reloading the browser renewed once through the BFF,
rotated the refresh cookie and restored the guarded page without a new login.
The worker exited successfully and stopped its disposable application and
database. This manual observation does not replace the required CE smoke runs
or final repository validation.

## Browser proof custody

The export Playwright configuration has no web server: it targets the Go binary
at `IDENTUUM_E2E_EXPORT_BASE_URL`. The `fresh` phase requires a migrated,
unbootstrapped disposable installation. The `ready` phase requires a newly
bootstrapped disposable installation and its fixture password supplied in the
process environment. Enrollment secrets and browser authentication state stay in
one worker's memory; a new process requires a new fixture. The suite does not
read or write secret files or browser storage-state files.

For the real database-outage proofs, supply
`IDENTUUM_E2E_EXPORT_FIXTURE_CONTAINER`. The suite refuses to pause a container
unless its `identuum.ui-export-proof` label is `disposable`. It authenticates
before pausing, holds the browser state in memory, then unpauses in teardown.
Use only the disposable database backing that proof binary, never a development
or production database. The fixture owner must also restore and stop its own
processes after an interrupted test worker; no database deletion is required.

Trace, video and screenshots are disabled. The configuration also sets
`PLAYWRIGHT_NO_COPY_PROMPT=1`: the installed Playwright 1.63 implementation
otherwise captures an accessibility snapshot on failure even with those other
artifacts disabled, potentially recording enrollment material. Recheck that
behavior when upgrading Playwright.

The credentialed proof also checks private bodies and cookie absence through
boolean assertions, so an assertion failure does not print the inspected value.
After login and renewal, it checks script-readable cookies, local storage and
session storage against both the credential field names and the actual issued
token values. Renaming a storage key must not hide a leaked value from the proof.
Its HTTP requests and credential-entry operations replace transport/action errors
with a generic failure: Playwright's original errors can include submitted
Authorization headers or field values. Successful responses and the original
status, body and cookie requirements are preserved.
