# Changelog — identuum-ui

All notable changes to `identuum-ui` are recorded here, starting from the
first published image. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/). The published artifact is the
container image (`ghcr.io/identuum/identuum-ui`); versions are image tags.

## Unreleased

- Sign-in: the organization lookup sends `X-Identuum-Login-Step-Status: 200`
  and reads a miss by its body, so an email domain that is no organization's
  is not logged as a failed resource. A pending self-registrant's correct
  password reads "Your account is waiting for an administrator's approval."
  (it read "Login failed. Try again."), under either status the IdP answers.
- e2e-full: the provisioner seeds a must-change-password user into the run's
  envelope, so console-clean's password-change walks run inside export-specs
  (no skip), and register.spec asserts zero console errors.

## `v0.6.0`

The static export that identuum-idp-oss `v0.9.0` embeds. Delta
`v0.5.3..HEAD`: 29 commits (measured at `e93c626`) and the release commit.
Minor: new pages and sections; no removed or renamed page, field or call.

- Self-registration (D-021, identuum-idp-oss `v0.9.0`), behind two switches
  that both start off:
  - Site admin, **Settings → Self-registration**: the instance switch, with
    its one-line explanation.
  - Org admin, **Organization settings → Self-registration**: allow
    sign-up, hold new accounts for approval, require a verified email
    (disabled, with the reason, where the IdP sends no mail; a 400
    `smtp_not_configured` is shown plainly) and email domains; read-only
    with a note while the instance switch is off; the organization's
    sign-up link with Copy.
  - The public **`/register/<org_slug>`** page: a closed and an unknown
    organization both read "Sign-up is not available"; the form takes
    email, name and password with the organization's stated policy, checks
    the policy before sending, shows a `weak_password` refusal inline, and
    every accepted sign-up reads one neutral message for the organization's
    settings. Its calls reach the IdP's public routes directly.
  - Org admin, **Users**: sign-ups waiting for approval, with Approve and
    Reject (Reject asks first).
- Archived organizations: the console reads the IdP's `deleted_at` as
  deleted (organization page and own organization), so an archived
  organization's page offers no action but Restore; its administrator rows
  say why instead of showing a disabled Reset MFA.
- e2e-full runs the export's own specs (console-clean, claim-link, register)
  against the binary it builds, as the `export-specs` phase.
- next 16.3.7 → 16.3.8, which now clears pnpm's release age without an
  exclude list.
- Site admin, organization page: **Issue claim link** for an active
  organization with no administrator (D-022, identuum-idp-oss
  `POST /api/v1/organizations/:id/claim`). An optional email binds the link
  (mailed only when email delivery is configured on the IdP); the link is
  shown once with Copy and its expiry; issuing again warns first that the
  earlier link stops working. A refusal says why: the organization already
  has an administrator (an invited one counts), or the IdP cannot build a
  link without `IDENTUUM_IDP_UI_PUBLIC_BASE_URL`.

## `v0.5.3`

The static export that identuum-idp-oss `v0.8.2` embeds. Delta
`v0.5.2..HEAD`: 8 commits (measured at `46042f7`) and the release commit.
Patch: no removed or renamed page, field or call.

- next 16.3.6 → 16.3.7, the newest stable that clears pnpm's release age
  without an exclude list (16.3.8 does not yet).
- Sign-in: an MFA sign-in on `/login` no longer logs a browser console
  error. The password step sends `X-Identuum-Login-Step-Status: 200`; an IdP
  that supports it (identuum-idp-oss `v0.8.2`) answers the MFA next
  step with 200 and the same body instead of 401. An IdP without it still
  answers 401, and both forms reach the MFA step.
- Sign-in, activation and claim: the same opt-in now covers the
  password-change step (its MFA continuation) and the activation and claim
  pending-MFA probes, and the console's session probe and refresh. With an
  IdP that supports it, a signed-out visit to `/` and a sign-in that must
  change its password log no browser console error; the probe reads the
  IdP's 200 `{"authenticated":false}` as signed out, still tries the refresh
  cookie first, and a call that did not opt in still sees the 401.
- Account MFA: a 400 from recovery-code regeneration or MFA disable is read
  by its error code. Only `mfa_not_enrolled` shows "MFA is not enrolled on
  this account."; any other 400 shows the generic error.
- The MFA sign-in step announces its error as `role="alert"`, like the
  password step; the e2e sign-in helper reads that role and no longer
  matches error wording.

## `v0.5.2`

The static export that identuum-idp-oss `v0.8.1` embeds: everything listed
under `v0.5.1` below, plus the fix that lets it publish. Delta
`v0.5.0..HEAD`: 21 commits (measured at `6a0d32e`) and this notes commit.
Patch: no removed or renamed page, field or call.

### Fixed

- **The release SBOM recipe runs on Linux.** `make export-sbom` (and
  `make sbom-scan`) created its scratch directory with `mktemp -d -t`,
  which GNU mktemp refuses without `XXXXXX`; the `v0.5.1` export workflow
  failed there before publishing anything. Both now use
  `mktemp -d "${TMPDIR:-/tmp}/<name>.XXXXXX"` and stop if no directory is
  made.

