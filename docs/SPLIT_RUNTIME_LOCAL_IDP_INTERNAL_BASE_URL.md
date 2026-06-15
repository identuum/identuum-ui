# Split-Runtime Local IDP Internal Base URL

## Problem: localhost fails inside the UI container

When `identuum-ui` runs in Docker and `identuum-idp-oss` runs on a host-published port, the Next.js IDP proxy (`src/app/api/idp/[...path]/route.ts`) makes server-side fetch requests from **inside** the UI container. Inside the container, `localhost` (and `127.0.0.1`) refer to the container's own loopback interface — not the host machine. A request to `http://localhost:7113` from inside `identuum-ui-app` hits nothing and fails with `ECONNREFUSED`. The proxy catches this and returns `502 {"error":"IdP unreachable"}`.

The browser's `orgLookup` call sees the 502, throws `ApiError`, and the `LoginFlow` state machine stays on the EMAIL step with "Unable to look up your organization." — the PASSWORD step never renders.

## Fix: use host.docker.internal

On macOS Docker (Docker Desktop), the special hostname `host.docker.internal` always resolves from inside a container to the host machine's IP address. Setting the IDP `internal_base_url` to `http://host.docker.internal:7113` lets the UI container's server-side proxy reach `identuum-idp-oss` on its host-published port.

The fix is a one-field change in `config/ui-runtime.json`:

```json
{
  "idp": {
    "public_base_url": "http://localhost:7113",
    "internal_base_url": "http://host.docker.internal:7113"
  }
}
```

`public_base_url` stays as `http://localhost:7113` — this is the URL the **browser** uses and the host machine's loopback is exactly right there.

## Public vs internal URL distinction

| Field | Used by | Resolves in |
|-------|---------|-------------|
| `idp.public_base_url` | Browser-side JS (via `/api/idp/...` → but also shown in `/api/runtime-config`) | Host machine |
| `idp.internal_base_url` | Next.js server proxy (`idpBaseUrl(cfg)`) | UI Docker container |

`idpBaseUrl(cfg)` in `src/lib/runtime-config.ts` always prefers `internal_base_url` when set (non-empty after trimming). `toPublicConfig()` strips `internal_base_url` so it is never exposed to the browser.

## Expected proxy smoke result after fix

```sh
curl -si http://127.0.0.1:7114/api/idp/api/v1/auth/organization-lookup?domain=system.local
```

**Before fix:** `HTTP/1.1 502` — proxy could not reach IDP.

**After fix (OSS expected):** `HTTP/1.1 200` for a matching org such as `system.local`; `HTTP/1.1 404` for an unknown domain. In both cases the proxy successfully reaches `identuum-idp-oss`.

A **502 still indicates a networking problem**; a **200 or 404 confirms the fix succeeded**.

## OSS lookup behavior

`identuum-idp-oss` exposes `GET /api/v1/auth/organization-lookup` on the public OSS surface. The UI's `orgLookup` helper still treats 404 as "no org config" and transitions to the PASSWORD step for unknown domains.

## Docker network context

The `identuum-ui` compose file (`deployment/docker-compose.local.yml`) joins the `identuum-idp-local` and `identuum-ag_identuum-ag-net` external networks. When the full monolith stack is running, the IDP container is accessible as `http://identuum-idp:7113` via the `identuum-idp-local` network DNS. In the split-runtime OSS setup, `identuum-idp-oss-app` runs on its own `deployment_default` network and is not on `identuum-idp-local`, so the DNS hostname `identuum-idp` does not resolve. `host.docker.internal:7113` works regardless of which IDP container (monolith or OSS) is running on port 7113.

## After config change

The config file (`config/ui-runtime.json`) is bind-mounted read-only into the container (`../config:/app/config:ro`). `loadRuntimeConfig()` reads it from disk on every request — no restart is strictly required for new requests to use the updated value. A restart ensures all in-flight state is flushed:

```sh
docker restart identuum-ui-app
```

Or via compose:

```sh
docker compose -f deployment/docker-compose.local.yml restart identuum-ui
```
