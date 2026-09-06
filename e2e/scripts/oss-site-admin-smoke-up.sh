#!/usr/bin/env bash
# oss-site-admin-smoke-up.sh — bring up a disposable identuum-idp-oss stack for
# the OSS site-admin overview smoke test. Called by run-oss-site-admin-smoke.sh.
#
# Steps:
#   1. Start a disposable Postgres (postgres:18-alpine) on a host port.
#   2. Build the identuum-idp-oss binary from the sibling repo.
#   3. --migrate the disposable DB, then --bootstrap a site_admin with a
#      policy-conforming password (read by the binary from
#      IDENTUUM_IDP_BOOTSTRAP_PASSWORD; never printed).
#   4. Start the full OSS API via --gin-serve (mirrors deployment/entrypoint.sh).
#   5. Write a ui-runtime.json pointing the UI at the OSS backend and a
#      live-env.sh consumed by the runner.
#
# Writes a single line to stdout: the scratch dir path. All status goes to stderr.
#
# SECURITY: the DB URL, the DB password, and the bootstrap admin password are
# NEVER echoed. live-env.sh (which carries the admin password for Playwright)
# is written mode-0600 and removed by the down-script.
set -euo pipefail

UI_DIR="$(cd "$(dirname "$0")/../.." && pwd)"          # identuum-ui
OSS_DIR="$(cd "$UI_DIR/../identuum-idp-oss" && pwd)"   # sibling identuum-idp-oss

PG_PORT="${OSS_SMOKE_PG_PORT:-5541}"
IDP_PORT="${OSS_SMOKE_IDP_PORT:-7142}"
UI_PORT="${OSS_SMOKE_UI_PORT:-7143}"

SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/oss-site-admin-smoke.XXXXXX")"
PG_NAME="oss-site-admin-smoke-pg-$$"
DB_PW="$(openssl rand -hex 16)"
DB_NAME="identuum_idp_oss"
DB_URL="postgres://postgres:${DB_PW}@127.0.0.1:${PG_PORT}/${DB_NAME}?sslmode=disable"
ISSUER="http://127.0.0.1:${IDP_PORT}"

# Policy-conforming test credential (>=12 chars; upper+lower+digit+special from
# the allowed set "!@#%^&*-+=?_~"). This is a throwaway smoke credential.
ADMIN_EMAIL="site_admin@system.local"
ADMIN_PW="Sm0ke!Not-A-Secret-9"
# Known base32 TOTP secret seeded for the site_admin (OSS forces MFA for
# site_admin; OSS stores mfa_secret as plaintext base32). The spec computes the
# RFC 6238 code from this and completes the real MFA login.
ADMIN_TOTP_SECRET="JBSWY3DPEHPK3PXP"

log() { printf 'oss-smoke-up: %s\n' "$1" >&2; }

# --- 1. disposable Postgres -------------------------------------------------
log "starting disposable Postgres (${PG_NAME}) on 127.0.0.1:${PG_PORT}"
docker run -d --name "$PG_NAME" \
  -e POSTGRES_PASSWORD="$DB_PW" -e POSTGRES_DB="$DB_NAME" \
  -p "127.0.0.1:${PG_PORT}:5432" postgres:18-alpine >/dev/null

printf '%s\n' "$SMOKE_DIR" >"$SMOKE_DIR/.unused"  # ensure dir is writable
echo "$PG_NAME" >"$SMOKE_DIR/pg.name"
echo "$SMOKE_DIR" >"$SMOKE_DIR/dir"

log "waiting for Postgres to accept connections"
for _ in $(seq 1 60); do
  if docker exec "$PG_NAME" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$PG_NAME" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1 || {
  log "ERROR: Postgres did not become ready"; exit 1; }

# --- 2. build OSS binary ----------------------------------------------------
log "building identuum-idp-oss binary"
( cd "$OSS_DIR" && go build -o "$SMOKE_DIR/identuum-idp" ./cmd/identuum-idp )

# --- 3. migrate + bootstrap -------------------------------------------------
log "applying migrations"
"$SMOKE_DIR/identuum-idp" --migrate "$DB_URL" >"$SMOKE_DIR/migrate.log" 2>&1 || {
  log "ERROR: --migrate failed (see migrate.log)"; tail -5 "$SMOKE_DIR/migrate.log" >&2; exit 1; }

