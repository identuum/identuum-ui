## SHELL: recipes run /bin/bash, the same pin identuum-idp-oss carries.
## Without it make runs /bin/sh, which is bash 3.2 in POSIX mode on macOS and
## dash on Debian; today no recipe here uses a construct that differs between
## them (THE-UI-HOUSEKEEPING, 2026-09-06: 99 recipe lines scanned, 0 bash-only
## or bash-4-only constructs), so the pin is preventive parity, not a fix.
SHELL := /bin/bash

COMPOSE_FILE ?= deployment/docker-compose.local.yml
COMPOSE_CMD ?= docker compose
DEV_SERVICE ?= identuum-ui
DEV_HEALTH_URL ?= http://127.0.0.1:7104/api/health
DEV_RUNTIME_URL ?= http://127.0.0.1:7104/api/runtime
DEV_PLATFORM_STATUS_URL ?= http://127.0.0.1:7104/platform-status

# AG OSS alternate-port profile (see deployment/docker-compose.local.ag-oss-alt.yml
# and config/ui-runtime.ag-oss-alt.json). Combine with COMPOSE_FILE via
# the existing `-f` chain to recreate identuum-ui pointed at AG OSS on
# 127.0.0.1:7315 instead of the monolith on 7215.
AG_OSS_ALT_COMPOSE_OVERRIDE ?= deployment/docker-compose.local.ag-oss-alt.yml

.PHONY: verify tool-versions wiki-fresh dev-up dev-rebuild dev-recreate dev-ps dev-logs dev-down dev-smoke dev-health dev-smoke-runtime image-base-check image-base-parity tracked-binary-check credential-transparency
.PHONY: dev-rebuild-ag-oss-alt dev-recreate-ag-oss-alt dev-smoke-runtime-ag-oss-alt dev-smoke-platform-status-ag-oss-alt
.PHONY: verify-live-upgrade-backup verify-ui-oss-contract verify-ui-oss-customer-smoke-passkey verify-ui-ce-auth verify-ui-ce-customer-smoke verify-ui-ce-customer-smoke-passkey verify-ui-ce-fresh-m1-setup verify-ui-ce-fresh-m1-setup-licensed
.PHONY: e2e-full

## wiki-fresh: WIKI-1 gate — fail verify when this repo's wiki page is BEHIND.
## Runs `achta wiki check --only freshness` against the sibling wiki checkout,
## the same recipe identuum-idp-oss carries. Until THE-UI-HOUSEKEEPING
## (2026-09-06) this target still called tools/wiki-freshness.sh, a script the
## wiki retired on 2026-09-05 (THE-THREE-VERB-RETIREMENT): every ui `make
## verify` since then stopped at target 2 with "No such file or directory",
## exit 127 — a gate that fails because its tool is gone, not because the pin
## is stale. BE HONEST ABOUT WHAT THIS ENFORCES: at verify time HEAD is the
## LAST commit, so a green gate means "the PREVIOUS slice's wiki update was
## banked before new work is verified" — zero commits of allowed drift. It does
## NOT and cannot check the commit you are about to make; the §F-bis append for
## THIS slice is still on you, and the gate will catch its absence on the NEXT
## slice's verify. A missing wiki dir (fresh clone / CI) prints one loud SKIPPED
## line and continues — visible, never silent. A missing or too-old achta exits
## 2 by name, never 0. The old typo guard ("--repo matches no page exits 2") is
## gone with the --repo flag; what replaces it is --wiki-dir's own refusal of
## any directory that is not a workspace's direct wiki child, so a mistyped
## WIKI_DIR fails here rather than checking nothing.
WIKI_DIR ?= ../wiki

wiki-fresh:
	@if [ ! -d "$(WIKI_DIR)" ]; then \
		echo "WIKI FRESHNESS SKIPPED: no wiki at $(WIKI_DIR)"; \
	else \
		command -v achta >/dev/null 2>&1 || { echo "wiki-fresh: achta is not installed — this gate needs achta >= v0.4.1 (wiki check --only freshness)" >&2; exit 2; }; \
		out=$$(achta --wiki-dir "$(WIKI_DIR)" wiki check --only freshness 2>&1); rc=$$?; \
		printf '%s\n' "$$out"; \
		case "$$out" in *"flag provided but not defined: -only"*) echo "wiki-fresh: achta >= v0.4.1 required (wiki check --only freshness); installed: $$(achta version)" >&2; exit 2;; esac; \
		exit $$rc; \
	fi

