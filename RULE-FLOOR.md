FLOOR: 5

| ID | one-sentence rule | enforced-by | check | red-proof | hash |
|---|---|---|---|---|---|
| MFA-SA-1 | The site-admin MFA enrollment ceremony completes end-to-end with recovery codes shown. | playwright | e2e/site-admin-mfa-enrollment.spec.ts @ e2e-run | - | d1b659957e2b |
| WIZARD-1 | The OSS setup wizard runs fresh-appliance to signed-in site_admin in one ceremony. | playwright | e2e/oss-wizard-ui.spec.ts @ e2e-run | - | 01cc6700c00f |
| COOKIE-1 | A stale cookie never blocks a second sign-in in the same browser context. | playwright | e2e/login.spec.ts @ e2e-run | - | 2b3b76fe35e6 |
| ABSENT-AG-1 | A not-enabled AG backend is absent from platform status, never shown as failing. | playwright | e2e/platform-status.spec.ts @ chromium | - | f3d98f54eff0 |
| PIN-CHIP-1 | The wizard displays the pinned login site_admin@system.local read-only and demotes the typed address to contact email. | playwright | e2e/oss-wizard-ui.spec.ts @ e2e-run | - | 01cc6700c00f |
