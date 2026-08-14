FLOOR: 45

| ID | one-sentence rule | enforced-by | check | red-proof | hash |
|---|---|---|---|---|---|
| MFA-SA-1 | The site-admin MFA enrollment ceremony completes end-to-end with recovery codes shown. | playwright | e2e/site-admin-mfa-enrollment.spec.ts @ e2e-run | - | d1b659957e2b |
| WIZARD-1 | The OSS setup wizard runs fresh-appliance to signed-in site_admin in one ceremony. | playwright | e2e/oss-wizard-ui.spec.ts @ e2e-run | - | 01cc6700c00f |
| COOKIE-1 | A stale cookie never blocks a second sign-in in the same browser context. | playwright | e2e/login.spec.ts @ e2e-run | - | 2b3b76fe35e6 |
| ABSENT-AG-1 | A not-enabled AG backend is absent from platform status, never shown as failing. | playwright | e2e/platform-status.spec.ts @ chromium | - | f3d98f54eff0 |
| PIN-CHIP-1 | The wizard displays the pinned login site_admin@system.local read-only and demotes the typed address to contact email. | playwright | e2e/oss-wizard-ui.spec.ts @ e2e-run | - | 01cc6700c00f |
| GUARD-LOGIN-1 | Every protected surface redirects an unauthenticated request to /login. | playwright | e2e/health-and-redirects.spec.ts @ chromium | - | 4e1c062d9fd4 |
| GUARD-404-LOGIN-1 | /site-admin/login is not a route and stays 404. | playwright | e2e/health-and-redirects.spec.ts @ chromium | - | effd2ef6b6c2 |
| LICENSE-AGREE-1 | The license state reported by setup and component surfaces always agrees. | playwright | e2e/ce-customer-smoke-license-status.spec.ts @ ce-smoke-run | - | c072b4cafdce |
| CE-SETUP-MFA-1 | CE setup completion refuses a request without MFA fields. | playwright | e2e/ce-fresh-m1-setup.spec.ts @ ce-m1-run | - | ef95c7cde58f |
| CLAIM-INVALID-1 | An unrecognised claim token renders the safe invalid-link state. | playwright | e2e/claim.spec.ts @ chromium | - | ac06f42614aa |
| VERIFY-EMAIL-SAFE-1 | An unrecognised verification token renders a safe error state. | playwright | e2e/verify-email.spec.ts @ chromium | - | 7ab7fa1a769f |
| VERIFY-RESEND-GENERIC-1 | Verification resend answers with a generic sent message, never account state. | playwright | e2e/verify-email.spec.ts @ chromium | - | d35edde4b3b4 |
| ROLE-ORGUSER-FENCE-1 | An org_user is fenced out of the org-admin and site-admin areas. | playwright | e2e/dashboard.spec.ts @ e2e-run | - | c396fdbee489 |
| LOGIN-MFA-FALLBACK-1 | Enrollment-required with a null session falls back to a safe message. | playwright | e2e/login.spec.ts @ chromium | - | 1df4d54f9013 |
| LOGIN-MFA-VERIFY-1 | mfa_required routes the user into the MFA verify form. | playwright | e2e/login.spec.ts @ chromium | - | 6ffcbd1d0b4e |
| LOGIN-NO-AUTOSUBMIT-1 | A fresh /login visit never auto-submits the password form. | playwright | e2e/login.spec.ts @ chromium | - | 6b3c30c464f1 |
| LOGIN-WEBAUTHN-GATED-1 | Without WebAuthn support the passkey affordance is gated off and password login still renders. | playwright | e2e/login.spec.ts @ chromium | - | 422e387f4e09 |
| LOGIN-WEBAUTHN-PASSIVE-1 | Rendering /login never invokes navigator.credentials. | playwright | e2e/login.spec.ts @ chromium | - | df111fe18099 |
| NOLEAK-BODY-1 | Page bodies never contain credential material. | playwright | e2e/account-settings.spec.ts @ e2e-run | - | 66e1c9bba057 |
| APIRES-SAFE-1 | API-resource safe surfaces render no rotate or secret affordances. | playwright | e2e/org-admin-api-resources.spec.ts @ e2e-run | - | 602fdd33f047 |
| APP-NOSECRET-1 | Application pages never render a secret-shaped string. | playwright | e2e/org-admin-applications.spec.ts @ e2e-dynamic | - | 63390c1ae669 |
| APP-DANGER-GATE-1 | Destructive delete requires the type-to-confirm gate; a first click never deletes. | playwright | e2e/org-admin-applications.spec.ts @ e2e-dynamic | - | 958125bcb09f |
| APP-ROTATE-ONCE-1 | A rotated secret is shown copy-once and navigating away clears it. | playwright | e2e/org-admin-applications.spec.ts @ e2e-dynamic | - | d0c13b0e8eff |
| SA-SAFE-1 | Service-account safe surfaces render no credential or rotate copy. | playwright | e2e/org-admin-service-accounts.spec.ts @ e2e-run | - | f5dc44161255 |
| SA-NAME-CONFLICT-1 | Renaming a service account to an existing name surfaces the 409 conflict. | playwright | e2e/org-admin-service-accounts.spec.ts @ e2e-dynamic | - | 03869d3dd4e7 |
| ORGREC-READONLY-1 | The org record is read-only for org_admin; writes are refused with 403. | playwright | e2e/org-admin-settings.spec.ts @ e2e-dynamic | - | b02bf9e24f4a |
| DOMAINS-PRIMARY-1 | Exactly one primary verified domain exists and it carries no operator controls. | playwright | e2e/org-admin-settings.spec.ts @ e2e-dynamic | - | d65bc2a6f3b2 |
| ORG-AUDIT-SCOPE-1 | The org-admin audit view is org-scoped with no site-admin navigation. | playwright | e2e/org-admin-smoke.spec.ts @ e2e-run | - | 32eef428d352 |
| ROLE-ORGADMIN-FENCE-1 | An org_admin is redirected away from site-admin surfaces. | playwright | e2e/org-admin-smoke.spec.ts @ e2e-run | - | 2ec3e03ad27e |
| PASSWORD-ROTATE-1 | After a password rotation the old password no longer logs in. | playwright | e2e/oss-change-password.spec.ts @ oss-change-password-run | - | e7576a17234b |
| CONTRACT-SURFACE-1 | Discovery advertises the issuer and the served OAuth endpoints. | playwright | e2e/oss-contract.spec.ts @ chromium | - | 0c602c06b6c0 |
| CONTRACT-CLIENT-AUTH-1 | The token endpoint is client-auth-gated, answering 401 rather than 404. | playwright | e2e/oss-contract.spec.ts @ chromium | - | eb877abe6388 |
| PASSKEY-PERSIST-1 | A registered passkey persists across page reloads. | playwright | e2e/passkey-flow.spec.ts @ e2e-run | - | af5199b9fbce |
| ABSENT-NEVERHIDE-1 | Absence rules never hide a configured backend. | playwright | e2e/platform-status.spec.ts @ chromium | - | 8b51200e94e0 |
| RUNTIME-BADGE-1 | The mode badge always corresponds to the /api/runtime mode. | playwright | e2e/platform-status.spec.ts @ chromium | - | 601c40ec4c5b |
| RUNTIME-SHAPE-1 | /api/runtime returns a valid RuntimeState shape. | playwright | e2e/platform-status.spec.ts @ chromium | - | ec76b9c2e428 |
| RUNTIME-NOLEAK-1 | /api/runtime never exposes internal URLs or secrets. | playwright | e2e/platform-status.spec.ts @ chromium | - | 3100037e828b |
| MFA-RESET-REENROLL-1 | After an MFA reset the next login routes into TOTP enrollment. | playwright | e2e/site-admin-admin-recovery.spec.ts @ e2e-destructive | - | dbd2ba502c87 |
| AUDIT-SUBJECT-LINK-1 | Audit subject filters resolve to valid organization links. | playwright | e2e/site-admin-audit.spec.ts @ e2e-run | - | d091a487ae67 |
| SA-ORG-COPY-1 | Organization detail admin-status copy is accurate, never stale. | playwright | e2e/site-admin-organizations.spec.ts @ e2e-run | - | 2573e8f768ca |
| SA-ORG-DESTRUCTIVE-1 | Destructive lifecycle actions require the checkbox confirm form; reversible ones never do. | playwright | e2e/site-admin-organizations.spec.ts @ e2e-run | - | ca4072618935 |
| BACKUP-PRUNE-1 | Backup prune fires only on confirm, exactly once, and removes only its target. | playwright | e2e/upgrade-backup.spec.ts @ chromium | - | 6694ae77cc51 |
| OBS-PASSIVE-1 | Observability pages render passively and never expose environment internals. | playwright | e2e/site-admin-observability.spec.ts @ e2e-run | - | 07ba5173ad64 |
| NOLEAK-LOGIN-1 | The /login page body never contains WebAuthn credential material or other credential terms. | playwright | e2e/login.spec.ts @ chromium | - | c2e1e78b4f5e |
| RUNTIME-NOLEAK-2 | /api/runtime never contains secret, password, or private_key material. | playwright | e2e/platform-status.spec.ts @ chromium | - | b5e9cb6c43bc |
