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

Next.js console for Identuum, shipped as a **static export embedded in the
`identuum-idp-oss` binary** (owner ruling D-019, 2026-09-30; embedded since
identuum-idp-oss `v0.6.0`). It talks to `identuum-idp-oss` (the human IdP /
OIDC authorization server) and carries the site-admin, org-admin and
org_user surfaces, the sign-in and account ceremonies and the `/setup`
wizard. One export serves both editions: the OSS and CE binaries embed the
same files and read the edition at runtime from `/api/runtime-config`.

## How it ships

There is no UI container, no UI image and no UI Compose stack. The release
artifact is the static export, built by `pnpm build:export`
(`export/vite.config.mts`, output `out/`) and published by
`.github/workflows/publish-ui-export.yml`. A tag `vX.Y.Z` produces three
release assets plus a GitHub build-provenance attestation over them:

| Asset | What it is |
|---|---|
| `identuum-ui-export-vX.Y.Z.tar.gz` | the built files, a deterministic tar |
| `identuum-ui-export-vX.Y.Z.json` | the manifest (`identuum-ui-vendor.v1`): ui commit, lockfile sha256, node and pnpm versions, every file's sha256, tree digest |
| `identuum-ui-export-vX.Y.Z.spdx.json` | the SBOM of the production dependency closure (`make export-sbom`), the same file `make sbom-scan` judges |

The GitHub release body is this repository's `CHANGELOG.md` section for the
tag; the workflow refuses to publish a tag whose section is missing.

identuum-idp-oss vendors the export of one ui commit (`make ui-vendor`
there) and embeds it, so running the IdP is running the UI — the binary
serves the console at its own origin:

```sh
curl -fsSLO https://github.com/identuum/identuum-idp-oss/releases/latest/download/docker-compose.yml
docker compose up -d
open http://localhost:7113
```

Release order (owner ruling q, 2026-10-06): `package.json` is set to the
release version first, that commit is pushed and tagged, and
identuum-idp-oss vendors THAT commit.

### The runner image (development only)

The repo-root `Dockerfile` builds the Next.js standalone runner (`node
server.js`, port 7104). It is a development artifact, never a product: no
workflow publishes it and no release gate judges it; the security gate
(`make sbom-scan`) judges the export's SBOM instead. The host-side
`pnpm dev` path and the export build work side by side.

## Development (no Docker)

```sh
pnpm install
pnpm dev          # http://localhost:7104 with hot reload (the Next dev server)
make verify       # THE gate set: 17 planned targets (the `plan:` line of
                  # GATE-RUN.txt), rulefloor + biome + typecheck + vitest among
                  # them — run this, not an ad-hoc subset; CI runs its own
                  # 14-step subset of it (ci.yml) and records it the same way
pnpm build:export # the static export, into out/
pnpm build        # the Next standalone build (development only)
pnpm rulefloor    # the ledger gate alone (see below); included in verify
```

A local backend for the dev server is identuum-idp-oss's own dev stack:
from `../identuum-idp-oss`, `make fast-up` starts PostgreSQL alone on
127.0.0.1:5513 and `make dev-up` the full stack
(`deployment/docker-compose.dev.yml`).

### Rule ledger (RULE-FLOOR.md)

`pnpm rulefloor` verifies the machine-checked rule ledger at the repo
root with the rulefloor CLI, resolved in order: `$RULEFLOOR_BIN` if
set, `rulefloor` on PATH, then building the sibling `../rulefloor`
checkout as last resort (`scripts/rulefloor-gate.sh`). Candidates are
probed through the machine interface `version --json`
(rulefloor.version.v1) — v0.3.0 or newer only; a stale PATH binary
falls through to the sibling. No resolvable binary fails the script
loudly — there is no skip. CI is WIRED to run the same gate script
(`ci.yml` declares one `RULEFLOOR_VERSION`, builds that tag's tarball
against a pinned sha256, and asserts the built binary's version) — but
that is what the workflow DECLARES, not an observed run. No CI run is
witnessed here — this repository holds no record of one — and runs do
happen: on 2026-09-04 the sibling repository's CI was found to have been
RED on every run back to 2026-08-31, unread, while its local gates were
green. See
`wiki/platform/decisions.md` P-048 for what a CI run would prove and
what it would not. The tool's feature set is discovered, never assumed:
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
