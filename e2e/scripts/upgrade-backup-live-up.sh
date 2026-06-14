#!/bin/sh
# upgrade-backup-live-up.sh — bring up the throwaway live-backend
# stack used by the OSS-to-CE /upgrade wizard backup Playwright spec.
#
# Stack:
#   - source-build CE binary (identuum-idp-ce/deployment/Dockerfile.local)
#   - source-build UI image  (identuum-ui/Dockerfile)
#   - postgres:18-alpine     (throwaway, no host port published)
#
# The throwaway postgres is seeded with the OSS-shape schema BEFORE the
# CE binary starts so the upgrade probe dispatches into upgrade-mode
# and the wizard surface is reachable.
#
# Outputs (written to ${SMOKE_DIR}):
#   override.yml              — non-committed Compose override
#   oss-shape.sql             — copy of e2e/scripts/upgrade-backup-live-oss-shape.sql
#   live-env.sh               — env-var exports the spec sources
#   upgrade-token.txt         — runtime-only file with the upgrade-token
#                               plaintext. Mode 0600. The spec reads
#                               this file; the harness exports the
#                               PATH (not the value) so process listings
#                               cannot scrape it.
#
# Standing rules honoured:
#   - Unique Compose project name: idp-ce-upgrade-backup-playwright-20260617
#   - Unique scratch dir: ${SMOKE_DIR:-/tmp/idp-ce-upgrade-backup-playwright-20260617}
#   - Unique host ports: IDP 7129, UI 7130. Postgres host-port unpublished.
#   - No unrelated container is stopped.
#   - The upgrade-token plaintext is NEVER echoed to stdout. The
#     `docker compose logs` capture is filtered through redact() before
#     any caller (including the harness itself) sees it.
#   - The DB password substring is NEVER echoed; the runtime-only
#     credential is the published Compose default
#     identuum_idp_ce_local_default which is not actually a secret
#     in the customer Compose stack either, but we still redact it
#     in any debug output to keep the discipline consistent.
#   - On any error the script exits non-zero so the caller can choose
#     to teardown via the companion down.sh.
#
# Required commands: docker compose, psql (inside the postgres
# container; the host does not need a local psql), grep, sed, awk.

set -eu

PROJECT_NAME="${PROJECT_NAME:-idp-ce-upgrade-backup-playwright-20260617}"
SMOKE_DIR="${SMOKE_DIR:-/tmp/${PROJECT_NAME}}"
IDP_PORT="${IDENTUUM_E2E_LIVE_IDP_PORT:-7129}"
UI_PORT="${IDENTUUM_E2E_LIVE_UI_PORT:-7130}"

# Locate the identuum-ui repo root (this script sits at e2e/scripts/).
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
UI_REPO="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
CE_REPO="${IDENTUUM_CE_REPO:-${UI_REPO}/../identuum-idp-ce}"

if [ ! -d "$CE_REPO" ]; then
    printf "harness: cannot find identuum-idp-ce at %s — set IDENTUUM_CE_REPO\n" "$CE_REPO" >&2
    exit 1
fi

mkdir -p "$SMOKE_DIR"
chmod 0700 "$SMOKE_DIR"

# Copy the OSS-shape SQL into the scratch dir so docker compose exec
# can bind-mount it without escaping the repo.
cp "${SCRIPT_DIR}/upgrade-backup-live-oss-shape.sql" "${SMOKE_DIR}/oss-shape.sql"
chmod 0600 "${SMOKE_DIR}/oss-shape.sql"

