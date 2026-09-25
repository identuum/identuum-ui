# Changelog — identuum-ui

All notable changes to `identuum-ui` are recorded here, starting from the
first published image. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/). The published artifact is the
container image (`ghcr.io/identuum/identuum-ui`); versions are image tags.

## `v0.3.1`

Fixes to the static export that identuum-idp-oss `v0.6.1` embeds. Delta
`v0.3.0..HEAD`: 17 commits (measured at `cf6575a`) and this release
commit. As for `v0.3.0`, the published artifact is the export
(`publish-ui-export.yml` on the tag); no container image is published.

### Added

- **`/logout` is a page** (`bdeb441`): its only action is the sign-out
  form's POST; loading it makes no request, so a link or a prefetch never
  signs out.

### Changed

- **One date display** (U-020, `91c0519`, `189756b`): every date the UI
  shows renders through `<LocalTime>` — formatted in the browser's own
  zone with the zone shown, the exact UTC ISO on hover; what the UI sends
  (audit date filters, service-account expiry) stays UTC ISO. The server
  render no longer formats a date in its own zone, which had caused a
  hydration mismatch between 23:00 and 00:05 UTC.
- **Surfaces no edition serves are removed** (owner decision 5,
  `48f8f33`): the site-admin reports page offers no report export link
  (it states that no edition serves report exports), the org-admin settings
  page has no webhooks list, and passkeys can no longer be renamed (the
  Rename control sent a PATCH neither edition answers). Removing a passkey
  is unchanged.
- **Session revoke uses one route on every edition** (`dfe479d`):
  `POST /api/v1/revoke {session_id}`, without asking which edition it is.
- **The upgrade-mode boot** (`cc23515`): when `/api/v1/component` is absent
  the export asks `/api/upgrade/status` and routes to `/upgrade` when the
  state needs the wizard, as the Next ladder does.
- `logout`: the Next route also expires `refresh_token` at
  `Path=/bff/session/` (identuum-idp-oss v0.6.0, D3) (`9add676`).

### Fixed

- **A cookie-session sign-out that revoked is confirmed** (`39b7e1a`): a
  2xx answering `{"logged_out":true}` is "signed out", not "unconfirmed".
- **Account settings, profile tab** (`1997bec`): `GET /api/v1/profile`
  answers the user object itself, and the page read `data.user`, so every
  field showed empty and saving sent a clear for each. It reads the object
  now (a `user` wrapper is still accepted).
- **Account settings, sessions tab** (`1997bec`): the IdP's 403 for a
  site_admin shows the administrator notice, not "Could not load sessions".
- `/claim` declares `Referrer-Policy: no-referrer`; its URL carries the
  claim token (`1997bec`).

## `v0.3.0`

The UI ships as a static export that the IdP binary serves: identuum-idp-oss
`v0.6.0` embeds it and answers UI and API on one origin, with no UI
container and no Node at runtime. Delta `v0.2.4..HEAD`: 39 commits
(measured at `1eb489d`) and this notes commit. The published artifact of this release is the export
(`publish-ui-export.yml` on the tag: a deterministic tarball, its
`identuum-ui-vendor.v1` manifest with every file's sha256 and the tree
digest, an SPDX SBOM, and a build-provenance attestation over the three, as
release assets); no container image is published for it.

### Added

- **The static export** (`export/`, `pnpm build:export`): the shared Next
  pages — sign-in, first-run setup, account settings, the org_user
  dashboard, the org-admin and site-admin areas, activate, claim, password
  reset, email verification, upgrade, platform status — rendered through a
  platform layer, talking to the binary through its `/bff` boundary. Every
  `/bff` request carries `X-Requested-With: identuum-ui`, reads included.
  Library code is split into size-capped chunks; every emitted file is under
  1 MiB.
- **`publish-ui-export.yml`** (`7abd92c`): builds the export from a tag with
  node 26.8.1 and pnpm 11.3.0 exactly and publishes it as above; a dispatch
  without a tag builds, attests and uploads a workflow artifact only.