## tracked-binary-check: no compiled binary and no oversized blob may be
## TRACKED. Ported as-is from identuum-idp-oss (THE-STRAY-BINARY, 2026-08-07;
## THE-UI-GATE-PARITY, 2026-09-06): there a 3.8 MB Mach-O swept up by a broad
## `git add` rode every clone and a source tag before a rebuild overwrote it.
## Here the same one `git add` away is a `.next` output or a stray binary.
## Refused: any tracked file whose first four bytes are ELF or Mach-O magic
## (either endianness, plus the universal-binary cafebabe), or whose size
## exceeds 1 MiB. Measured before landing: largest tracked file 203887 bytes,
## 0 magic hits across 507 tracked files.
##
## NO ALLOWLIST, deliberately: if a legitimate oversized file ever lands,
## this prints it and FAILS for an owner ruling, rather than allowlisting it
## silently — an allowlist added in the same commit as the file it excuses is
## how gates go quiet. One-repo self-contained (the CI-shape rule): git
## ls-files + head + od, nothing outside the checkout.
tracked-binary-check:
	@bad=0; \
	while IFS= read -r -d '' f; do \
		[ -f "$$f" ] || continue; \
		magic=$$(head -c4 "$$f" 2>/dev/null | od -An -tx1 | tr -d ' \n'); \
		case "$$magic" in \
			7f454c46) echo "TRACKED BINARY (ELF): $$f"; bad=1;; \
			feedface|feedfacf|cffaedfe|cefaedfe) echo "TRACKED BINARY (Mach-O): $$f"; bad=1;; \
			cafebabe) echo "TRACKED BINARY (universal/cafebabe): $$f"; bad=1;; \
		esac; \
		size=$$(wc -c < "$$f" | tr -d ' '); \
		if [ "$$size" -gt 1048576 ]; then \
			echo "TRACKED FILE OVER 1 MiB: $$f ($$size bytes)"; bad=1; \
		fi; \
	done < <(git ls-files -z); \
	if [ "$$bad" -ne 0 ]; then \
		echo "A compiled binary or oversized blob is TRACKED. If it is a stray build,"; \
		echo "git rm it (and give it a /name .gitignore line). If it is legitimate,"; \
		echo "this gate has NO allowlist on purpose — take it to the owner for a"; \
		echo "ruling instead of teaching the gate to look away."; \
		exit 1; \
	fi; \
	echo "tracked-binary-check: no tracked ELF/Mach-O and nothing over 1 MiB"

