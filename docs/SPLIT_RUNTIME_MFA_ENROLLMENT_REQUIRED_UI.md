# Split-Runtime MFA Enrollment Required UI

Last updated: 2026-06-08 (cdx1-identuum-ui-split-runtime-docs-reconciliation)

---

## Backend contract — login endpoint

`POST /api/v1/auth/login` returns different shapes depending on the backend version and outcome:

### A. mfa_enrollment_required — new OSS contract (session_id present)

From `identuum-idp-oss` after `agent-a-identuum-idp-oss-mfa-totp-enrolment-endpoints`:

```
HTTP 401
{"error":"mfa_enrollment_required","mfa_required":true,"mfa_enrollment_required":true,"session_id":"<pending-uuid>"}
Set-Cookie: (none)
```

The `login()` function in `idp-client.ts` matches check 1:
- `body.mfa_required === true && body.mfa_enrollment_required === true` → TRUE
- `body.session_id` is non-empty → returns `{ kind: "mfa_enrollment_required", sessionId: "<uuid>" }`
- `PasswordForm` calls `onMfaEnrollmentRequired(sessionId)` → `LoginFlow` shows `MFAEnrollForm`
- Full in-browser enrollment form runs.

### B. mfa_required — new OSS contract (enrolled user, TOTP verify needed)

```
HTTP 401
{"error":"mfa_required","mfa_required":true,"mfa_enrollment_required":false,"session_id":"<pending-uuid>"}
Set-Cookie: (none)
```

`login()` check 2: `body.mfa_required === true` (mfa_enrollment_required is false) → returns
`{ kind: "mfa_required", sessionId: "<uuid>" }`. `PasswordForm` calls `onMfaRequired(sessionId)` →
`LoginFlow` shows `MFAForm` for TOTP verify.

### C. mfa_enrollment_required — old OSS fallback (no session_id)

Old OSS backend versions that return only the error field without booleans:

```
HTTP 401
{"error":"mfa_enrollment_required"}
Set-Cookie: (none)
```

`login()` check 3 (OSS fallback, fires after checks 1 and 2 do not match):
- `res.status === 401 && body.error === "mfa_enrollment_required"` → TRUE
- Returns `{ kind: "mfa_enrollment_required", sessionId: null }`
- `PasswordForm` shows the fallback "contact administrator" message.

### D. mfa_required — monolith (HTTP 200, no enrollment needed)

```
HTTP 200
{"mfa_required":true,"session_id":"...","success":false}
```

`login()` check 2 fires before `!res.ok`. Session_id present → `{ kind: "mfa_required", sessionId }`.

### E. mfa_enrollment_required — monolith (HTTP 200, enrollment needed)

```
HTTP 200
{"mfa_required":true,"mfa_enrollment_required":true,"session_id":"...","success":false}
```

`login()` check 1 fires. Session_id present → `{ kind: "mfa_enrollment_required", sessionId }`.

---

## Full enrollment flow

### Endpoints

| Endpoint | Direction | Returns |
|----------|-----------|---------|
| `POST /api/v1/auth/login/mfa/enroll/initiate` | session_id → backend | `otpauth_url`, `secret`, `recovery_codes`, `expires_at` |
| `POST /api/v1/auth/login/mfa/enroll/complete` | session_id + code → backend | normal login session (cookies + role) |
| `POST /api/v1/auth/login/mfa` | session_id + code → backend | normal login session (cookies + role) |

### Field compatibility — mfaEnrollInitiate

`mfaEnrollInitiate()` in `idp-client.ts` returns `{ secret, otpauthUrl, recoveryCodes }`:
- `otpauthUrl` reads `body.otpauth_url ?? body.qr_code_url` — new OSS field takes precedence, monolith legacy field is the fallback.
- `recoveryCodes` reads `body.recovery_codes` (array of strings). Defaults to `[]` when absent (monolith that does not return codes).

### MFAEnrollForm flow

1. `loading` phase — calls `mfaEnrollInitiate(sessionId)` on mount
2. `display` phase — shows QR code + raw secret; user scans and enters 6-digit code
3. On successful `mfaEnrollComplete`:
   - If `recoveryCodes.length > 0` → `recovery` phase
   - Else → `onSuccess(role)` directly (monolith with no recovery codes)
4. `recovery` phase — shows recovery codes; user clicks "I've saved my recovery codes"
5. `onSuccess(role)` → `LoginFlow` routes to dashboard

### Security properties

- `secret`, `otpauthUrl`, `recoveryCodes` are held only in component state — never in localStorage, sessionStorage, or URL.
- Recovery codes shown once in the `recovery` phase; not shown again after `onSuccess`.
- `mfaEnrollComplete` response does NOT include recovery codes (they come from `initiate`).
- No token material appears in `mfaEnrollInitiate` or `mfaEnrollComplete` request bodies beyond `session_id`.

## Related authenticated MFA settings surface

The login-flow enrollment path above is separate from `/account/settings`.
That authenticated surface already supports:
- MFA status read
- recovery-code regeneration
- proof-based MFA disable after re-authentication

---

## Fallback — null sessionId

When `sessionId` is null (old OSS contract, case C above), `PasswordForm` shows:

> "Two-factor authentication enrollment is required before you can sign in. Please contact your administrator to set up an authenticator app."

The `MFAEnrollForm` is NOT shown. No enrollment API calls are made.

---

## Files changed (this task — agent-d-identuum-ui-oss-mfa-enrollment-backend-contract)

| File | Change |
|------|--------|
| `src/lib/idp-client.ts` | `mfaEnrollInitiate`: `body.otpauth_url ?? body.qr_code_url` (was only `qr_code_url`); added `recoveryCodes: string[]` return field |
| `src/components/auth/mfa-enroll-form.tsx` | Added `recovery` phase; stores `recoveryCodes` + `pendingRole` in component state; shows recovery codes after successful enrollment with "I've saved my recovery codes" acknowledgement |
| `src/__tests__/idp-client-mfa-enrollment.test.ts` | New test groups: OSS 401+booleans+session_id for both enrollment and mfa_required flows; `mfaEnrollInitiate` `otpauth_url`/`qr_code_url` parsing; recovery codes return; `mfaEnrollComplete` success/error; MFAEnrollForm source invariants |
| `e2e/login.spec.ts` | New mocked-backend describe block: enrollment form → recovery codes → confirm; old-OSS null-sessionId fallback; mfa_required verify form |
| `docs/SPLIT_RUNTIME_MFA_ENROLLMENT_REQUIRED_UI.md` | This file — updated to reflect new backend contract and full flow |

---

## Prior task context (agent-d-identuum-ui-mfa-enrollment-recognition)

The first task (`agent-d-identuum-ui-mfa-enrollment-recognition`) established:
- `LoginOutcome.mfa_enrollment_required.sessionId: string | null`
- OSS fallback check in `login()` before `!res.ok`
- `PasswordForm` null-sessionId branch showing fallback message

Those changes remain in force. This task completes the flow by wiring the full enrollment form for the new backend contract that returns a session_id.

---

## Reconciliation status

This doc now matches the current UI code and canonical wiki:
- login-time MFA enrollment still depends on a backend pending `session_id`
- the authenticated account/settings MFA surface is separate and already covers status, recovery-code regeneration, and proof-based disable
- no wiki delta is requested from this reconciliation pass