### Changed

- A session validation answered `429` is "unavailable", never a verdict
  (`9a1fd9e`); sign-out is a same-origin POST, and only an unmarked `204`
  confirms revocation (`892ecb1`); a user-detail read that fails at the IdP
  renders "unavailable", not "not found" (`5377276`).
- **The export asks an edition only for what it serves** (`1eb489d`). It
  reads `edition` once from the binary's `/api/runtime-config`; on any edition
  but `ce` the IdP routes only identuum-idp-ce serves —
  `/api/upgrade/status`, `/api/setup/license`, anomaly events and stats,
  audit event types, system sessions, audit-chain verify, organization
  identity providers and webhooks — are answered in the page with the
  binary's own 404 and never requested, so the OSS binary shows no browser
  console errors for them. On `ce` they are requested as before.
- The site-admin organization page no longer requests the organization's
  protocol settings (`1eb489d`): every edition refuses site_admin on a
  tenant's own resource, and the page shows that refusal, as before,
  without the request.

### Operator notes

- The Next server and its container image are unchanged by this release and
  are not what identuum-idp-oss `v0.6.0` runs; the IdP binary vendors this
  release's export by commit and checks its digest (`make ui-vendor-check`).

## `v0.2.4`

Site administrators can restore a deleted organization. Delta
`v0.2.3..HEAD`: the e2e seed fix `cf8650d` (e2e helpers and a rule-floor
rehash; no shipped code), the fix commit and this release commit; the
image build (Dockerfile, runtime base, `.dockerignore`) is unchanged from
`v0.2.3`.

### Fixed

- **Restoring a deleted organization works on OSS** (`0145be9`). OSS answers
  a read of a soft-deleted organization by id with 404 by contract, so the
  restore page always said "Organization not found". The page now finds the
  organization among the list's deleted rows (pages of 100, at most 20
  pages, stopping at the first match). The list now reads OSS's
  `deleted_at`, so deleted rows show Restore; before, every row read as
  live.

### Security (image)

- Runtime base unchanged from `v0.2.3`
  (`cgr.dev/chainguard/node@sha256:1f903d44fc11a6f6e74447fc2c6a3c141f112217576be5d96c283210116b5d25`,
  node v26.9.0 measured in the built image). `make grype-scan` (grype
  0.119.0 through lictor) on the image built at this release:
  `matches=1 fixable=0 allowlisted=0 unfixable=1 severe=0` — CVE-2026-89092,
  Medium, glibc 2.44-r6, fix state `unknown`, as in `v0.2.3`.

## `v0.2.3`

Three fixes found by the identuum-idp-oss `v0.5.0` release-candidate
rehearsal. Delta `v0.2.2..HEAD`: these three commits and this release
commit; the image build (Dockerfile, runtime base, `.dockerignore`) is
unchanged from `v0.2.2`.

### Security

- **Cross-origin state changes are refused** (`355a22c`). The `/api/idp`
  proxy and `POST /api/auth/logout` now allow a method other than
  GET/HEAD/OPTIONS only when Origin equals the runtime config's `ui_origin`
  (or, when that is unset, the Origin host equals Host), or, with no
  Origin, when `Sec-Fetch-Site` is `same-origin`. Anything else gets 403
  before any upstream call. Before, a page on another origin of the same
  site could act through the proxy with the user's cookie.

### Fixed

- **Sign-out lands on /login** (`7405e33`). The logout redirect was built
  from the container's listen address (`http://0.0.0.0:7104`) and ended on
  a connection error; it is relative now.
- **Users: a disabled member is Disabled, with Enable** (`80c0035`). A
  banned org_user was always shown as "Pending approval" with no Enable
  control. It is Disabled with Enable unless the organization takes public
  registrations and holds them for approval (or its policy could not be
  read); there it is "Disabled or awaiting approval" with both Enable and
  Approve registration.

### Security (image)

