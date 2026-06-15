# Protocol Settings OSS/CE Labeling — Split-Runtime UI Contract

## Summary

This document describes the split-aware UI contract for IDP per-org protocol settings.
It captures the OSS/CE tier decision, the discriminated client result contract, and the
per-reason UI copy rules.

## Tier decision (SCIM corrected 2026-06-08)

- **DCR Foundation** (RFC 7591 dynamic client registration): **OSS/Starter** — no license gate.
- **SCIM 2.0** (RFC 7643/7644 provisioning): **Enterprise/CE-only**.
- **RBAC / API resources / scope templates**: **OSS/Starter** — no license gate.
- **CE commercial extensions** (advanced DCR and provisioning capabilities): future; CE only.

The `GET /api/v1/organizations/:id/protocol-settings` and
`PUT /api/v1/organizations/:id/protocol-settings` endpoints are available on current
runtimes for DCR availability. The historical `scim_enabled` field is not an OSS/Foundation
entitlement signal; the UI must present SCIM as Enterprise/CE-only until runtime capability
discovery can distinguish commercial provisioning support.

## Discriminated client result

`getOrgProtocolSettings()` in `src/lib/idp-admin-client.ts` returns
`GetOrgProtocolSettingsResult` (never raw `null`).

```
ok=true               settings object                       → show settings form
ok=false, not_authenticated   401                           → session-expired copy + sign-in prompt
ok=false, forbidden           403 (permission / auth)       → permission-denied copy
ok=false, not_licensed        403 (structured license gate) → commercial-tier copy (DCR Foundation affirmed)
ok=false, not_found           404                           → endpoint-absent / feature-unavailable copy
ok=false, unavailable         0 / IDP off / network error   → backend-unreachable copy
ok=false, unknown             other non-200                 → generic error copy
```

`not_licensed` is reserved for future CE commercial extension gates that return a
structured license signal. As of 2026-06-05, no such signal exists; 403 maps to
`forbidden` by default. A future slice that detects a structured signal may reclassify
403 to `not_licensed` at the client boundary — no UI changes needed beyond that.

Defensive `.catch(() => null)` is applied at the page level. The panel renders a
`null` initialSettings as `reason=unavailable`-equivalent via `protocolSettingsLoadErrorMessage(null)`.
The panel is never silently hidden; it always renders either the settings form or a clear
error state.

## UI copy rules

| State | Copy principle |
|-------|---------------|
| `null` or `unavailable` | "Protocol settings are unavailable — the identity provider did not respond." |
| `not_authenticated` | Session expired, sign in again. |
| `forbidden` | Permission denied, role-neutral (no role names, no Enterprise claim). |
| `not_licensed` | Advanced capabilities require commercial tier; DCR Foundation remains available. |
| `not_found` | Feature not available in this deployment/runtime. |
| `unknown` | Generic. No HTTP status codes exposed. |

Copy must never:
- Claim SCIM 2.0 is OSS/Foundation/Starter.
- Claim DCR Foundation is Enterprise-only.
- Name specific roles (site_admin, org_admin) in error messages.
- Expose raw backend error text, HTTP status codes, or internal URLs.

## File map

| File | Role |
|------|------|
| `src/lib/types.ts` | `GetOrgProtocolSettingsResult` discriminated union; `OrgProtocolSettings` shape |
| `src/lib/idp-admin-client.ts` | `getOrgProtocolSettings()` + `updateOrgProtocolSettings()` |
| `src/app/site-admin/organizations/[id]/protocol-settings-helpers.ts` | Pure helpers: `protocolSettingsLoadErrorMessage`, `protocolSettingsSaveErrorMessage`, `formatSettingsSource`, `isDefaultUnset` |
| `src/app/site-admin/organizations/[id]/protocol-settings-panel.tsx` | Client component used by both site-admin and org-admin pages |
| `src/app/site-admin/organizations/[id]/protocol-settings-actions.ts` | Shared server action (`updateProtocolSettingsAction`) — handles both roles |
| `src/app/site-admin/organizations/[id]/page.tsx` | site_admin organization detail page |
| `src/app/org-admin/settings/page.tsx` | org_admin settings page |
| `src/__tests__/site-admin-org-protocol-settings.test.ts` | Unit tests |