## credential-transparency: every committed credential must be UNMISTAKABLY
## fake. Ported from identuum-idp-oss (THE-TRANSPARENT-CREDENTIALS, 2026-08-07)
## with the ui's OWN shapes, derived from what the tree held on 2026-09-06
## (THE-UI-GATE-PARITY): the ui is not a Go service, so a credential reaches
## a running system here through compose env blocks, shell scripts, env
## example files and docs — never through TypeScript fixtures, which feed
## mocked clients (55 such fixtures exist and are NOT credentials). Four
## rules, NO allowlist:
##   1. every tracked postgres://<user>:<pass>@ literal has the password
##      dev-<user>-not-a-secret (2 today, e2e/docker-compose.e2e.yml); a
##      password that is a $-expansion is dynamic, not committed, and skipped;
##   2. every env-style line whose KEY ends in PASSWORD or _PW and carries a
##      literal value (no $ inside) declares itself: the value contains
##      not-a-secret, or starts with REPLACE_ME (the env-example convention);
##   3. every TOTP seed literal (a TOTP_SECRET/mfa_secret/secret key with 16+
##      base32 chars) is the RFC 6238 test seed JBSWY3DPEHPK3PXP or one
##      repeated character (2 today);
##   4. every 64-hex *_ENCRYPTION_KEY literal is the sequential 00 01 … 1f
##      byte string, a value nobody would deploy (1 today).
## Anything else prints file:line and FAILS for an owner ruling — the value is
## never printed. An allowlist added in the same commit as the value it excuses
## is how gates go quiet. One-repo self-contained (the CI-shape rule).
credential-transparency:
	@bad=0; \
	while IFS=: read -r f ln m; do \
		user=$$(printf '%s' "$$m" | sed -E 's|postgres://([A-Za-z_][A-Za-z0-9_]*):.*|\1|'); \
		pass=$$(printf '%s' "$$m" | sed -E 's|postgres://[A-Za-z_][A-Za-z0-9_]*:(.*)@$$|\1|'); \
		case "$$pass" in \$$*) continue;; esac; \
		if [ "$$pass" != "dev-$$user-not-a-secret" ]; then \
			echo "OPAQUE CREDENTIAL: $$f:$$ln — postgres user '$$user' has a password that is not dev-$$user-not-a-secret (value not printed)"; \
			bad=1; \
		fi; \
	done < <(git grep -noE "postgres://[A-Za-z_][A-Za-z0-9_]*:[^@\"'[:space:]]+@" -- .); \
	while IFS=: read -r f ln m; do \
		val=$$(printf '%s' "$$m" | sed -E "s/^[^=:]*[=:][[:space:]]*//; s/^[\"']//; s/[\"']?[[:space:]]*$$//"); \
		case "$$val" in *not-a-secret*|*NOT-A-SECRET*|*Not-A-Secret*|REPLACE_ME*) : ;; \
			*) echo "OPAQUE CREDENTIAL: $$f:$$ln — a password literal that does not declare itself fake (value not printed)"; bad=1;; \
		esac; \
	done < <(git grep -nIE "^[[:space:]]*(export[[:space:]]+)?[A-Z][A-Z0-9_]*(PASSWORD|_PW)[[:space:]]*[:=][[:space:]]*[\"']?[^\"'\$$[:space:]]{4,}[\"']?[[:space:]]*$$" -- .); \
	while IFS=: read -r f ln m; do \
		seed=$$(printf '%s' "$$m" | grep -oE '[A-Z2-7]{16,}' | head -1); \
		case "$$seed" in JBSWY3DPEHPK3PXP) : ;; \
			*) if [ "$$(printf '%s' "$$seed" | fold -w1 | sort -u | wc -l | tr -d ' ')" != "1" ]; then \
				echo "OPAQUE CREDENTIAL: $$f:$$ln — a TOTP seed literal that is neither the RFC 6238 test seed nor one repeated character (value not printed)"; bad=1; \
			fi;; \
		esac; \
	done < <(git grep -nIE "(TOTP_SECRET|mfa_secret|[Ss]ecret)[\"']?[[:space:]]*[:=][[:space:]]*[\"']?[A-Z2-7]{16,}" -- .); \
	seq_key=$$(printf '%02x' $$(seq 0 31) | tr -d ' '); \
	while IFS=: read -r f ln m; do \
		case "$$m" in *"$$seq_key"*) : ;; \
			*) echo "OPAQUE CREDENTIAL: $$f:$$ln — a 64-hex encryption-key literal that is not the sequential 00..1f fake (value not printed)"; bad=1;; \
		esac; \
	done < <(git grep -nIE "_ENCRYPTION_KEY[\"']?[[:space:]]*[:=][[:space:]]*[\"']?[0-9a-f]{64}" -- .); \
	if [ "$$bad" -ne 0 ]; then \
		echo "A committed credential does not declare itself fake. The shapes accepted here:"; \
		echo "dev-<user>-not-a-secret (DSNs and PASSWORD/_PW lines), REPLACE_ME_* (env examples),"; \
		echo "the RFC 6238 test seed or one repeated character (TOTP seeds), the sequential"; \
		echo "00..1f key — anything else goes to the OWNER for a ruling; NO allowlist on purpose."; \
		exit 1; \
	fi; \
	echo "credential-transparency: every committed credential is fake by construction"

