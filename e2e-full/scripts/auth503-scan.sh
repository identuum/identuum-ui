#!/usr/bin/env bash
# auth503-scan.sh — THE-SESSION-REJECTION-ROOT-CAUSE (2026-09-02, AUTH-503).
#
# After the whole two-repo mint ran against the appliance, print every
# `AUTH-503` ERROR line the IdP logged: a store / infrastructure error on the
# authentication path that was answered 503 (with a correlation id) instead
# of the old unlogged 401. The count and the lines land in the record as
# evidence. This phase is NEVER red on a hit: a transient store error that
# was logged and answered honestly is the hunt's SIGNAL (the UI retries a
# 503; the assertion that matters — no bare 401 — lives in the specs). It is
# red only when the log cannot be read at all.
#
# Usage: auth503-scan.sh <idp-oss repo dir>
set -u
IDP_DIR="${1:?idp-oss repo dir}"
COMPOSE=(docker compose -f "$IDP_DIR/deployment/docker-compose.dev.yml" --profile app)

if ! LOG="$("${COMPOSE[@]}" logs --no-color app 2>/dev/null)"; then
	echo "auth503-scan: cannot read the appliance log" >&2
	exit 1
fi
HITS="$(printf '%s\n' "$LOG" | grep -F 'AUTH-503' || true)"
COUNT=0
if [ -n "$HITS" ]; then
	COUNT="$(printf '%s\n' "$HITS" | wc -l | tr -d ' ')"
fi
printf '\n'
echo "check OK: auth503-scan lines=$COUNT (AUTH-503 store errors the appliance answered as 503 during this mint; 0 = the transient did not fire)"
if [ "$COUNT" -gt 0 ]; then
	printf '%s\n' "$HITS" | cut -c1-600
fi
exit 0
