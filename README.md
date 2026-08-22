# identuum-ui

Copyright © 2026 Ozgur Demir. All rights reserved.

## Project Status

This repository is currently published for public inspection and
evaluation only.

- Not currently open source
- External contributions are not accepted
- No permission is granted to use, modify, redistribute, sublicense, or
  create derivative works, except as necessarily required by GitHub's
  Terms of Service and applicable law
- Current repository license: `LicenseRef-AllRightsReserved` (see
  [`LICENSE`](LICENSE))
- Licensing terms may change in a future release

---

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
curl http://localhost:7104/api/health
# {"status":"ok","configured":true}
```

Open the UI at <http://localhost:7104>.

### Operator commands (UI only)

```sh
# Tear down (does NOT remove volumes; no UI state to preserve)
docker compose -f deployment/docker-compose.local.yml down

# Clean rebuild from source
docker compose -f deployment/docker-compose.local.yml down
docker compose -f deployment/docker-compose.local.yml build --no-cache
docker compose -f deployment/docker-compose.local.yml up -d

# Verify the public runtime config the UI advertises to the browser
curl http://localhost:7104/api/runtime-config
```

### How the network wiring works

| Caller | Target | URL used | Resolves via |
|---|---|---|---|
| Browser → UI | UI | `http://localhost:7104` | host port-publish |
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
which uses Next.js standalone output (`node server.js`, port 7104, no
`next dev`). The dev mode `pnpm dev` path is unchanged — both the
host-side dev workflow and the containerized demo work side by side.

## Development (no Docker)

```sh
pnpm install
pnpm dev          # http://localhost:7104 with hot reload
pnpm typecheck
pnpm build
pnpm rulefloor    # verify the RULE-FLOOR.md rule ledger (see below)
```

### Rule ledger (RULE-FLOOR.md)

`pnpm rulefloor` verifies the machine-checked rule ledger at the repo
root with the rulefloor CLI, resolved in order: `$RULEFLOOR_BIN` if
set, `rulefloor` on PATH, then building the sibling `../rulefloor`
checkout as last resort (`scripts/rulefloor-gate.sh`). Candidates are
probed through the machine interface `version --json`
(rulefloor.version.v1) — v0.3.0 or newer only; a stale PATH binary
falls through to the sibling. No resolvable binary fails the script
loudly — there is no skip. CI runs the SAME gate script with the
pinned tool installed (`go install github.com/ozgurcd/rulefloor@v0.3.0`;
see ci.yml). The tool's feature set is discovered, never assumed:
`rulefloor capabilities --json`.

How the ledger works is the tool's documentation
(`../rulefloor/README.md`). What this project's profile names mean
(`chromium`, `e2e-run`, `e2e-dynamic`, the named runs), the red-proof
text format we write, and the burndown method are project POLICY —
canonical in `../identuum-idp-oss/docs/RULE-FLOOR-CONVENTIONS.md`
(pointer: [docs/RULE-FLOOR-CONVENTIONS.md](docs/RULE-FLOOR-CONVENTIONS.md)).

## Runtime configuration

The UI reads `config/ui-runtime.json` at request time (no rebuild
needed). Schema:

```json
{
  "configured": true,
  "ui_origin": "http://localhost:7104",
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