## verify: THE UI gate set — biome + typecheck + vitest + rulefloor, all
## four, every slice (THE-UI-FORMAT-FLOOR). Slices run THIS target, never
## an ad-hoc subset: format drift accumulated invisibly across several
## slices because they ran rulefloor + vitest + typecheck directly while
## CI's first step (biome) was never exercised locally — CI run
## 32576361791 then failed at biome with 17 format errors, 16 of them in
## armed ledger bodies. The ledger gate joined this target the same day
## (it was previously only `pnpm rulefloor`, easy to leave behind).
# tool-versions: print this repo's gate-set tools — version AND path
# (THE-UNWATCHED-FOUR: a shadowed binary made "the local brew version"
# a fiction in two reports; print-only, skew made visible every close).
# biome/tsc/vitest ride the frozen lockfile and are printed by their own
# steps' output; the three below are the machine-resolved ones.
tool-versions:
	@printf 'node       %s  %s\n' "$$(node --version 2>/dev/null)" "$$(command -v node || echo MISSING)"
	@printf 'pnpm       %s  %s\n' "$$(pnpm --version 2>/dev/null)" "$$(command -v pnpm || echo MISSING)"
	@printf 'rulefloor  %s  %s\n' "$$(rulefloor version --json 2>/dev/null)" "$$(command -v rulefloor || echo MISSING)"

## e2e-full: the DISPOSABLE full-behavior suite (THE-DISPOSABLE-HARNESS).
## DESTROYS the OSS dev stack's postgres volume, rebuilds the appliance from
## the sibling working tree, bootstraps a run-local site_admin, runs the
## e2e-full Playwright project serially (--workers=1, TOTP physics), then
## fast-cleans again. OPT-IN ONLY — never wired into verify, wiki make
## check, or CI: fired by accident it eats the local dev database.
e2e-full:
	@bash e2e-full/scripts/full-run.sh

verify:
	# THE-UNWITNESSED-GREEN: the same targets as before, driven through
	# scripts/gate-witness.sh so the run leaves a committed record
	# (GATE-RUN.txt): per-target exit codes, the tool versions, the tools'
	# own count lines, and a digest of the tree the run saw (minus the
	# record itself). A run that stops early reads INCOMPLETE, never green.
	@bash scripts/gate-witness.sh run GATE-RUN.txt "identuum-ui make verify" \
		'tool-versions=$(MAKE) --no-print-directory tool-versions' \
		'wiki-fresh=$(MAKE) --no-print-directory wiki-fresh' \
		'image-base-check=$(MAKE) --no-print-directory image-base-check' \
		'image-base-parity=$(MAKE) --no-print-directory image-base-parity' \
		'tracked-binary-check=$(MAKE) --no-print-directory tracked-binary-check' \
		'credential-transparency=$(MAKE) --no-print-directory credential-transparency' \
		'rulefloor=pnpm rulefloor' \
		'biome=pnpm exec biome check . --reporter=json --max-diagnostics=none' \
		'tsc=pnpm exec tsc --noEmit' \
		'vitest=pnpm exec vitest run'