## `v0.5.1`

Tagged (`4e4a637`) and never published: its export workflow failed in
`make export-sbom` (fixed in `v0.5.2`, which carries all of the below).

The static export that identuum-idp-oss `v0.8.1` embeds. Delta
`v0.5.0..HEAD`: 17 commits (measured at `bcd0783`) and this notes commit.
The published artifact is the export (`publish-ui-export.yml` on the tag);
no container image is published. Patch: no removed or renamed page, field
or call.

### Security

- **next 16.3.4 → 16.3.6** (GHSA-vcvr-r3jv-pc5j, critical: remote code
  execution in `next/og` `ImageResponse`, vulnerable `>=16.2.0 <16.3.6`).
  The shipped UI is the static export, which runs no Next server, so the
  vulnerable server path is not reachable in the embedded console; the
  bump keeps the dependency tree clean. 16.3.8 (latest) waits for pnpm's
  release-age safeguard.

### Changed

- **The release SBOM describes what ships** (owner ruling D-019): the
  attached `identuum-ui-export-<tag>.spdx.json` is the production
  dependency closure (`make export-sbom`: 203 packages at this release)
  instead of syft over the whole checkout, which listed dev tooling. The
  same file is what the security gate (`make sbom-scan`, lictor v0.4.3)
  judges.
- **The Next.js runner image is development-only** (D-019): no workflow
  publishes it (`publish-image.yml` removed) and no release gate judges it.

### Fixed

- Site admin: an organization created without an admin email (active, no
  administrator, none pending) now offers **Invite the first administrator**
  on its Assign administrator page — an email, an optional name, and the
  one-time invitation shown for hand-over (mailed only when email delivery is
  configured). Before, that page could only re-issue a pending
  administrator's activation and answered "already active" (GitHub issue #1).
  A pending activation, and the recovery state, keep the re-issue.

## `v0.5.0`

The static export that identuum-idp-oss `v0.8.0` embeds. Delta
`v0.4.0..HEAD`: 25 commits (measured at `9c8f303`) and this release commit.
As for `v0.4.0`, the published artifact is the export
(`publish-ui-export.yml` on the tag); no container image is published.
Minor, not patch: new sign-in step, application option, user action and
audit columns.

### Added

- **First sign-in with an admin-set password** (OSS-FIN-1, D-017): when the
  IdP answers `password_change_required`, the sign-in shows "Choose a new
  password" (new + confirm); the new password goes to
  `POST /api/v1/auth/login/password-change`, and the sign-in continues to MFA
  enrolment or verification when the policy asks, else the dashboard.
- **First-party (skip consent)** (OSS-FIN-2, D-018): the new-application
  form and a confidential application's edit form carry the checkbox with a
  one-line warning; the application's page shows it. The IdP's refusal for a
  public application reads "A public application cannot skip consent".
- **Send invitation for a user created with a password before D-017**
  (OSS-FIN-2): an active, unverified user's page offers it where the IdP
  declares `user_invite`; the one-time link is shown once, as for Invite
  user.
- **The audit log names the actor and the organization** (OSS-FIN-3): the
  site-admin and organization-admin audit tables show the actor's type and
  role with its email, a client's client_id or a short id, and an
  Organization column for the organization the row concerns (the
  organization admin's own by name; a site admin's rows link to the
  organization; "Platform" when none). The organization admin's page lists
  its organization's rows whoever acted, a site admin included.

### Changed

