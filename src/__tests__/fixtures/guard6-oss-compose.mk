# Snapshot of identuum-idp-oss's Makefile (OSS-MINT-GUARD-6): the variables and
# recipes the nested `make oss-up` of e2e-full runs — COMPOSE_CMD's default,
# COMPOSE_CMD_IS_DOCKER_COMPOSE, HARNESS_MUTEX, HARNESS_BINDING_CHECK,
# DEV_COMPOSE, oss-build and oss-up — copied verbatim, without oss-up's
# protected-guard / oss-app-container-check prerequisites and with a fixed
# COMMIT. Real GNU make runs it against the test's docker stub, so the
# runner's nested command line and environment meet the actual expansion.
# Update it when those recipes change in identuum-idp-oss.
SHELL := /bin/bash
COMPOSE_CMD ?= docker compose
COMMIT := fixture
DEV_COMPOSE_PROJECT = $(or $(IDENTUUM_IDP_COMPOSE_PROJECT),identuum-idp-oss-dev)
COMPOSE_FILE ?= deployment/docker-compose.dev.yml
COMPOSE_CMD_IS_DOCKER_COMPOSE = $(if $(and $(findstring $(value COMPOSE_CMD),docker compose),$(findstring docker compose,$(value COMPOSE_CMD))),yes,no)
override HARNESS_MUTEX := identuum-harness-lock-engine
HARNESS_BINDING_CHECK = @if [ -n "$${IDENTUUM_HARNESS_ENGINE_ID:-}" ]; then \
	r="$@: REFUSED under the harness binding (nothing was built or started)"; \
	[ "$(COMPOSE_CMD_IS_DOCKER_COMPOSE)" = yes ] || { echo "$$r — COMPOSE_CMD is not exactly 'docker compose'" >&2; exit 2; }; \
	case "$${DOCKER_CONTEXT:-}|$${DOCKER_HOST:-}" in "|unix:///"*) ;; *) echo "$$r — the Docker endpoint is not the harness's pinned unix socket" >&2; exit 2;; esac; \
	[ "$$(docker info --format '{{.ID}}' 2>/dev/null)" = "$$IDENTUUM_HARNESS_ENGINE_ID" ] || { echo "$$r — the Docker daemon answering is not the engine the harness checked (its ID changed, or it did not answer)" >&2; exit 2; }; \
	[ -n "$${IDENTUUM_HARNESS_MUTEX_ID:-}" ] && [ "$$(docker container inspect --format '{{.Id}}' $(HARNESS_MUTEX) 2>/dev/null)" = "$$IDENTUUM_HARNESS_MUTEX_ID" ] || { echo "$$r — the daemon mutex $(HARNESS_MUTEX) is not the harness's own" >&2; exit 2; }; \
	fi
DEV_COMPOSE = env -u COMPOSE_PROJECT_NAME -u COMPOSE_REMOVE_ORPHANS IDENTUUM_IDP_COMPOSE_PROJECT=$(DEV_COMPOSE_PROJECT) $(COMPOSE_CMD) -p $(DEV_COMPOSE_PROJECT) -f $(COMPOSE_FILE)
oss-build:
	$(HARNESS_BINDING_CHECK)
	$(DEV_COMPOSE) --profile app build --build-arg COMMIT=$(COMMIT) app

oss-up: oss-build
	$(HARNESS_BINDING_CHECK)
	$(DEV_COMPOSE) --profile app up -d
