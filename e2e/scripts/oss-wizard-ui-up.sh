#!/usr/bin/env bash
# oss-wizard-ui-up.sh — bring up a DISPOSABLE, setup-INCOMPLETE OSS appliance
# for the wizard-UI end-to-end test (THE-OPERATOR-PATH order B). Called by
# run-oss-wizard-ui.sh.
#
# Unlike oss-site-admin-smoke-up.sh (which builds a host binary with the
# retired flag CLI and completes bootstrap itself), this script runs the
# PUBLISHED identuum-idp-oss image via the existing e2e compose file under a
# DIFFERENT project name and host port, and deliberately leaves first-run
# setup INCOMPLETE — the spec drives the /setup wizard UI to complete it.
# The setup code is read the same way the dynamic-fixture harness does:
# `exec -T identuum-idp-oss /app/identuum-idp show-setup-code /app/data`.
#
# Writes a single line to stdout: the scratch dir path. Status goes to stderr.
# SECURITY: the setup code is written ONLY into the 0600 live-env.sh consumed
# by the runner, never echoed to the terminal.
set -euo pipefail

UI_DIR="$(cd "$(dirname "$0")/../.." && pwd)"   # identuum-ui

IDP_PORT="${OSS_WIZARD_IDP_PORT:-7153}"
UI_PORT="${OSS_WIZARD_UI_PORT:-7154}"
PROJECT="oss-wizard-ui"

WIZ_DIR="$(mktemp -d "${TMPDIR:-/tmp}/oss-wizard-ui.XXXXXX")"
echo "$PROJECT" >"$WIZ_DIR/project"

log() { printf 'oss-wizard-up: %s\n' "$1" >&2; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

# --- 1. compose override: same stack, dedicated project + port -------------
# The base file publishes 7113:7113 and derives the WebAuthn origin from
# IDENTUUM_E2E_UI_ORIGIN; we remap the host port and point the appliance's
# issuer + UI origin at the wizard stack's own ports.
cat >"$WIZ_DIR/override.yml" <<YAML
services:
  identuum-idp-oss:
    ports: !override
      - "${IDP_PORT}:7113"
    environment:
      IDENTUUM_IDP_OSS_ISSUER: "http://127.0.0.1:${IDP_PORT}"
      IDENTUUM_IDP_UI_PUBLIC_BASE_URL: "http://localhost:${UI_PORT}"
YAML

log "starting the published-appliance stack (project ${PROJECT}, idp :${IDP_PORT})"
( cd "$UI_DIR" && compose -p "$PROJECT" \
    -f e2e/docker-compose.e2e.yml -f "$WIZ_DIR/override.yml" up -d ) >&2

# --- 2. wait for /health; assert setup_required ----------------------------
log "waiting for OSS /health on :${IDP_PORT}"
for _ in $(seq 1 60); do
  code="$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${IDP_PORT}/health" || true)"
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${IDP_PORT}/health" || true)" = "200" ] || {
  log "ERROR: OSS /health never returned 200"; exit 1; }

state="$(curl -s -m 5 "http://127.0.0.1:${IDP_PORT}/api/setup/status" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("state",""))' || true)"
[ "$state" = "setup_required" ] || {
  log "ERROR: appliance is '${state}', want setup_required (stale volume? compose down the ${PROJECT} project)"; exit 1; }

# --- 3. read the setup code the harness way --------------------------------
log "reading the setup code (never echoed)"
SETUP_CODE="$( cd "$UI_DIR" && compose -p "$PROJECT" \
    -f e2e/docker-compose.e2e.yml -f "$WIZ_DIR/override.yml" \
    exec -T identuum-idp-oss /app/identuum-idp show-setup-code /app/data | tr -d '[:space:]' )"
[ -n "$SETUP_CODE" ] || { log "ERROR: empty setup code"; exit 1; }

# --- 4. UI runtime config + live-env ---------------------------------------
cat >"$WIZ_DIR/ui-runtime.json" <<JSON
{
  "configured": true,
  "ui_origin": "http://localhost:${UI_PORT}",
  "idp": {
    "enabled": true,
    "public_base_url": "http://127.0.0.1:${IDP_PORT}",
    "internal_base_url": "http://127.0.0.1:${IDP_PORT}"
  },
  "ag": {
    "enabled": false,
    "public_base_url": ""
  }
}
JSON

umask 077
cat >"$WIZ_DIR/live-env.sh" <<ENV
# Sourced by run-oss-wizard-ui.sh. Gates + parameterizes the one spec.
export IDENTUUM_E2E_OSS_WIZARD_UI=1
export IDENTUUM_E2E_PORT="${UI_PORT}"
export IDENTUUM_E2E_BASE_URL="http://localhost:${UI_PORT}"
export IDENTUUM_UI_CONFIG_FILE="${WIZ_DIR}/ui-runtime.json"
export IDENTUUM_E2E_WIZARD_SETUP_CODE="${SETUP_CODE}"
export OSS_WIZARD_DIR="${WIZ_DIR}"
export OSS_WIZARD_IDP_BASE="http://127.0.0.1:${IDP_PORT}"
ENV
chmod 600 "$WIZ_DIR/live-env.sh"

log "stack up — appliance http://127.0.0.1:${IDP_PORT} (setup_required), UI will start on :${UI_PORT}"
printf '%s\n' "$WIZ_DIR"
