#!/usr/bin/env bash
# oss-wizard-ui-down.sh — tear down the disposable wizard-UI stack and remove
# the scratch dir (which holds the 0600 live-env.sh carrying the setup code).
# Plain `down` (never -v); the appliance Postgres is volume-less by design.
set -uo pipefail

UI_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WIZ_DIR="${1:-}"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

PROJECT="oss-wizard-ui"
if [ -n "$WIZ_DIR" ] && [ -f "$WIZ_DIR/project" ]; then
  PROJECT="$(cat "$WIZ_DIR/project")"
fi

if [ -n "$WIZ_DIR" ] && [ -f "$WIZ_DIR/override.yml" ]; then
  ( cd "$UI_DIR" && compose -p "$PROJECT" \
      -f e2e/docker-compose.e2e.yml -f "$WIZ_DIR/override.yml" down ) >&2 || true
else
  ( cd "$UI_DIR" && compose -p "$PROJECT" -f e2e/docker-compose.e2e.yml down ) >&2 || true
fi

if [ -n "$WIZ_DIR" ] && [ -d "$WIZ_DIR" ]; then
  rm -rf "$WIZ_DIR"
fi
echo "oss-wizard-down: done" >&2