log "bootstrapping site_admin (${ADMIN_EMAIL}); password not printed"
IDENTUUM_IDP_BOOTSTRAP_PASSWORD="$ADMIN_PW" \
IDENTUUM_IDP_BOOTSTRAP_EMAIL="$ADMIN_EMAIL" \
IDENTUUM_IDP_BOOTSTRAP_ALGORITHM="EdDSA" \
  "$SMOKE_DIR/identuum-idp" --bootstrap "$DB_URL" >"$SMOKE_DIR/bootstrap.log" 2>&1 || {
  log "ERROR: --bootstrap failed (see bootstrap.log)"; tail -5 "$SMOKE_DIR/bootstrap.log" >&2; exit 1; }

log "setting site_admin password via --recover-site-admin (resets pw + MFA + pwchange)"
IDENTUUM_IDP_RECOVER_SITE_ADMIN_PASSWORD="$ADMIN_PW" "$SMOKE_DIR/identuum-idp" --recover-site-admin "$DB_URL" >"$SMOKE_DIR/recover.log" 2>&1 || { log "ERROR: --recover-site-admin failed"; tail -5 "$SMOKE_DIR/recover.log" >&2; exit 1; }

# --- 3b. mark first-run setup complete on the DISPOSABLE test DB -----------
# --bootstrap creates the site_admin + signing key but leaves the singleton
# system_setup_state row at 'setup_required', which would make the UI redirect
# /login -> /setup. We flip the disposable test DB's operational setup state to
# 'setup_complete' so the bootstrapped admin can sign in. This touches ONLY the
# throwaway test database's setup-state row — it modifies no backend handler and
# no authorization guard (RequireSiteAdmin is untouched). The id is the existing
# UUIDv7 singleton sentinel.
log "marking first-run setup complete on the disposable test DB"
docker exec "$PG_NAME" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -c \
  "UPDATE system_setup_state SET status='setup_complete', completed_at=NOW() WHERE id='00000000-0000-7000-0000-000000000010';" \
  >"$SMOKE_DIR/setup-complete.log" 2>&1 || {
  log "ERROR: could not mark setup complete (see setup-complete.log)"; tail -5 "$SMOKE_DIR/setup-complete.log" >&2; exit 1; }

# --- 4. gin-serve (full OSS API) -------------------------------------------
log "starting OSS --gin-serve on 127.0.0.1:${IDP_PORT} (issuer=${ISSUER})"
# Fully detach so the server SURVIVES this script's exit. up.sh runs inside a
# command-substitution subshell in the runner; without setsid/nohup+disown the
# backgrounded server can be torn down when that subshell exits, leaving the UI
# proxy with a 502 "IdP unreachable" during the test.
IDENTUUM_IDP_DATABASE_URL="$DB_URL" \
  nohup "$SMOKE_DIR/identuum-idp" \
    --gin-serve "127.0.0.1:${IDP_PORT}" \
    --jwks-db "$DB_URL" \
    --issuer "$ISSUER" >"$SMOKE_DIR/idp.log" 2>&1 &
IDP_BG_PID=$!
echo "$IDP_BG_PID" >"$SMOKE_DIR/idp.pid"
disown "$IDP_BG_PID" 2>/dev/null || true

log "waiting for OSS /health"
for _ in $(seq 1 60); do
  code="$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${IDP_PORT}/health" || true)"
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${IDP_PORT}/health" || true)" = "200" ] || {
  log "ERROR: OSS /health never returned 200 (see idp.log)"; tail -10 "$SMOKE_DIR/idp.log" >&2; exit 1; }

log "bootstrap.log tail:"; tail -3 "$SMOKE_DIR/bootstrap.log" >&2 || true
docker exec "$PG_NAME" psql -U postgres -d "$DB_NAME" -t -c "SELECT email, role, banned, email_verified, deleted_at IS NULL AS not_deleted, LEFT(password_hash,10) AS hashpfx, organization_id FROM users WHERE email='${ADMIN_EMAIL}';" 2>&1 | sed 's/^/oss-smoke-up: userrow: /' >&2 || true