- Runtime base unchanged from `v0.2.2`
  (`cgr.dev/chainguard/node@sha256:1f903d44fc11a6f6e74447fc2c6a3c141f112217576be5d96c283210116b5d25`,
  node v26.9.0 measured in the built image). `make grype-scan` (grype
  0.119.0 through lictor v0.4.2) on the image built at this release:
  `matches=1 fixable=0 allowlisted=0 unfixable=1 severe=0` — CVE-2026-89092,
  Medium, glibc 2.44-r6, fix state `unknown`, as in `v0.2.2`.

## `v0.2.2`

Two fixes for the org-admin pages against identuum-idp-oss, cut for the
`v0.5.0` install. Delta `v0.2.1..HEAD`: these two commits and this release
commit; the image build (Dockerfile, runtime base, `.dockerignore`) is
unchanged from `v0.2.1`.

### Fixed

- **Applications: the created client reads correctly** (`3494727`). OSS
  answers a create with `{"client": {...}, "client_secret": "..."}`; the
  success panel read the fields from the top level and showed
  " has been created." with an empty client ID and no redirect URIs. The
  nested client is read now and the one-time secret from the top level; a
  flat answer still works.
- **Users: account status reads correctly** (`c9ede3c`). OSS carries
  `banned`, not `active`, on a user (and writes `banned = !active`); the
  users list and user detail coerced the absent `active` to false, so every
  user, the signed-in admin included, showed as Disabled and offered only
  "Enable". `active` is now derived as `!banned` when absent; an explicit
  `active` still wins.

### Security (image)

- Runtime base unchanged from `v0.2.1`
  (`cgr.dev/chainguard/node@sha256:1f903d44fc11a6f6e74447fc2c6a3c141f112217576be5d96c283210116b5d25`,
  node v26.9.0 measured in the built image). `make grype-scan` (grype
  0.119.0 through lictor v0.4.2) on the image built at this release:
  `matches=1 fixable=0 allowlisted=0 unfixable=1 severe=0` — CVE-2026-89092,
  Medium, glibc 2.44-r6, fix state `unknown`, as in `v0.2.1`.

## `v0.2.1`

The image the identuum-idp-oss `v0.5.0` compose should pin instead of
`v0.2.0`, whose runtime base carried 11 grype matches, 5 of them severe.
Measured delta `v0.2.0..HEAD` before this release commit (`git log` and
`git diff --shortstat`): 294 commits, 317 files changed, +20712/−4184 — by
subject line 75 witness records (`Witness: `), 30 manifest re-bases
(subject contains "rebase"), 4 CI records (`ci: record run `) and 185
others. **The 185 application changes are NOT itemized in this section**;
it records the image and build-context changes this release was cut for.

### Security (image)

- **Runtime base moved to the 2026-09-17 digest** (`c4d05c1`):
  `cgr.dev/chainguard/node@sha256:1f903d44fc11a6f6e74447fc2c6a3c141f112217576be5d96c283210116b5d25`,
  node v26.9.0 (measured `node --version` in the built image), from
  `sha256:4a274a26…` (node v26.8.2). It patches zlib to
  `1.3.2.1_rc20260601-r0` and node-gyp to `13.0.2-r1`, removing every
  fixable finding the previous base carried.
- **Scan of the image built from this Dockerfile** (`make grype-scan`,
  grype 0.119.0 through lictor v0.4.2): `matches=1 fixable=0 allowlisted=0
  unfixable=1 severe=0`. The one match is CVE-2026-89092, severity Medium,
  in glibc 2.44-r6, fix state `unknown` — not suppressed, not claimed
  fixed. The publish-gate shape `trivy image --severity HIGH,CRITICAL
  --ignore-unfixed --exit-code 1`: exit 0, zero findings.
- **`.env` files never enter the build context** (`c4d05c1`):
  `.dockerignore` excludes `.env*`, `*.env` and `*.env.*` at any depth.

### Verification machinery

- `LICTOR_VERSION` v0.4.1 → v0.4.2 and `biome.jsonc`'s `$schema` 2.5.10 →
  2.5.12, both following the installed and locked tools (`78a144e`).

## `v0.2.0`

