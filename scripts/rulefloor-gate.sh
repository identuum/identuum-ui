#!/usr/bin/env bash
# Resolve the rulefloor binary for the RULE-FLOOR.md ledger gate:
# $RULEFLOOR_BIN if set (explicit operator choice — an unsuitable one is
# FATAL), else `rulefloor` on PATH, else build-and-run the sibling
# ../rulefloor checkout as LAST resort.
#
# Suitability is probed through the machine interface `version --json`
# (rulefloor.version.v1, v0.3.0+): older binaries have no machine
# interfaces and are refused — this floor rose from v0.2.0 to v0.3.0 the
# day the probe moved off human-readable `--version` output
# (THE-TOOLING-UPGRADE). A PATH binary that fails the probe FALLS
# THROUGH to the sibling instead of failing outright, so a stale brew
# binary cannot mask a good sibling checkout; a sibling binary that
# fails the probe is rebuilt once. "dev" builds (sibling or go-install)
# pass by answering the probe. Resolution failure exits 2
# (CANNOT-EVALUATE), never a silent skip.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
sibling="$repo/../rulefloor"

probe() { # prints the version a candidate self-reports, or nothing
  "$1" version --json 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'
}
suitable() { # dev, or >= v0.3.0
  case "$1" in
    dev) return 0 ;;
    v*) [ "$(printf 'v0.3.0\n%s\n' "$1" | sort -V | head -1)" = "v0.3.0" ] ;;
    *) return 1 ;;
  esac
}

rf=""
if [ -n "${RULEFLOOR_BIN:-}" ]; then
  rf="$RULEFLOOR_BIN"
else
  if command -v rulefloor >/dev/null 2>&1; then
    cand="$(command -v rulefloor)"
    if suitable "$(probe "$cand")"; then
      rf="$cand"
    else
      echo "rulefloor gate: rulefloor on PATH predates v0.3.0 machine interfaces; trying the sibling"
    fi
  fi
  if [ -z "$rf" ]; then
    if [ ! -d "$sibling" ]; then
      echo "rulefloor gate: CANNOT-EVALUATE — no rulefloor v0.3.0+ (set RULEFLOOR_BIN, 'brew upgrade rulefloor', 'go install github.com/ozgurcd/rulefloor@v0.3.0', or clone ../rulefloor)" >&2
      exit 2
    fi
    if [ ! -x "$sibling/rulefloor" ] || ! suitable "$(probe "$sibling/rulefloor")"; then
      echo "rulefloor gate: building $sibling/rulefloor (sibling fallback)"
      (cd "$sibling" && go build -o rulefloor .) || {
        echo "rulefloor gate: CANNOT-EVALUATE — go build of the rulefloor tool failed" >&2
        exit 2
      }
    fi
    rf="$sibling/rulefloor"
  fi
fi

v="$(probe "$rf")"
if ! suitable "${v:-unknown}"; then
  echo "rulefloor gate: CANNOT-EVALUATE — $rf does not answer 'version --json' with v0.3.0+ (rulefloor.version.v1)" >&2
  exit 2
fi

echo "rulefloor gate: rulefloor $v at $rf"
exec "$rf" check --repo "$repo"