## image-base-check: fail if any Dockerfile builds FROM an Alpine base.
##
## IMG-NONALPINE (owner decision 2026-07-31): every image WE build must be
## musl-free. Ported here 2026-08-02 (IMG-GATE-4) BYTE-IDENTICAL to the copy in
## identuum-idp-oss, identuum-idp-ce and identuum-ag-ce — FOUR copies, held
## identical by `image-base-parity` below, which pins their shared md5 and fails
## this repo if its copy drifts by one character. identuum-ag-oss is deliberately
## absent from the four: it ships NO Dockerfile, so it has nothing to gate and
## the missing target there is correct, not an oversight.
##
## THIS REPO COMPLIES TODAY and the gate is still worth having: `Dockerfile` and
## `setup/Dockerfile` are both node:22-bookworm-slim. This repo PUBLISHES an
## image (publish-image.yml) and had no gate at all, so nothing but review stood
## between a `node:22-alpine` edit and a musl image on the registry.
##
## `.next/` is gitignored build output and is NOT scanned: the find below walks
## the working tree, and a stray Dockerfile under a build directory is not
## something this policy governs.
image-base-check:
	@out="$$(find . -name 'Dockerfile*' -not -path './.git/*' -not -path './vendor/*' -exec awk 'FNR==1{delete A} /^ARG[ \t]+[A-Za-z_][A-Za-z0-9_]*=/{s=$$0;sub(/^ARG[ \t]+/,"",s);p=index(s,"=");n=substr(s,1,p-1);v=substr(s,p+1);sub(/[ \t].*$$/,"",v);gsub(/^"|"$$/,"",v);A[n]=v;if(v~/alpine/){printf "%s:%d: ARG default is an Alpine base: %s\n",FILENAME,FNR,$$0}} /^FROM[ \t]/{r=$$0;for(i=0;i<10;i++){ch=0;for(n in A)if(index(r,"$${" n "}")>0){gsub("[$$][{]" n "[}]",A[n],r);ch=1}if(!ch)break}if(r~/alpine/){printf "%s:%d: FROM resolves to an Alpine base: %s\n",FILENAME,FNR,$$0}else if(r~/[$$]/){printf "%s:%d: FROM has an UNRESOLVED variable, no ARG default in this file - failing loud: %s\n",FILENAME,FNR,$$0}}' {} + 2>/dev/null || true)"; \
	if [ -n "$$out" ]; then \
		echo "ALPINE BASE IMAGE FOUND (IMG-NONALPINE):"; \
		echo "$$out"; \
		echo "Every image we build must be musl-free. The Postgres SERVICE image is exempt and belongs in compose, not in a Dockerfile."; \
		exit 1; \
	fi


## image-base-parity: the copies check THEMSELVES.
##
## `image-base-check` above is maintained byte-identical in FOUR repos —
## identuum-idp-oss, identuum-idp-ce, identuum-ag-ce and identuum-ui. Until
## 2026-08-02 that was a claim in a comment and nothing verified it, which is
## the same shape as every CLEAN-that-measured-nothing this workspace has
## found: a policy stated in prose, enforced by hope.
##
## HOW IT IS ENFORCED WITHOUT SIBLING CHECKOUTS. A cross-repo diff cannot run
## in CI — each job checks out ONE repo. So the four do not compare themselves
## to each other; they each compare their own copy to an AGREED DIGEST, pinned
## below. Editing any copy by one character changes that copy's digest and
## turns THAT repo red, in CI and locally, with no sibling required. Four
## repos agreeing with one constant is equivalent to four repos agreeing with
## each other, and it is checkable from a single checkout.
##
## THE UNIT IS EXACT: from `image-base-check:` through its closing `fi`, plus
## the blank line that terminates the recipe — 9 lines. The blank line is IN
## the hash deliberately, because a recipe that swallows the following line is
## a real defect and would otherwise hash the same. Note the `printf '%s\n\n'`
## below: command substitution strips ALL trailing newlines, so the 9th line has
## to be put back or this target hashes 8 lines and is red forever. It was, on
## first run, in all four repos at once.
##
## CHANGING THE GATE ON PURPOSE: edit one copy, run `make image-base-parity`
## to read the new digest out of the failure message, update IMAGE_BASE_MD5 in
## all four, and copy the block to all four. The target tells you the value it
## wanted and the value it got, so the update is mechanical.
IMAGE_BASE_MD5 ?= 771f2aed39cca106ecdaf4f283ec1007

image-base-parity:
	@blk="$$(awk '/^image-base-check:/{f=1} f{print; if(f&&/^\tfi$$/){getline; print; exit}}' Makefile)"; \
	got="$$(printf '%s\n\n' "$$blk" | { md5sum 2>/dev/null || md5; } | awk '{print $$1}')"; \
	if [ "$$got" != "$(IMAGE_BASE_MD5)" ]; then \
		echo "IMAGE-BASE-CHECK COPY HAS DIVERGED (IMG-GATE-4):"; \
		echo "  wanted md5 $(IMAGE_BASE_MD5)"; \
		echo "  got    md5 $$got"; \
		echo "This repo's image-base-check no longer matches the copy shared with identuum-idp-oss, identuum-idp-ce, identuum-ag-ce and identuum-ui."; \
		echo "Either restore this copy, or update the block AND IMAGE_BASE_MD5 in all four."; \
		exit 1; \
	fi