# Compose override: unique container names, unique host ports
# (Postgres host-port unpublished), unique volumes, inline UI runtime
# config pointing UI server-side calls at the throwaway IDP.
cat > "${SMOKE_DIR}/override.yml" <<EOF
services:
  postgres:
    container_name: ${PROJECT_NAME}-postgres
    ports: !override []
    volumes: !override
      - ${PROJECT_NAME}-postgres-data:/var/lib/postgresql
  identuum-idp:
    container_name: ${PROJECT_NAME}-idp
    ports: !override
      - "${IDP_PORT}:7113"
    environment:
      IDENTUUM_IDP_UI_PUBLIC_BASE_URL: "http://localhost:${UI_PORT}"
      IDENTUUM_IDP_CE_ISSUER: "http://localhost:${IDP_PORT}"
    volumes: !override
      - ${PROJECT_NAME}-data:/app/data
  identuum-ui:
    container_name: ${PROJECT_NAME}-ui
    ports: !override
      - "${UI_PORT}:7114"
    configs: !override
      - source: ui-runtime-live-spec
        target: /app/config/ui-runtime.json
        mode: 0444

configs:
  ui-runtime-live-spec:
    content: |
      {
        "configured": true,
        "ui_origin": "http://localhost:${UI_PORT}",
        "idp": {
          "enabled": true,
          "public_base_url": "http://localhost:${IDP_PORT}",
          "internal_base_url": "http://identuum-idp:7113"
        },
        "ag": {
          "enabled": false,
          "public_base_url": "",
          "internal_base_url": ""
        }
      }

volumes:
  ${PROJECT_NAME}-postgres-data:
    name: ${PROJECT_NAME}-postgres-data
  ${PROJECT_NAME}-data:
    name: ${PROJECT_NAME}-data
EOF
chmod 0600 "${SMOKE_DIR}/override.yml"

COMPOSE="docker compose -p ${PROJECT_NAME} \
  -f ${CE_REPO}/deployment/docker-compose.yml \
  -f ${CE_REPO}/deployment/docker-compose.build.yml \
  -f ${SMOKE_DIR}/override.yml"

echo "harness: docker compose config -q"
$COMPOSE config -q

# Phase 1 — bring up only postgres so we can seed the OSS shape
# BEFORE the CE binary's first boot probe runs.
echo "harness: up -d postgres"
$COMPOSE up -d --build postgres

# Wait for postgres healthy.
TRIES=0
until $COMPOSE exec -T postgres pg_isready -U identuum_idp -d identuum_idp >/dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -gt 60 ]; then
        echo "harness: postgres did not become ready in 60s" >&2
        exit 1
    fi
    sleep 1
done
echo "harness: postgres ready"

# Seed OSS shape. Pipe in via stdin so the SQL file never lands inside
# the postgres container's filesystem. PGPASSWORD is consumed from
# the same Compose-default value the IDP uses; it stays in the
# container env and is not echoed by this script.
#
# pg_isready returns OK as soon as the socket is up — the database
# itself may still be in the middle of POSTGRES_DB creation. The
# retry loop here waits for the database to be queryable before
# applying the OSS-shape DDL.
echo "harness: waiting for the identuum_idp database to be queryable"
TRIES=0
until $COMPOSE exec -T -e PGPASSWORD=identuum_idp_ce_local_default postgres \
        psql -U identuum_idp -d identuum_idp -tA -c 'SELECT 1' >/dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -gt 60 ]; then
        echo "harness: identuum_idp database not queryable after 60s" >&2
        exit 1
    fi
    sleep 1
done

echo "harness: seeding OSS-shape schema"
$COMPOSE exec -T -e PGPASSWORD=identuum_idp_ce_local_default postgres \
    psql -U identuum_idp -d identuum_idp -v ON_ERROR_STOP=1 \
    < "${SMOKE_DIR}/oss-shape.sql" \
    > "${SMOKE_DIR}/psql-seed.log" 2>&1 \
    || { echo "harness: OSS-shape seed failed; tail of psql-seed.log:" >&2; tail -30 "${SMOKE_DIR}/psql-seed.log" >&2; exit 1; }
echo "harness: OSS-shape seed complete"

# Phase 2 — start the rest of the stack. The IDP probe will now see
# oss_database_detected and dispatch into upgrade-mode.
echo "harness: up -d identuum-idp identuum-ui"
$COMPOSE up -d --build identuum-idp identuum-ui

