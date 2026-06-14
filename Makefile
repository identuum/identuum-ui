COMPOSE_FILE ?= deployment/docker-compose.local.yml
COMPOSE_CMD ?= docker compose
DEV_SERVICE ?= identuum-ui
DEV_HEALTH_URL ?= http://127.0.0.1:7114/api/health
DEV_RUNTIME_URL ?= http://127.0.0.1:7114/api/runtime
DEV_PLATFORM_STATUS_URL ?= http://127.0.0.1:7114/platform-status

# AG OSS alternate-port profile (see deployment/docker-compose.local.ag-oss-alt.yml
# and config/ui-runtime.ag-oss-alt.json). Combine with COMPOSE_FILE via
# the existing `-f` chain to recreate identuum-ui pointed at AG OSS on
# 127.0.0.1:7315 instead of the monolith on 7215.
AG_OSS_ALT_COMPOSE_OVERRIDE ?= deployment/docker-compose.local.ag-oss-alt.yml

.PHONY: verify dev-up dev-rebuild dev-recreate dev-ps dev-logs dev-down dev-smoke dev-health dev-smoke-runtime
.PHONY: dev-rebuild-ag-oss-alt dev-recreate-ag-oss-alt dev-smoke-runtime-ag-oss-alt dev-smoke-platform-status-ag-oss-alt
.PHONY: verify-live-upgrade-backup

verify:
	pnpm exec biome check . --reporter=json --max-diagnostics=none
	pnpm exec tsc --noEmit
	pnpm exec vitest run

## verify-live-upgrade-backup: opt-in live-backend Playwright
## regression for the OSS-to-CE /upgrade wizard backup flow.
##
## NOT part of `make verify` and NOT part of default CI — running
## this target stands up a throwaway Compose project with a
## source-build CE backend + UI + OSS-shaped Postgres on host ports
## 7129 (IDP) and 7130 (UI), drives the live spec in Chromium, and
## ALWAYS tears the throwaway project down (even on failure) via
## the wrapper's `trap` clause. The 9 unrelated dev containers are
## not touched.
##
## Prereqs: identuum-idp-ce source tree at ../identuum-idp-ce (or
## IDENTUUM_CE_REPO=<path>), Docker Compose with BuildKit support,
## curl, psql-in-container.
##
## The harness captures the upgrade-token to a mode-0600 file
## under the scratch dir; the token VALUE never appears in this
## make target's stdout/stderr.
verify-live-upgrade-backup:
	./e2e/scripts/run-upgrade-backup-live.sh

## dev-up: start the local UI stack.
dev-up:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) up -d

## dev-rebuild: rebuild and force-recreate the local UI service.
dev-rebuild:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) up -d --build --force-recreate $(DEV_SERVICE)

## dev-recreate: force-recreate the local UI service without rebuilding.
dev-recreate:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) up -d --force-recreate $(DEV_SERVICE)

## dev-ps: show local UI compose status.
dev-ps:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) ps

## dev-logs: follow local UI logs (Ctrl-C to detach).
dev-logs:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) logs -f $(DEV_SERVICE)

## dev-down: stop and remove the local UI stack (volumes preserved).
dev-down:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) down

## dev-smoke: check the local UI health endpoint.
dev-smoke:
	curl -fsS --max-time 5 $(DEV_HEALTH_URL) >/dev/null
	@echo "UI local smoke checks passed."

## dev-health: alias for dev-smoke.
dev-health: dev-smoke

## dev-smoke-runtime: probe the UI's server-side runtime composition
## endpoint /api/runtime. This is the unauthenticated UI-owned
## composition view that drives /platform-status; it returns the
## composed RuntimeState (IDP and AG component discovery, computed
## platform mode). Useful after AG OSS or IDP OSS rebuilds to verify
## the UI sees the corrected wire shape.
##
## The probe does NOT require any backend to be reachable. The UI
## endpoint always returns 200 with whatever discovery state the
## server-side composition produced. The smoke asserts only that the
## response is reachable, JSON, and includes the expected top-level
## keys (mode + components.idp + components.ag) — no business-logic
## claim. Uses portable curl + grep (no jq dependency).
dev-smoke-runtime:
	@echo "  Probing $(DEV_RUNTIME_URL) …"
	@BODY="$$(curl -fsS --max-time 5 $(DEV_RUNTIME_URL))" \
		|| { echo "  FAIL: /api/runtime unreachable"; exit 1; }; \
		echo "$$BODY" | grep -q '"mode"' \
			|| { echo "  FAIL: /api/runtime response missing 'mode' key"; echo "$$BODY"; exit 1; }; \
		echo "$$BODY" | grep -q '"components"' \
			|| { echo "  FAIL: /api/runtime response missing 'components' key"; echo "$$BODY"; exit 1; }
	@echo "UI runtime composition smoke passed."

