# Split-Runtime Backend Product Labels

## Problem

The site-admin Overview page previously hardcoded `"identuum-idp"` and
`"identuum-ag"` as display labels in both the *Deployed capabilities* and
*Backend health* sections. In split-runtime deployments (where individual
containers identify themselves as `identuum-idp-oss`, `identuum-idp-ce`,
`identuum-ag-oss`, or `identuum-ag-ce`) the UI showed only the generic
monolith name, giving operators no signal about which product variant they
were running.

## Solution

Product identity is derived at runtime from the backend's own `/health`
response body. No hardcoded strings remain in the rendering path.

### Derivation priority

Each backend reports its identity differently:

| Backend              | `/health` shape                                                   | Derived label       |
|----------------------|-------------------------------------------------------------------|---------------------|
| identuum-ag-oss      | `{"product":"identuum-ag-oss","status":"ok"}`                     | `identuum-ag-oss`   |
| identuum-idp (CE)    | `{"status":"healthy","product":"identuum-idp-ce",…}`              | `identuum-idp-ce`   |
| identuum-idp (OSS)   | `{"status":"healthy","mode":"oss","tier":"starter",…}`            | `identuum-idp-oss`  |
| identuum-idp (mono)  | `{"status":"healthy","product":"identuum-idp",…}`                 | `identuum-idp`      |
| identuum-ag (mono)   | `{"surface":"management","ok":true}` — no product/mode field      | `identuum-ag`       |

Priority applied in `deriveProductLabel(domain, body)`:

1. `product` field — present and non-empty (AG OSS, IDP monolith, IDP CE)
2. `mode` field — `"oss"` or `"ce"` without a `product` field (IDP OSS)
3. Static fallback — `"identuum-idp"` or `"identuum-ag"` (AG monolith, unknown shape)

## Files changed

| File | Change |
|------|--------|
| `src/lib/backend-product-labels.ts` | New file — `deriveProductLabel(domain, body)` helper |
| `src/lib/types.ts` | `BackendHealthStatus` gains `product: string` field |
| `src/app/api/status/route.ts` | `checkHealth` parses `/health` body and populates `product` |
| `src/app/site-admin/client.tsx` | `CapabilityRow` and `HealthRow` use `status.idp.product` / `status.ag.product` |
| `src/__tests__/backend-product-labels.test.ts` | 30 unit + source-invariant tests |

## Backward compatibility

- When the backend `/health` endpoint is unreachable the label falls back to
  the static generic name — identical to the previous behavior.
- The monolith `/health` response (`product: "identuum-idp"`) continues to
  display `"identuum-idp"` — no regression.
- The legacy AG monolith (`surface`/`ok` shape) falls back to `"identuum-ag"`.
