# identuum-ui

Next.js control-plane shell for the Identuum stack. Talks to
`identuum-idp` (human IdP / OIDC AS) and `identuum-ag` (Agentic
Governor) over server-side fetches and exposes the operator-facing
admin/dashboard surfaces.

## Local quick start (Docker Compose)

The full local demo runs all three Identuum stacks (idp + ag + ui) as
independent Compose projects. Each project owns its own network; this
UI stack attaches to the IDP and AG networks as external networks so
server-side fetches resolve their container hostnames.

**Prerequisite:** start IDP and AG first (they create the networks
this stack joins):

```sh
# In identuum-idp/
docker compose -f deployment/docker-compose.local.yml up -d
docker compose -f deployment/docker-compose.local.yml --profile setup run --rm identuum-idp-setup

# In identuum-ag/
docker compose -f deployment/docker-compose.dev.yml up -d
docker compose -f deployment/docker-compose.dev.yml --profile setup run --rm identuum-ag-setup
```

Then bring up the UI:

```sh
# In identuum-ui/
docker compose -f deployment/docker-compose.local.yml up -d
curl http://localhost:7114/api/health
# {"status":"ok","configured":true}
```

Open the UI at <http://localhost:7114>.

### Operator commands (UI only)

```sh
# Tear down (does NOT remove volumes; no UI state to preserve)
docker compose -f deployment/docker-compose.local.yml down

# Clean rebuild from source
docker compose -f deployment/docker-compose.local.yml down
docker compose -f deployment/docker-compose.local.yml build --no-cache
docker compose -f deployment/docker-compose.local.yml up -d

# Verify the public runtime config the UI advertises to the browser
curl http://localhost:7114/api/runtime-config
```

### How the network wiring works

| Caller | Target | URL used | Resolves via |
|---|---|---|---|
| Browser → UI | UI | `http://localhost:7114` | host port-publish |
| Browser → IdP | IdP | `http://localhost:7113` | host port-publish |
| Browser → AG mgmt | AG | `http://localhost:7215` | host port-publish |
| Browser → AG identity | AG | `http://localhost:7214` | host port-publish |
| UI server → IdP | IdP | `http://identuum-idp:7113` | `identuum-idp-local` network |
| UI server → AG mgmt | AG | `http://identuum-ag:7215` | `identuum-ag_identuum-ag-net` |
| UI server → AG identity | AG | `http://identuum-ag:7214` | same as above |

Both internal URLs come from `config/ui-runtime.json`, which is
bind-mounted read-only into the container at
`/app/config/ui-runtime.json`. Edit that file on the host to change
runtime configuration without rebuilding the image.

### Production-shape build

The Compose file builds the existing `Dockerfile` at the repo root,
which uses Next.js standalone output (`node server.js`, port 7114, no
`next dev`). The dev mode `pnpm dev` path is unchanged — both the
host-side dev workflow and the containerized demo work side by side.

## Development (no Docker)

```sh
pnpm install
pnpm dev          # http://localhost:7114 with hot reload
pnpm typecheck
pnpm build
```

## Runtime configuration

The UI reads `config/ui-runtime.json` at request time (no rebuild
needed). Schema:

```json
{
  "configured": true,
  "ui_origin": "http://localhost:7114",
  "idp": {
    "enabled": true,
    "public_base_url": "http://localhost:7113",
    "internal_base_url": "http://identuum-idp:7113"
  },
  "ag": {
    "enabled": true,
    "public_base_url": "http://localhost:7215",
    "internal_base_url": "http://identuum-ag:7215",
    "identity_base_url": "http://localhost:7214",
    "identity_internal_base_url": "http://identuum-ag:7214"
  }
}
```

`internal_base_url` / `identity_internal_base_url` values are
server-only and never leak to the browser (see
`src/lib/runtime-config.ts::toPublicConfig`). `public_base_url` and
`identity_base_url` are browser-facing.