# ─── AG OSS alternate-port UI profile ───────────────────────────────────────
#
# These targets recreate identuum-ui-app pointed at the AG OSS host
# binary on 127.0.0.1:7315 (management) and 7314 (identity), instead of
# the default monolith on 7215. Pair with identuum-ag-oss/`make dev-up`
# + `make dev-run-app-alt`, which the operator must start in a separate
# shell first.
#
# Restoring the default monolith profile is just `make dev-rebuild` —
# the override env var goes away and the container reads
# config/ui-runtime.json again.

## dev-rebuild-ag-oss-alt: rebuild + force-recreate the local UI
## container with IDENTUUM_UI_CONFIG_FILE pointed at the AG OSS
## alternate-port runtime config (config/ui-runtime.ag-oss-alt.json).
dev-rebuild-ag-oss-alt:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) -f $(AG_OSS_ALT_COMPOSE_OVERRIDE) up -d --build --force-recreate $(DEV_SERVICE)

## dev-recreate-ag-oss-alt: force-recreate the local UI container with
## the AG OSS alternate-port profile, without rebuilding the image.
dev-recreate-ag-oss-alt:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) -f $(AG_OSS_ALT_COMPOSE_OVERRIDE) up -d --force-recreate $(DEV_SERVICE)

## dev-smoke-runtime-ag-oss-alt: probe /api/runtime and assert the AG
## OSS facts (product=identuum-ag-oss, capability_map_schema_version=
## ag-capabilities.v1). Requires the UI to have been started with
## `make dev-rebuild-ag-oss-alt` AND identuum-ag-oss `dev-run-app-alt`
## to be running. Portable curl + grep (no jq).
dev-smoke-runtime-ag-oss-alt:
	@echo "  Probing $(DEV_RUNTIME_URL) …"
	@BODY="$$(curl -fsS --max-time 5 $(DEV_RUNTIME_URL))" \
		|| { echo "  FAIL: /api/runtime unreachable"; exit 1; }; \
		echo "$$BODY" | grep -q '"mode"' \
			|| { echo "  FAIL: /api/runtime response missing 'mode' key"; echo "$$BODY"; exit 1; }; \
		echo "$$BODY" | grep -q '"components"' \
			|| { echo "  FAIL: /api/runtime response missing 'components' key"; echo "$$BODY"; exit 1; }; \
		echo "$$BODY" | grep -q '"product":"identuum-ag-oss"' \
			|| { echo "  FAIL: /api/runtime does not advertise components.ag.product=identuum-ag-oss. Is identuum-ag-oss dev-run-app-alt running on 127.0.0.1:7315? Did you run 'make dev-rebuild-ag-oss-alt'?"; echo "$$BODY"; exit 1; }; \
		echo "$$BODY" | grep -q '"capability_map_schema_version":"ag-capabilities.v1"' \
			|| { echo "  FAIL: /api/runtime does not advertise components.ag.capability_map_schema_version=ag-capabilities.v1"; echo "$$BODY"; exit 1; }
	@echo "UI runtime composition AG-OSS-alt smoke passed (AG OSS product + schema visible via /api/runtime)."

## dev-smoke-platform-status-ag-oss-alt: visual-layer smoke. Fetches
## the live /platform-status HTML and asserts the AG OSS backend
## identity rows actually render (label "Backend product" + value
## "identuum-ag-oss" + label "Capability schema" + value
## "ag-capabilities.v1"). Requires `make dev-rebuild-ag-oss-alt` AND
## identuum-ag-oss `dev-run-app-alt` to be running. Portable curl +
## grep (no jq, no browser).
dev-smoke-platform-status-ag-oss-alt:
	@echo "  Probing $(DEV_PLATFORM_STATUS_URL) …"
	@BODY="$$(curl -fsS --max-time 10 $(DEV_PLATFORM_STATUS_URL))" \
		|| { echo "  FAIL: /platform-status unreachable"; exit 1; }; \
		echo "$$BODY" | grep -q 'Backend product' \
			|| { echo "  FAIL: /platform-status HTML missing 'Backend product' label. Is the UI on the AG OSS alt profile and is AG OSS dev-run-app-alt running?"; exit 1; }; \
		echo "$$BODY" | grep -q 'identuum-ag-oss' \
			|| { echo "  FAIL: /platform-status HTML missing 'identuum-ag-oss' (Backend product value)"; exit 1; }; \
		echo "$$BODY" | grep -q 'Capability schema' \
			|| { echo "  FAIL: /platform-status HTML missing 'Capability schema' label"; exit 1; }; \
		echo "$$BODY" | grep -q 'ag-capabilities.v1' \
			|| { echo "  FAIL: /platform-status HTML missing 'ag-capabilities.v1' (Capability schema value)"; exit 1; }; \
		echo "$$BODY" | grep -q 'Agent Governance (AG)' \
			|| { echo "  FAIL: /platform-status HTML missing 'Agent Governance (AG)' card heading"; exit 1; }; \
		if echo "$$BODY" | grep -q 'Wrong component'; then \
			echo "  FAIL: /platform-status HTML shows a 'Wrong component' warning — AG family identifier mismatch"; \
			exit 1; \
		fi
	@echo "/platform-status AG-OSS-alt visual smoke passed (Backend product + Capability schema rows render with canonical AG OSS values)."
