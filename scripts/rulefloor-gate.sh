#!/usr/bin/env bash
# Resolve the rulefloor binary for the RULE-FLOOR.md ledger gate:
# $RULEFLOOR_BIN if set, else `rulefloor` on PATH (the brew binary),
# else build-and-run the sibling ../rulefloor checkout as LAST resort.
#
# Refuses anything older than v0.2.0: the v0.1.0 binary cannot parse
# RED-PROOFS ledgers and dies with a misleading "line 2: malformed
# header" — the fix is `brew upgrade rulefloor`. Prints the resolved
# path + version; a resolution or version failure exits 2
# (CANNOT-EVALUATE), never a silent skip.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
sibling="$repo/../rulefloor"

if [ -n "${RULEFLOOR_BIN:-}" ]; then
  rf="$RULEFLOOR_BIN"
elif command -v rulefloor >/dev/null 2>&1; then
  rf="$(command -v rulefloor)"
else
  if [ ! -d "$sibling" ]; then
    echo "rulefloor gate: CANNOT-EVALUATE — no rulefloor binary (set RULEFLOOR_BIN, 'brew install rulefloor', or clone ../rulefloor)" >&2
    exit 2
  fi
  if [ ! -x "$sibling/rulefloor" ]; then
    echo "rulefloor gate: building $sibling/rulefloor (sibling fallback)"
    (cd "$sibling" && go build -o rulefloor .) || {
      echo "rulefloor gate: CANNOT-EVALUATE — go build of the rulefloor tool failed" >&2
      exit 2
    }
  fi
  rf="$sibling/rulefloor"
fi

v="$("$rf" --version 2>/dev/null | awk '{print $2}')"
case "$v" in
  dev) ;;
  v*)
    if [ "$(printf 'v0.2.0\n%s\n' "$v" | sort -V | head -1)" != "v0.2.0" ]; then
      echo "rulefloor gate: CANNOT-EVALUATE — rulefloor $v is older than v0.2.0 and cannot read RED-PROOFS ledgers; run: brew upgrade rulefloor" >&2
      exit 2
    fi
    ;;
  *)
    echo "rulefloor gate: CANNOT-EVALUATE — could not determine rulefloor version from $rf" >&2
    exit 2
    ;;
esac

echo "rulefloor gate: rulefloor $v at $rf"
exec "$rf" check --repo "$repo"
