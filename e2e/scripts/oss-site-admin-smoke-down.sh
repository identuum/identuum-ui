#!/usr/bin/env bash
# oss-site-admin-smoke-down.sh — tear down the disposable OSS smoke stack.
# Argument: the scratch dir printed by oss-site-admin-smoke-up.sh.
# ALWAYS safe to run (idempotent, best-effort). Removes the disposable
# Postgres container, stops the OSS process, scrubs + removes the scratch dir.
set -uo pipefail
SMOKE_DIR="${1:-${OSS_SMOKE_DIR:-}}"
log() { printf 'oss-smoke-down: %s\n' "$1" >&2; }

[ -n "$SMOKE_DIR" ] && [ -d "$SMOKE_DIR" ] || { log "no scratch dir; nothing to do"; exit 0; }

# Stop the OSS --gin-serve process.
if [ -f "$SMOKE_DIR/idp.pid" ]; then
  PID="$(cat "$SMOKE_DIR/idp.pid" 2>/dev/null || true)"
  if [ -n "${PID:-}" ]; then kill "$PID" >/dev/null 2>&1 || true; fi
fi

# Remove the disposable Postgres container ONLY (named, unique to this run).
if [ -f "$SMOKE_DIR/pg.name" ]; then
  PG_NAME="$(cat "$SMOKE_DIR/pg.name" 2>/dev/null || true)"
  if [ -n "${PG_NAME:-}" ]; then
    log "removing disposable Postgres container ${PG_NAME}"
    docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  fi
fi

# Scrub the credential-bearing env file, then remove the scratch dir.
if [ -f "$SMOKE_DIR/live-env.sh" ]; then
  : >"$SMOKE_DIR/live-env.sh" 2>/dev/null || true
fi
rm -rf "$SMOKE_DIR" 2>/dev/null || true
log "teardown complete"