First refresh since `v0.1.0` (built 2026-06-13 from `5158f0b`). Measured
delta `v0.1.0..HEAD` at preparation: 64 commits, 358 files changed,
+53325/−4943 — plus this release-prep commit. The UI now speaks the
RELEASED OSS backend contract end to end and ships with a machine-checked
rule ledger.

### Security (this release's image hardening)

- **Next.js 16.2.6 → 16.2.11** — closes 4 HIGH advisories including an
  authentication bypass (CVE-2026-64642) and SSRF/DoS fixes
  (CVE-2026-64641/-64645/-64649).
- **sharp → 0.35.0** (pnpm override) — inherits the libvips fixes
  (GHSA-f88m-g3jw-g9cj).
- **npm/npx/corepack removed from the runtime image stage** — the
  standalone runner only ever executes `node server.js`; npm's vendored
  node_modules carried 7 HIGH/CRITICAL findings (node-tar CRITICAL among
  them) that have no business shipping. Image size 442→392MB.
- Verified with the publish-gate-shape scan
  (`trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`):
  exit 0, zero findings across all targets.

### Added

- **Bearer BFF transport** — the server-only BFF modules and the `/api/idp`
  browser proxy lift the caller's own httpOnly token into an
  `Authorization: Bearer` header on the server→IdP hop; the token never
  reaches browser JS. This matches the released OSS principal model
  (bearer-only resource APIs) — before this, admin shells rendered while
  every data panel 401'd.
- **Released-contract readers** across organizations, users, service
  accounts, domains, audit events, identity providers, and health — the UI
  reads only keys the released OSS wire actually emits (WIRE-READ pins).
- **Admin state without phantoms** — organization admin status renders from
  the backend's live-count fields (`is_claimed` / `can_assign_admin`) with
  a true tri-state: absence renders "status unavailable", never a false
  "no administrator", and unknown state never yields an Assign affordance.
- **Edition boundaries, not fake outages** — commercial-only surfaces
  (admin sessions, audit-chain verification, anomaly, reports) consult the
  discovered capabilities and render an honest Enterprise/CE boundary
  panel; the audit-chain page pre-gates its Verify invitation so OSS
  operators are never invited to a click the backend refuses.
- **Audit event details** — the audit views project the full measured OSS
  wire contract (outcome, actor/subject identifiers, user agent,
  request/correlation ids, metadata) with a per-event read-only expandable
  details view; the invented always-empty `summary` field is gone.
- **Runtime info & health details** — the System pages classify failures,
  tri-state absent fields as "unknown", and render the OSS
  `/api/v1/health/details` payload honestly.
- **Setup wizard truthfulness** — the completion screen states the pinned
  `site_admin@system.local` sign-in identity (never the operator-typed
  contact address), matching the backend's adopt-and-reset semantics.
- **Absence is not failure** — AG/IdP backend absence renders a shared
  "backend not configured" notice instead of error panels, swept across
  every state surface.
- **Machine-checked rule ledger** — `RULE-FLOOR.md` with 51 armed rules
  (Playwright/vitest-backed, red-proved to the runnable frontier) enforced
  by `pnpm rulefloor` locally and a static floor in CI.

### Changed

- Login is a two-step ceremony (email → Continue → password) with
  mount-gated WebAuthn probing (fixes the login-page hydration mismatch).
- Logout expires its own cookies and re-login self-heals a stale cookie
  lift; SSO enforcement stays server-side.
- Passkey flows run against the released login/logout endpoints (finish
  envelope has no `success` flag; UI origin follows the deployment's base
  URL).
- The e2e appliance suite runs against the PUBLISHED OSS image
  (`v0.3.5`, digest-pinned default) with API-minted disposable fixtures;
  183 tests, 153 green / 30 condition-gated skips at this release.

### Known gaps (recorded, backend-pending)

- Account-settings change-password calls
  `POST /api/v1/auth/change-password`, which the OSS backend does not yet
  serve (approved as the backend's v0.3.6 slice); the surface renders but
  rotation fails against OSS until then.