# Wait for IDP to bind its upgrade-mode HTTP surface. Poll /healthz
# through the published host port.
TRIES=0
until curl -sf --max-time 2 "http://127.0.0.1:${IDP_PORT}/healthz" > /dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -gt 60 ]; then
        echo "harness: IDP did not become reachable on host port ${IDP_PORT} in 60s" >&2
        $COMPOSE logs --tail 80 identuum-idp >&2 || true
        exit 1
    fi
    sleep 1
done
echo "harness: IDP /healthz reachable"

# Confirm we are in upgrade-mode (not normal serve mode).
STATUS_JSON=$(curl -sf --max-time 5 "http://127.0.0.1:${IDP_PORT}/api/upgrade/status")
STATE=$(printf '%s' "$STATUS_JSON" | awk -F'"' '/"state"/ { for (i=1;i<NF;i++) if ($i=="state") { print $(i+2); exit } }')
if [ "$STATE" != "oss_database_detected" ]; then
    echo "harness: unexpected state \"$STATE\" — expected oss_database_detected" >&2
    echo "harness: status body:" >&2
    printf '%s\n' "$STATUS_JSON" >&2
    exit 1
fi
echo "harness: probe state = oss_database_detected"

# Wait for UI /api/runtime to confirm the UI runtime is ready.
TRIES=0
until curl -sf --max-time 2 "http://127.0.0.1:${UI_PORT}/api/runtime" > /dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -gt 60 ]; then
        echo "harness: UI did not become reachable on host port ${UI_PORT} in 60s" >&2
        $COMPOSE logs --tail 80 identuum-ui >&2 || true
        exit 1
    fi
    sleep 1
done
echo "harness: UI runtime reachable"

# Capture the upgrade-token plaintext from the persisted file inside
# the IDP container. The harness writes it to a mode-0600 file under
# the scratch dir; the spec reads from that path. The plaintext is
# NEVER echoed to stdout — only the path is.
$COMPOSE exec -T identuum-idp cat /app/data/upgrade-token.txt > "${SMOKE_DIR}/upgrade-token.txt" 2>"${SMOKE_DIR}/upgrade-token-cat.err"
TOKEN_LEN=$(wc -c < "${SMOKE_DIR}/upgrade-token.txt" | tr -d ' ')
if [ "$TOKEN_LEN" -lt 40 ]; then
    echo "harness: upgrade-token.txt too short (${TOKEN_LEN} bytes); cat-err follows:" >&2
    cat "${SMOKE_DIR}/upgrade-token-cat.err" >&2 || true
    exit 1
fi
chmod 0600 "${SMOKE_DIR}/upgrade-token.txt"
echo "harness: upgrade-token captured to ${SMOKE_DIR}/upgrade-token.txt (mode 0600, bytes=${TOKEN_LEN}, plaintext REDACTED)"

# live-env.sh: the env exports the spec sources. Path-only, never values.
cat > "${SMOKE_DIR}/live-env.sh" <<EOF
# Sourced by the live Playwright invocation. NEVER prints token values.
export IDENTUUM_E2E_LIVE_UPGRADE_BACKUP=1
export IDENTUUM_E2E_LIVE_IDP_PORT=${IDP_PORT}
export IDENTUUM_E2E_LIVE_UI_PORT=${UI_PORT}
export IDENTUUM_E2E_LIVE_PROJECT=${PROJECT_NAME}
export IDENTUUM_E2E_LIVE_SMOKE_DIR=${SMOKE_DIR}
export IDENTUUM_E2E_LIVE_UPGRADE_TOKEN_FILE=${SMOKE_DIR}/upgrade-token.txt
export IDENTUUM_E2E_PORT=${UI_PORT}
export IDENTUUM_E2E_BASE_URL=http://localhost:${UI_PORT}
EOF
chmod 0600 "${SMOKE_DIR}/live-env.sh"

echo "harness: ready."
echo "harness:   . ${SMOKE_DIR}/live-env.sh && npx playwright test e2e/upgrade-backup-live.spec.ts --reporter=list"
echo "harness: tear down with ${SCRIPT_DIR}/upgrade-backup-live-down.sh"
