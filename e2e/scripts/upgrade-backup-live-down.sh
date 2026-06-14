#!/bin/sh
# upgrade-backup-live-down.sh — tear down the throwaway live-backend
# Compose project used by the live Playwright spec.
#
# Removes only the throwaway project's containers, volumes, and
# network. Other dev containers stay intact.
#
# Standing rules honoured:
#   - The project name is unique and matches the one written by up.sh.
#   - `docker compose down -v` is authorised for this project only.
#   - The scratch dir (containing the upgrade-token plaintext file)
#     is removed by overwriting the token file before unlink so a
#     forensic scrape of unlinked-but-not-zeroed disk blocks cannot
#     recover it.

set -eu

PROJECT_NAME="${PROJECT_NAME:-idp-ce-upgrade-backup-playwright-20260617}"
SMOKE_DIR="${SMOKE_DIR:-/tmp/${PROJECT_NAME}}"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
UI_REPO="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
CE_REPO="${IDENTUUM_CE_REPO:-${UI_REPO}/../identuum-idp-ce}"

if [ ! -d "$CE_REPO" ]; then
    echo "harness: cannot find identuum-idp-ce at ${CE_REPO}" >&2
    exit 1
fi

COMPOSE="docker compose -p ${PROJECT_NAME} \
  -f ${CE_REPO}/deployment/docker-compose.yml \
  -f ${CE_REPO}/deployment/docker-compose.build.yml"
if [ -f "${SMOKE_DIR}/override.yml" ]; then
    COMPOSE="${COMPOSE} -f ${SMOKE_DIR}/override.yml"
fi

echo "harness: down -v for ${PROJECT_NAME}"
$COMPOSE down -v || true

# Overwrite token file before unlink.
if [ -f "${SMOKE_DIR}/upgrade-token.txt" ]; then
    # dd zeroes the file in place before rm.
    SZ=$(wc -c < "${SMOKE_DIR}/upgrade-token.txt" | tr -d ' ')
    if [ "$SZ" -gt 0 ]; then
        dd if=/dev/zero of="${SMOKE_DIR}/upgrade-token.txt" bs=1 count="$SZ" conv=notrunc 2>/dev/null || true
    fi
    rm -f "${SMOKE_DIR}/upgrade-token.txt"
fi

# Remove the remaining scratch files + dir.
rm -f "${SMOKE_DIR}/override.yml" \
      "${SMOKE_DIR}/oss-shape.sql" \
      "${SMOKE_DIR}/live-env.sh" \
      "${SMOKE_DIR}/psql-seed.log" \
      "${SMOKE_DIR}/upgrade-token-cat.err"
rmdir "${SMOKE_DIR}" 2>/dev/null || true

echo "harness: teardown complete"