## verify-ui-oss-contract: Playwright spec that validates the OSS
## scaffold runtime contract (e2e/oss-contract.spec.ts).
##
## Run this target against an OSS `--gin-serve` runtime — typically
## the local `identuum-idp-oss` container on 127.0.0.1:7113 brought up
## via `identuum-idp-oss/Makefile`'s dev-up target. The spec asserts
## the four positive scaffold endpoints (/health,
## /.well-known/openid-configuration, /.well-known/jwks.json) and the
## two negative pins (/authorize NOT 200, /token NOT 200). It does
## NOT require .env.playwright.idp-oss.local credentials.
##
## Override IDENTUUM_IDP_BASE_URL to point at a non-default IDP host.
verify-ui-oss-contract:
	IDENTUUM_IDP_BASE_URL="$${IDENTUUM_IDP_BASE_URL:-http://localhost:7113}" \
		npx playwright test e2e/oss-contract.spec.ts --reporter=list

## verify-ui-ce-auth: Playwright specs that require a CE / full-auth
## IDP runtime (login, MFA, sessions, /authorize, /token, admin UI,
## setup/upgrade wizards, license).
##
## Run this target against a CE appliance runtime — NOT against the
## OSS `--gin-serve` scaffold, which has no /authorize or /token.
## Authenticated specs self-skip when IDENTUUM_TEST_SITE_ADMIN_PASSWORD
## (and friends) are unset; .env.playwright.idp-oss.local supplies the
## credentials in normal operator workflows.
##
## The CE auth target deliberately EXCLUDES e2e/oss-contract.spec.ts
## (covered by verify-ui-oss-contract) and the opt-in live upgrade
## backup spec (covered by verify-live-upgrade-backup).
verify-ui-ce-auth:
	npx playwright test e2e/ \
		--ignore-snapshots \
		--reporter=list \
		--grep-invert "OSS scaffold contract"

## verify-ui-ce-customer-smoke: Playwright regression for the IDP CE
## customer-smoke M2 license-status verification path.
##
## Stable wrapper around `pnpm e2e:ce-customer-smoke` (the canonical
## script defined in package.json — single source of truth for the
## env-var defaults). Delegates rather than duplicating the env-var
## expansion so the script stays the only place those defaults are
## declared.
##
## Targets the customer-smoke stack: CE IDP backend on
## 127.0.0.1:7123 and bundled UI on 127.0.0.1:7124. Group 1 (3 no-
## secret backend agreement tests on /api/setup/license +
## /api/v1/component + invariant #12) runs unconditionally when the
## stack is reachable. Group 2 (1 authenticated UI render assertion
## on /site-admin/settings) gates on the operator's gitignored
## .env.playwright.idp-ce.local carrying customer-smoke
## site_admin credentials; the spec auto-loads the overlay file via
## the IDENTUUM_E2E_CE_CUSTOMER_SMOKE=1 flag that the pnpm script
## sets, and the overlay's keys win over the dev-stack file by
## default for this command.
##
## Operator workflow (one-time setup):
##   cp .env.playwright.idp-ce.local.example \
##      .env.playwright.idp-ce.local
##   # Edit the new file with credentials matching the customer-smoke
##   # site_admin row chosen at the M1 setup wizard. The file is
##   # gitignored via .env*.local. NEVER commit. NEVER paste.
##
## On every subsequent run:
##   make verify-ui-ce-customer-smoke
##
## Expected result against the prepared customer-smoke stack with
## matching operator credentials: 4 passed (~5s first run, ~0.5s
## subsequent runs via the session-restore fast path).
verify-ui-ce-customer-smoke:
	pnpm e2e:ce-customer-smoke