- **A pending organization's list row reads "Waiting for activation"** and
  offers "Re-issue activation link" (the organization's page) instead of
  "Admin active" + Reactivate, from the IdP's `activation_pending`.
- **assign-admin and the organization page say what they do** (D-016): issue
  or re-issue the activation link, or assign the first administrator — no
  "delegation" or "claims".
- **Audit From/To are the viewer's local days** (U-020): the form sends their
  UTC instants (`start_utc`/`end_utc`); without script the day is read as UTC,
  as before. The form says so.

## `v0.4.0`

The static export that identuum-idp-oss `v0.7.0` embeds. Delta
`v0.3.3..HEAD`: 37 commits (measured at `da8f70b`) and this release commit.
As for `v0.3.3`, the published artifact is the export
(`publish-ui-export.yml` on the tag); no container image is published.
Minor, not patch: new pages and actions (user invite, activation re-issue).

### Added

- **Invite a user** (`05f0c96`, D-016): Users → Invite user
  (`/org-admin/users/new`) shows the one-time link with Copy, its token and
  its expiry once; pending users read "Invitation pending", and their page
  offers "Re-issue invitation". The public `/invite?token=` page validates
  the link, sets the password and sends the user to sign-in. Each appears
  only where the IdP declares `capabilities.user_invite`.
- **Re-issue a pending organization's activation link** (`935873d`): a
  pending organization's page offers "Re-issue activation link". It asks
  first, then shows the new link with Copy, the token and the expiry once;
  the earlier link stops working. assign-admin shows the same panel.

### Changed

- **`/activate` works without mail** (`12eb4e1`): it is offered where the IdP
  can send mail OR declares `capabilities.activation_link`. The setup wizard
  names the `show-setup-code` subcommand.
- **The console says what D-016 says** (`9745185`, `935873d`): the
  new-organization form, assign-admin, `/activate` and `/claim` say that the
  one-time link is shown to hand over and is mailed only when email delivery
  is configured. Reactivate on a never-activated organization explains the
  IdP's `409 activation_pending` and points to "Re-issue activation link".
- **A deleted organization's row links only to Restore** (`cf2f5f7`).
- **Client reads match what the IdPs return** (`7b89515`): rotate reads the
  nested client; service-account disable/enable take OSS's `204`; unlink
  and the linked list read the safe client; assign-admin names an unbound
  invitation; the TOTP step names a `429`.
- **org-admin audit follows `capabilities.org_audit`** (`4d1f952`): no Audit
  link, page fetch or recent-activity card where the IdP declares it false.
- **Protocol settings have no site_admin save path** (`df025d5`): both
  editions refuse site_admin.
- **org-admin settings read the identity provider from the singular route
  only** (`357429c`); `identity_provider: null` is none.

### Verification machinery (repository-visible, not in the export)

- e2e-full exercises the user invite and its two public endpoints
  (`0c63dd6`, `43f05d0`, `b3e852e`). The role-matrix denominator is
  144/94/30 -> 147/95/32 (`4f53af9`, owner-authorized).
- `grype-allowlist.json` names GHSA-2vr4-cq9g-pvrc and GHSA-rpw4-54j3-4h4q
  (npm's ip-address in the runner base image, not a ui dependency; owner
  ruling) (`9c1e442`).

## `v0.3.3`

The static export that identuum-idp-oss `v0.6.3` embeds. Delta
`v0.3.2..HEAD`: 14 commits (measured at `36377cf`) and this release
commit. As for `v0.3.2`, the published artifact is the export
(`publish-ui-export.yml` on the tag); no container image is published.

### Changed

- **`/` sends a signed-in visitor home** (`1c055e9`): site_admin to
  `/site-admin`, org_admin to `/org-admin`, org_user to `/dashboard`;
  anyone else to `/login`. It used to send every visitor to `/login`.
- **`/reset-link` follows `capabilities.admin_reset_link`** (`2773d3e`):
  where it is not true, the page says it is not available on this
  installation and calls nothing.
- **The create-application form follows `capabilities.public_clients`**
  (`bdc3489`, `5f1230c`): an explicit false (identuum-idp-ce) hides the
  public-client option; absent keeps it, so identuum-idp-oss is unchanged.
  The runtime composition now passes the key through, and platform-status
  labels it (`1d9ba78`).

### Verification machinery (repository-visible, not in the export)

- e2e-full's crud-sweep expects 404 for a DELETE of another
  organization's client or of an unknown id (`eb2d1ef`), the answer
  identuum-idp-oss `v0.6.3` gives.

## `v0.3.2`

The static export that identuum-idp-oss `v0.6.2` embeds. Delta
`v0.3.1..HEAD`: 11 commits (measured at `6362206`) and this release
commit. As for `v0.3.1`, the published artifact is the export
(`publish-ui-export.yml` on the tag); no container image is published.

### Added

- **The mail ceremonies follow the IdP** (`ca63f2f`). They are driven by
  `GET /api/v1/component` `capabilities.mail_ceremonies`, which is false
  on identuum-idp-ce and on identuum-idp-oss without SMTP. When it is false:
  - the sign-in form offers no "Forgot password?" and says "Ask your
    administrator to reset your password.";
  - `/forgot-password`, `/reset-password`, `/verify-email` and `/activate`
    say "not available on this installation" and call nothing.

  A binary that does not report the key keeps the pages, as before.
- **The org_admin's one-time password reset link** (`ca63f2f`), shown where
  `capabilities.admin_reset_link` is true (identuum-idp-ce):
  - "Create password reset link" on the user detail page; the link is
    shown once, with a copy button, and never stored;
  - `/reset-link` redeems it, with `Referrer-Policy: no-referrer`.

### Changed

- **Approve follows `capabilities.user_approval`** (`dd609fb`): only an
  explicit false (identuum-idp-ce, which has no pending registrations)
  hides Approve on the org-admin user detail page.

### Fixed

- **forgot-password reports "sent" only on a 2xx** (`ca63f2f`): a 404, 429
  or 5xx is a retry message, never "sent".

### Verification machinery (repository-visible, not in the export)

- `make e2e-quick` (`b5998e8`): the e2e-full harness in its quick mode,
  which is fresh appliance, provisioner, verify-record refusals and one
  dev-loop phase over the eight quick specs.
- e2e-full's appliance gets a local mail sink (`bdc0195`,
  `e2e-full/compose.mail-sink.yml`: mailpit by digest, no host port), so the
  token-page and verify-email specs exercise the real forms.

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