# Ensure the System Organization row is active on the DISPOSABLE test DB.
# The bootstrapped site_admin is pinned to SystemOrgID; the login user-lookup
# (FindUsersByEmail) only returns users whose organization is active+not-deleted
# (or org_id NULL). --bootstrap pins the user to the System Org but does not
# guarantee an active System Org row, so we ensure it here. Test-harness DB
# state only — no backend handler or authorization guard is modified.
log "System Organization row (before):"
docker exec "$PG_NAME" psql -U postgres -d "$DB_NAME" -t \
  -c "SELECT id, active, deleted_at IS NULL AS not_deleted FROM organizations WHERE id='00000000-0000-7000-0000-000000000000';" \
  2>&1 | sed 's/^/oss-smoke-up: org: /' >&2 || true
docker exec "$PG_NAME" psql -U postgres -d "$DB_NAME" -t \
  -c "UPDATE organizations SET active=true, deleted_at=NULL WHERE id='00000000-0000-7000-0000-000000000000';" \
  2>&1 | sed 's/^/oss-smoke-up: org-update: /' >&2 || true

# Clear any force-password-change flag on the bootstrapped admin. The login
# service treats requires_password_change=true as a hard block (collapsed to
# invalid_credentials); --bootstrap does not set it false (only
# --recover-site-admin does). Also confirm the row's relevant login flags.
# Test-harness DB state only — no handler or authorization guard is modified.
docker exec "$PG_NAME" psql -U postgres -d "$DB_NAME" -t \
  -c "SELECT requires_password_change, mfa_enabled FROM users WHERE email='${ADMIN_EMAIL}';" \
  2>&1 | sed 's/^/oss-smoke-up: loginflags: /' >&2 || true
docker exec "$PG_NAME" psql -U postgres -d "$DB_NAME" -t \
  -c "UPDATE users SET requires_password_change=false WHERE email='${ADMIN_EMAIL}';" \
  2>&1 | sed 's/^/oss-smoke-up: pwchange-clear: /' >&2 || true

# Seed TOTP MFA for the site_admin. OSS forces MFA for site_admin
# (IsMFARequiredForUser), so a password-only login returns
# mfa_enrollment_required. The OSS PlaintextTOTPSecretResolver treats the
# users.mfa_secret column verbatim as the base32 TOTP secret, so we seed a
# known base32 secret + mfa_enabled=true and have the test complete the REAL
# TOTP login. Test-harness DB state only — no handler/guard is modified, and
# MFA enforcement is exercised (not bypassed).
log "seeding TOTP MFA secret for the site_admin"
docker exec "$PG_NAME" psql -U postgres -d "$DB_NAME" -t \
  -c "UPDATE users SET mfa_enabled=true, mfa_secret='${ADMIN_TOTP_SECRET}' WHERE email='${ADMIN_EMAIL}';" \
  2>&1 | sed 's/^/oss-smoke-up: mfa-seed: /' >&2 || true

# --- 5. UI runtime config + live-env ---------------------------------------
cat >"$SMOKE_DIR/ui-runtime.json" <<JSON
{
  "configured": true,
  "ui_origin": "http://localhost:${UI_PORT}",
  "idp": {
    "enabled": true,
    "public_base_url": "${ISSUER}",
    "internal_base_url": "${ISSUER}"
  },
  "ag": {
    "enabled": false,
    "public_base_url": ""
  }
}
JSON

umask 077
cat >"$SMOKE_DIR/live-env.sh" <<ENV
# Sourced by run-oss-site-admin-smoke.sh. Gates + parameterizes the one spec.
export IDENTUUM_E2E_OSS_SITE_ADMIN_SMOKE=1
export IDENTUUM_E2E_PORT="${UI_PORT}"
export IDENTUUM_E2E_BASE_URL="http://localhost:${UI_PORT}"
export IDENTUUM_UI_CONFIG_FILE="${SMOKE_DIR}/ui-runtime.json"
export IDENTUUM_E2E_OSS_SMOKE_ADMIN_EMAIL="${ADMIN_EMAIL}"
export IDENTUUM_E2E_OSS_SMOKE_ADMIN_PASSWORD='${ADMIN_PW}'
export IDENTUUM_E2E_OSS_SMOKE_ADMIN_TOTP_SECRET="${ADMIN_TOTP_SECRET}"
export OSS_SMOKE_DIR="${SMOKE_DIR}"
export OSS_SMOKE_PG_NAME="${PG_NAME}"
ENV
chmod 600 "$SMOKE_DIR/live-env.sh"

log "stack up — OSS ${ISSUER}, UI will start on 127.0.0.1:${UI_PORT}"
printf '%s\n' "$SMOKE_DIR"