## verify-ui-ce-customer-smoke-passkey: Playwright WebAuthn passkey
## ceremony E2E against the prepared CE customer-smoke stack.
##
## Stable wrapper around `pnpm e2e:ce-customer-smoke-passkey` (the
## canonical script in package.json — single source of truth for the
## env-var defaults). Delegates rather than duplicating the env-var
## expansion so the script stays the only place those defaults are
## declared. Landed by agent-a-20260627 after a direct
## `npx playwright test e2e/passkey-flow.spec.ts` defaulted to
## http://localhost:7114/login (the dev stack) and hit
## net::ERR_CONNECTION_REFUSED — the operator must use this Make
## target so the runtime is correctly pinned to the customer-smoke
## stack.
##
## Targets the customer-smoke stack: CE IDP backend on
## 127.0.0.1:7123, bundled UI + WebAuthn RP origin on
## 127.0.0.1:7124. Uses the existing CDP virtual authenticator
## machinery in `e2e/passkey-flow.spec.ts` (5 tests: T1 clean slate;
## T2 register passkey; T3 list it; T4 log in via Login page passkey
## path; T5 delete it).
##
## Prereqs:
##   1. `cd ../identuum-idp-ce && make customer-smoke-up` first.
##   2. M1 setup wizard + M2 license envelope upload completed.
##   3. .env.playwright.idp-ce.local present with
##      IDENTUUM_E2E_TEST_EMAIL + IDENTUUM_E2E_TEST_PASSWORD set to
##      the customer-smoke site_admin credentials. The file is
##      gitignored via .env*.local. NEVER commit. NEVER paste.
##
## Operator workflow:
##   make verify-ui-ce-customer-smoke-passkey
##
## Expected: 5 passed on Chromium against the customer-smoke stack.
## Most likely failure modes: missing runtime (customer-smoke not up
## → ERR_CONNECTION_REFUSED), missing credentials
## (.env.playwright.idp-ce.local absent → auth helper SKIP), or RP ID /
## origin mismatch (IDP issuer ≠ UI origin hostname).
verify-ui-ce-customer-smoke-passkey:
	pnpm e2e:ce-customer-smoke-passkey

## verify-ui-oss-customer-smoke-passkey: Playwright WebAuthn passkey
## ceremony E2E (e2e/passkey-flow.spec.ts) against the IDP OSS dev
## runtime on 127.0.0.1:7113 plus the UI dev server on 127.0.0.1:7114.
## Closes the OSS-side passkey/customer-smoke runtime parity gap left
## after the IDP OSS verification-floor closure
## (see wiki/repos/identuum-idp-oss.md §"OSS passkey runtime parity").
##
## Stable wrapper around `pnpm e2e:oss-customer-smoke-passkey` (the
## canonical script in package.json — single source of truth for the
## env-var defaults). Delegates rather than duplicating the env-var
## block; overrides via IDP_BASE_URL / IDENTUUM_E2E_BASE_URL /
## WEBAUTHN_UI_BASE_URL still flow through unchanged.
##
## Operator preconditions:
##   1. IDP OSS dev runtime up on 127.0.0.1:7113 (typically via
##      `cd ../identuum-idp-oss && make dev-up` or `make oss-up`).
##   2. UI dev server reachable on http://localhost:7114 — either via
##      the docker-compose UI container on 7114 or a manual `pnpm dev`.
##      Playwright's webServer auto-spawn handles the bring-up when
##      port 7104 is used; for the OSS smoke the operator should
##      ensure the 7114-bound UI is reachable so the WebAuthn RP
##      origin matches the IDP issuer host.
##   3. .env.playwright.oss.local present with the OSS site_admin
##      credentials (IDENTUUM_TEST_SITE_ADMIN_EMAIL / _PASSWORD /
##      _TOTP_SECRET if MFA was enrolled; loginAsSiteAdminMFAOptional
##      tolerates absent MFA). The file is gitignored via .env*.local.
##      NEVER commit. NEVER paste.
##
## Operator workflow:
##   make verify-ui-oss-customer-smoke-passkey
##
## Expected: 5 passed on Chromium against the OSS dev stack
## (matches the CE customer-smoke 5/5 passkey green-bar).
## Most likely failure modes: missing OSS runtime
## (ERR_CONNECTION_REFUSED on 7113), missing UI on 7114
## (WebAuthn origin mismatch — go-webauthn rejects FINISH), missing
## credentials (.env.playwright.oss.local absent → auth helper SKIP).
verify-ui-oss-customer-smoke-passkey:
	pnpm e2e:oss-customer-smoke-passkey

## verify-ui-ce-fresh-m1-setup: Playwright spec that drives a fresh
## first-run CE setup wizard end-to-end against the isolated
## identuum-idp-ce-m1-fresh compose project (host ports 7125 IDP +
## 7126 UI). Proves D-IDP-INSTALL-26 — first-run setup MUST enroll
## site_admin TOTP before setup_complete — against a TRULY fresh CE
## stack, not against the standing customer-smoke project's existing
## setup_complete state.
##
## Operator workflow (3 commands):
##   1. cd ../identuum-idp-ce && make m1-fresh-up
##   2. cd ../identuum-ui     && make verify-ui-ce-fresh-m1-setup
##   3. cd ../identuum-idp-ce && make m1-fresh-clean
##
## The fresh stack is ENTIRELY isolated from the standing
## identuum-idp-ce-customer-smoke project: different container names,
## different host ports, different docker volumes, different docker
## networks. The customer-smoke 5/5 passkey + 107/0/0 quick +
## 118/0/0 integration green-bar is preserved by this validation.
##
## Landed by agent-a-20260627-idp-ce-fresh-setup-m1-totp-e2e-validation.
verify-ui-ce-fresh-m1-setup:
	pnpm e2e:ce-fresh-m1-setup

## verify-ui-ce-fresh-m1-setup-licensed: same as
## verify-ui-ce-fresh-m1-setup but additionally drives the positive
## T2 wizard happy path by reading a smoke license envelope from the
## operator-supplied (or default) path and pasting it into the
## wizard's license-step. The license envelope contents are read by
## the spec in Playwright process memory only — never written to disk
## by the spec, never logged, never asserted by value, never echoed
## to the reporter.
##
## Operator workflow (5 commands):
##   1. IDENTUUM_CE_SMOKE_LICENSE_PRIVATE_KEY=<key> \
##      make -C ../identuum-idp-ce customer-smoke-license   # generate envelope
##   2. make -C ../identuum-idp-ce m1-fresh-up               # bring up fresh stack
##   3. make -C ../identuum-idp-ce m1-fresh-license-check    # safe verify envelope
##   4. make verify-ui-ce-fresh-m1-setup-licensed            # drive full wizard
##   5. make -C ../identuum-idp-ce m1-fresh-clean            # teardown
##
## The licensed target sets:
##   IDENTUUM_E2E_M1_FRESH_LICENSE_READY=1                   # gates T2
##   IDENTUUM_CE_SMOKE_LICENSE_PATH=<envelope path>          # spec reads this
##
## Override IDENTUUM_CE_SMOKE_LICENSE_PATH if the envelope lives
## elsewhere; default uses IDENTUUM_CE_SMOKE_LICENSE_OUTPUT_PATH when
## set, otherwise /tmp/ce-customer-smoke.lic.
##
## Landed by agent-a-20260627-idp-ce-fresh-m1-license-prep-positive-wizard-e2e.
verify-ui-ce-fresh-m1-setup-licensed:
	IDENTUUM_E2E_M1_FRESH_LICENSE_READY=1 \
		IDENTUUM_CE_SMOKE_LICENSE_PATH="$${IDENTUUM_CE_SMOKE_LICENSE_PATH:-$${IDENTUUM_CE_SMOKE_LICENSE_OUTPUT_PATH:-/tmp/ce-customer-smoke.lic}}" \
		pnpm e2e:ce-fresh-m1-setup

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

## oss-smoke-up: bring up the OSS customer-smoke UI container (host 127.0.0.1:7114
## -> container 7104) pointing at the OSS IDP backend on 127.0.0.1:7113, via the
## `oss-smoke` compose profile. The bare standalone identuum-ui on 7104 (started by
## `make dev-up`) and the CE UI on 7124 are left untouched. This is the managed
## target the OSS passkey smoke runs against — no manually started UI process.
oss-smoke-up:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile oss-smoke up -d identuum-ui-oss-smoke

## oss-smoke-down: stop and remove the OSS customer-smoke UI container only.
oss-smoke-down:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile oss-smoke rm -f -s identuum-ui-oss-smoke

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
# These targets recreate identuum-ui (the container; pre-2026-06-15 named identuum-ui-app) pointed at the AG OSS host
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
