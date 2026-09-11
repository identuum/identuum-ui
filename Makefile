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

.PHONY: verify tool-versions wiki-fresh dev-up dev-rebuild dev-recreate dev-ps dev-logs dev-down dev-smoke dev-health dev-smoke-runtime image-base-check image-base-parity tracked-binary-check credential-transparency frozen-lockfile advisory ci-witness ci-fetch toolchain-parity grype-scan ledger-diff-gate ledger-rebase workflow-yaml workflow-yaml-parity
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

## workflow-yaml: every .github/workflows/*.yml must PARSE as YAML, or the
## workflow GitHub would run never starts and every gate it declares is a
## claim. THE-UI-YAML-LINE-111 (2026-09-06): the pnpm-install-tool step
## THE-UI-NODE-26-LATEST wrote carried a colon-space inside a plain scalar —
## invalid YAML — and survived a green verify, a green mint and four new gates
## in one day, because nothing in this plan parsed the workflows; the
## byte-scanning route gate passed it, GitHub would have refused it. The
## parser is yq (mikefarah, Go yaml.v3 — the same parser family the
## workspace's achta uses); the file is read whole (`yq eval '.'`), the
## scanner's own error is printed verbatim, and an absent yq is exit 2 by
## name, never a silent pass. Sits after credential-transparency, before the
## pnpm gates: a workflow that cannot parse is a repo-hygiene fact, cheap
## and early. In CI too (THE-CI-PARSES-ITS-OWN-WORKFLOWS, 2026-09-06): ci.yml
## installs yq from a sha256-pinned release binary at the workflow-env
## YQ_VERSION and runs this target and its parity as recorded steps, and
## toolchain-parity holds that pin equal to the yq installed here. CI cannot
## save ci.yml from itself — a ci.yml GitHub cannot parse never starts the
## job — so the local run catches THIS file, CI every other workflow.
workflow-yaml:
	@command -v yq >/dev/null 2>&1 || { echo "workflow-yaml: yq is not installed — cannot parse .github/workflows/*.yml; refusing to pass silently" >&2; exit 2; }; \
	bad=0; n=0; \
	for f in .github/workflows/*.yml .github/workflows/*.yaml; do \
		[ -f "$$f" ] || continue; n=$$((n+1)); \
		if out=$$(yq eval '.' "$$f" 2>&1 >/dev/null); then \
			echo "  parses   $$f"; \
		else \
			echo "  INVALID  $$f"; printf '%s\n' "$$out" | sed 's/^/           /'; bad=1; \
		fi; \
	done; \
	[ "$$n" -gt 0 ] || { echo "workflow-yaml: no workflow files under .github/workflows — nothing to parse" >&2; exit 2; }; \
	if [ "$$bad" -ne 0 ]; then \
		echo "check FAILED: workflow-yaml — a workflow GitHub cannot parse never runs; fix the file, never the gate"; \
		exit 1; \
	fi; \
	echo "check OK: workflow-yaml $$n workflow file(s) parse (yq $$(yq --version 2>/dev/null | grep -oE 'v[0-9.]+' | head -1))"

## workflow-yaml-parity: this repo's workflow-yaml block must equal the copy
## shared with identuum-idp-oss, byte for byte — the image-base-parity
## discipline above: a copy that drifts to a laxer parser accepts what GitHub
## rejects, which is worse than no gate. THE-UI-WORKFLOW-YAML-PARITY
## (2026-09-06): idp-oss carried this pin first and this repo did not, so an
## edit HERE turned idp-oss red while this repo stayed green — the alarm
## pointed at the repo that had not changed. Both sides now carry the same
## constant. The unit is the target line through the `check OK` line, hashed
## as extracted (no trailing blank line, unlike image-base-parity: this block
## ends in an echo, not a `fi`). CHANGING THE GATE ON PURPOSE: edit one copy,
## read the new digest out of this target's failure, update the block AND
## WORKFLOW_YAML_MD5 in every copy.
WORKFLOW_YAML_MD5 ?= d63f3fdb5cd211c38abe98a03ecb1544

workflow-yaml-parity:
	@blk="$$(awk '/^workflow-yaml:/{f=1} f{print} f&&/check OK: workflow-yaml/{exit}' Makefile)"; \
	got="$$(printf '%s\n' "$$blk" | { md5sum 2>/dev/null || md5; } | awk '{print $$1}')"; \
	if [ "$$got" != "$(WORKFLOW_YAML_MD5)" ]; then \
		echo "WORKFLOW-YAML COPY HAS DIVERGED:"; \
		echo "  wanted md5 $(WORKFLOW_YAML_MD5)"; \
		echo "  got    md5 $$got"; \
		echo "This repo's workflow-yaml no longer matches the copy shared with identuum-idp-oss."; \
		echo "Either restore this copy, or update the block AND WORKFLOW_YAML_MD5 in every copy."; \
		exit 1; \
	fi; \
	echo "check OK: workflow-yaml-parity block md5 $$got matches the shared pin"

## frozen-lockfile: package.json and pnpm-lock.yaml must agree, exactly as CI
## demands. ci.yml's "Install dependencies (frozen lockfile)" step runs
## `pnpm install --frozen-lockfile`, which fails the run when the lockfile is
## out of date with the manifest; until THE-UI-GATE-PARITY (2026-09-06) local
## verify never proved that, so a hand edit to package.json could pass every
## local gate and fail only in CI. The command here is CI's exact one, so
## local proves what CI assumes (the go-mod-tidy-diff analogue). On a green
## tree it prints "Already up to date". pnpm absent: exit 2 by name, never a
## silent pass.
frozen-lockfile:
	@command -v pnpm >/dev/null 2>&1 || { echo "frozen-lockfile: pnpm is not installed — cannot prove package.json and pnpm-lock.yaml agree (CI installs with --frozen-lockfile); refusing to pass silently" >&2; exit 2; }; \
	pnpm install --frozen-lockfile

## advisory: the govulncheck analogue — `pnpm audit` resolves every package in
## pnpm-lock.yaml against the registry's advisory database and exits non-zero
## on any known vulnerability, any severity (no --audit-level floor: the
## strictest reading, and the one a later slice may only tighten). Until
## THE-UI-GATE-PARITY (2026-09-06) the audit was run by hand and never by
## verify, so a published advisory could sit in the lockfile across slices
## with every gate green. A registry that cannot be reached is an error, not
## a pass. pnpm absent: exit 2 by name, never a silent pass.
advisory:
	@command -v pnpm >/dev/null 2>&1 || { echo "advisory: pnpm is not installed — cannot audit pnpm-lock.yaml against the advisory database; refusing to pass silently" >&2; exit 2; }; \
	pnpm audit

## The idp-oss sibling holds the Go judges these gates reuse (tools/ci-witness,
## tools/ledger-diff-gate, tools/grype-gate). This repo is not a Go module, so
## `go run -C $(IDP_OSS_DIR) ./tools/<judge> --repo $(CURDIR)` runs the sibling's
## tool against THIS tree, read-only for the sibling. An absent sibling or an
## absent Go toolchain is exit 2 by name, never a silent pass (the same
## sibling-coupled shape as wiki-fresh, with the loud branch this slice's owner
## ruled for absent tools). THE-UI-GATE-PARITY-2, 2026-09-06.
IDP_OSS_DIR ?= ../identuum-idp-oss

## ci-witness: judge the CI record a human fetched and COMMITTED here as
## CI-WITNESS.txt. What CI uploads today (ci.yml): per matrix job an artifact
## gate-run-ci-node<22|24> holding GATE-RUN.ci.txt, finalized with
## GATE_WITNESS_TIE=commit and, since this slice, a `ci-run:` provenance line
## only the workflow writes. The judge (idp-oss tools/ci-witness, rule
## CI-RECORD-HONEST-1) fetches nothing: absent, or present but UNTRACKED, it
## reports NO CLAIM and passes — absence is honest; committed, the record must
## carry provenance, tie by commit (not digest), be finalized clean, green,
## complete, and name a commit on HEAD's ancestry. Being behind HEAD is
## reported, never failed. Fetch with `make ci-fetch RUN=<id> [NODE=22]`.
ci-witness:
	@command -v go >/dev/null 2>&1 || { echo "ci-witness: go is not installed — the judge is a Go tool in $(IDP_OSS_DIR)/tools/ci-witness; refusing to pass silently" >&2; exit 2; }; \
	test -d "$(IDP_OSS_DIR)/tools/ci-witness" || { echo "ci-witness: sibling judge absent at $(IDP_OSS_DIR)/tools/ci-witness — refusing to pass silently" >&2; exit 2; }; \
	go run -C "$(IDP_OSS_DIR)" ./tools/ci-witness --repo "$(CURDIR)"

## ci-fetch: the OPERATOR step — download one NAMED CI run's record so
## ci-witness has something to judge. Not part of verify (a gate must not reach
## the network). RUN=<id> is required: a record fetched from "whatever is
## newest" is a record nobody chose. NODE picks the matrix job's artifact
## (default 22, the runtime the image ships). Read what came back, then commit
## it; only then does ci-witness see a claim.
## THE-UI-AUDIT-IN-CI (2026-09-09): the NODE default follows ci.yml's matrix
## instead of a literal. The literal said 22 after the matrix had moved to
## ['26'] (THE-NODE-26 move), so a bare `make ci-fetch RUN=<id>` asked for
## gate-run-ci-node22, an artifact no run produces. yq reads the first matrix
## entry (toolchain-parity already requires yq); an explicit NODE=<major>
## still wins; an unreadable matrix refuses by name rather than guessing.
CI_MATRIX_NODE := $(shell yq '.jobs.build-and-test.strategy.matrix.node[0]' .github/workflows/ci.yml 2>/dev/null)
ci-fetch:
	@if [ -z "$(RUN)" ]; then \
		echo "ci-fetch: name the run — make ci-fetch RUN=<id> [NODE=<major>; default: ci.yml's matrix, currently $(CI_MATRIX_NODE)]"; \
		echo "ci-fetch: refusing to fetch 'whatever is newest'; a record nobody chose witnesses nothing."; \
		echo "ci-fetch: list them with: gh run list"; \
		exit 1; \
	fi
	@if [ -z "$(or $(NODE),$(CI_MATRIX_NODE))" ]; then \
		echo "ci-fetch: cannot read the matrix node from .github/workflows/ci.yml (yq missing or the matrix moved) — pass NODE=<major>"; \
		exit 2; \
	fi
	@rm -rf .ci-fetch && mkdir -p .ci-fetch
	gh run download $(RUN) -n gate-run-ci-node$(or $(NODE),$(CI_MATRIX_NODE)) -D .ci-fetch
	@cp .ci-fetch/GATE-RUN.ci.txt CI-WITNESS.txt && rm -rf .ci-fetch
	@echo "ci-fetch: wrote CI-WITNESS.txt from run $(RUN) (node $(or $(NODE),$(CI_MATRIX_NODE))) — READ IT, then commit it."
	@$(MAKE) --no-print-directory ci-witness || true

## toolchain-parity: the toolchain this tree declares in four places must AGREE
## with each other and with the machine running verify (the idp-oss shape,
## rule CI-LOCAL-PARITY-1; THE-UI-GATE-PARITY-2, 2026-09-06). The idp-oss judge
## reads Go pins, so this repo carries its own comparisons as a recipe — ten
## rules, eleven pins (rule 9 holds two digests):
##   1. every Dockerfile FROM node:<major> AND every `# node-major=<N>`
##      annotation (the digest-pinned runner carries no version text; the
##      annotation is measured at pin time and re-measured at every bump)
##      name ONE major;
##   2. that major is in ci.yml's matrix.node;
##   3. package.json engines.node floor has that major;
##   4. @types/node has that major (dependencyNotes: types track the engines
##      floor, never the newest local runtime);
##   5. the local node major is in the CI matrix (you test what CI tests);
##   6. local pnpm equals package.json packageManager (corepack pins CI to it);
##   7. ci.yml GO_VERSION equals the local go;
##   8. ci.yml RULEFLOOR_VERSION equals the local rulefloor;
##   9. ci.yml GATE_WITNESS_SHA256 and RULEFLOOR_GATE_SHA256 equal the sha256
##      of the vendored scripts CI verifies with `sha256sum -c`;
##  10. every `pnpm@<version>` the Dockerfile installs equals packageManager
##      (THE-UI-NODE-26-LATEST: node 26 ships no corepack, so the build
##      stages install pnpm from npm by an explicit version);
##  11. ci.yml YQ_VERSION equals the local yq (THE-CI-PARSES-ITS-OWN-WORKFLOWS,
##      2026-09-06: CI now installs yq from a sha256-pinned release binary so
##      the workflow-yaml gate runs there too; two declarations, one pin).
## Measured at landing (2026-09-06, ten pins): image 22 in matrix 22/24,
## engines and @types/node 22, local node 24 in the matrix, pnpm 11.3.0, go
## 1.27.1, rulefloor v0.9.1, both digests. A disagreement prints the pin and
## the two values and FAILS; an absent tool is exit 2 by name. Local grype is
## not a pin here: the ui CI installs no grype.
toolchain-parity:
	@for t in node pnpm go rulefloor yq shasum; do command -v "$$t" >/dev/null 2>&1 || { echo "toolchain-parity: $$t is not installed — cannot compare the pins; refusing to pass silently" >&2; exit 2; }; done; \
	bad=0; agree=0; \
	img=$$( { grep -E '^FROM node:' Dockerfile | sed -E 's/^FROM node:([0-9]+).*/\1/'; grep -E '^# node-major=[0-9]+' Dockerfile | sed -E 's/^# node-major=([0-9]+).*/\1/'; } | sort -u | tr '\n' ' ' | sed 's/ $$//'); \
	case "$$img" in *" "*|"") echo "  DISAGREE  Dockerfile node majors (FROM node:<N> lines and # node-major=<N> annotations): '$$img' — every stage must name one major"; bad=1;; *) agree=$$((agree+1));; esac; \
	matrix=$$(grep -E '^[[:space:]]+node: \[' .github/workflows/ci.yml | head -1 | grep -oE '[0-9]+' | tr '\n' ' '); \
	case " $$matrix" in *" $$img "*) agree=$$((agree+1));; *) echo "  DISAGREE  Dockerfile node $$img is not in ci.yml matrix.node [$$matrix]"; bad=1;; esac; \
	eng=$$(node -p "require('./package.json').engines.node" | sed -E 's/^[^0-9]*([0-9]+).*/\1/'); \
	[ "$$eng" = "$$img" ] && agree=$$((agree+1)) || { echo "  DISAGREE  engines.node floor major $$eng vs Dockerfile node $$img"; bad=1; }; \
	types=$$(node -p "require('./package.json').devDependencies['@types/node']" | sed -E 's/^[^0-9]*([0-9]+).*/\1/'); \
	[ "$$types" = "$$img" ] && agree=$$((agree+1)) || { echo "  DISAGREE  @types/node major $$types vs Dockerfile node $$img"; bad=1; }; \
	lnode=$$(node --version | sed -E 's/^v([0-9]+).*/\1/'); \
	case " $$matrix" in *" $$lnode "*) agree=$$((agree+1));; *) echo "  DISAGREE  local node major $$lnode is not in ci.yml matrix.node [$$matrix]"; bad=1;; esac; \
	pm=$$(node -p "require('./package.json').packageManager"); lpnpm=$$(pnpm --version); \
	[ "$$pm" = "pnpm@$$lpnpm" ] && agree=$$((agree+1)) || { echo "  DISAGREE  packageManager $$pm vs local pnpm $$lpnpm"; bad=1; }; \
	dpnpm=$$(grep -oE 'pnpm@[0-9][0-9.]*' Dockerfile | sort -u | tr '\n' ' ' | sed 's/ $$//'); \
	[ "$$dpnpm" = "$$pm" ] && agree=$$((agree+1)) || { echo "  DISAGREE  Dockerfile installs '$$dpnpm' vs packageManager $$pm"; bad=1; }; \
	cigo=$$(grep -E '^[[:space:]]+GO_VERSION:' .github/workflows/ci.yml | head -1 | sed -E 's/.*GO_VERSION:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/'); lgo=$$(go version | awk '{print $$3}' | sed 's/^go//'); \
	[ "$$cigo" = "$$lgo" ] && agree=$$((agree+1)) || { echo "  DISAGREE  ci.yml GO_VERSION $$cigo vs local go $$lgo"; bad=1; }; \
	cirf=$$(grep -E '^[[:space:]]+RULEFLOOR_VERSION:' .github/workflows/ci.yml | head -1 | sed -E 's/.*RULEFLOOR_VERSION:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/'); lrf=$$(rulefloor version --json | sed -E 's/.*"version":"([^"]+)".*/\1/'); \
	[ "$$cirf" = "$$lrf" ] && agree=$$((agree+1)) || { echo "  DISAGREE  ci.yml RULEFLOOR_VERSION $$cirf vs local rulefloor $$lrf"; bad=1; }; \
	ciyq=$$(grep -E '^[[:space:]]+YQ_VERSION:' .github/workflows/ci.yml | head -1 | sed -E 's/.*YQ_VERSION:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/'); lyq=$$(yq --version | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1); \
	[ -n "$$ciyq" ] && [ "$$ciyq" = "$$lyq" ] && agree=$$((agree+1)) || { echo "  DISAGREE  ci.yml YQ_VERSION '$$ciyq' vs local yq '$$lyq'"; bad=1; }; \
	for pair in GATE_WITNESS_SHA256=scripts/gate-witness.sh RULEFLOOR_GATE_SHA256=scripts/rulefloor-install-gate.sh; do \
		key=$${pair%%=*}; file=$${pair#*=}; \
		pin=$$(grep -E "^[[:space:]]+$$key:" .github/workflows/ci.yml | head -1 | sed -E 's/.*:[[:space:]]*"?([0-9a-f]{64})"?.*/\1/'); \
		have=$$(shasum -a 256 "$$file" | awk '{print $$1}'); \
		[ "$$pin" = "$$have" ] && agree=$$((agree+1)) || { echo "  DISAGREE  ci.yml $$key $$(printf '%.12s' "$$pin")… vs sha256($$file) $$(printf '%.12s' "$$have")…"; bad=1; }; \
	done; \
	if [ "$$bad" -ne 0 ]; then \
		echo "check FAILED: toolchain-parity — the pins above disagree; align the declaration or the machine, never the gate"; \
		exit 1; \
	fi; \
	echo "check OK: toolchain-parity $$agree pins agree (node $$img in matrix [$$matrix], engines/@types/node $$eng/$$types, local node $$lnode, pnpm $$lpnpm, go $$lgo, rulefloor $$lrf, yq $$lyq, both vendored digests)"

## grype-scan: the published image, judged by the idp-oss policy (tools/grype-gate,
## rule GRYPE-FIXABLE-FAILS-1): a finding with an AVAILABLE FIX fails, a
## High/Critical finding fails whether or not a fix exists, an allowlist entry
## (grype-allowlist.json, absent today = empty) needs a reason AND a ruling and
## can excuse "you have not taken the fix", never severity. Builds
## identuum-ui:verify from the repo-root Dockerfile (the tag publish-image.yml
## builds), scans it through the docker context's endpoint (grype does not read
## `docker context`; on this machine the socket is colima's, not
## /var/run/docker.sock), and hands the JSON to the judge. Absent grype, docker,
## go or the sibling judge: exit 2 by name, never a silent pass. SCAN=<json>
## judges an existing report instead of building and scanning (the judge's own
## -scan mode; used for the mutation proofs).
##
## IN THE verify PLAN since THE-UI-NODE-26-LATEST (2026-09-06), right after
## ledger-diff-gate. History, so the reason it was ever outside stays
## readable: THE-UI-GATE-PARITY-2 landed this target but refused the plan
## entry on a finding — the node:22-bookworm-slim runner scanned to
## `check FAILED: grype-gate matches=211 fixable=1 severe=58`, 58 High/Critical
## CVEs in Debian 12 packages Debian marks not-fixed or wont-fix (util-linux
## and its libs, perl-base, libc6, ncurses, gzip, libacl1, libtasn1), so a
## plan entry would have frozen every ui close. THE-UI-BASE-IMAGE and
## THE-UI-NODE-26 measured five bases on this judge (node:22 fresh 230/69/20,
## distroless nodejs22-debian12 71/30/41, distroless nodejs22-debian13 20/4/0,
## chainguard node:latest-dev 3/2/0, chainguard node:latest 1/0/0); the owner
## ruled for the last, pinned by digest in the Dockerfile, and the entry went
## in only after `make grype-scan` was GREEN on that image. The policy was
## never weakened to fit an image.
grype-scan:
	@for t in grype docker go; do command -v "$$t" >/dev/null 2>&1 || { echo "grype-scan: $$t is not installed — cannot scan or judge the image; refusing to pass silently" >&2; exit 2; }; done; \
	test -d "$(IDP_OSS_DIR)/tools/grype-gate" || { echo "grype-scan: sibling judge absent at $(IDP_OSS_DIR)/tools/grype-gate — refusing to pass silently" >&2; exit 2; }; \
	if [ -n "$(SCAN)" ]; then \
		report="$(SCAN)"; tmp=""; \
	else \
		tmp=$$(mktemp -t ui-grype); report="$$tmp"; \
		docker build -q -t identuum-ui:verify . >/dev/null || { echo "grype-scan: docker build of identuum-ui:verify failed — nothing to judge" >&2; rm -f "$$tmp"; exit 2; }; \
		host=$$(docker context inspect --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null); \
		DOCKER_HOST="$${host:-$$DOCKER_HOST}" grype identuum-ui:verify -o json > "$$tmp" 2>/dev/null || { echo "grype-scan: grype could not scan identuum-ui:verify — nothing to judge" >&2; rm -f "$$tmp"; exit 2; }; \
	fi; \
	go run -C "$(IDP_OSS_DIR)" ./tools/grype-gate -scan "$$report" -allowlist "$(CURDIR)/grype-allowlist.json"; rc=$$?; \
	[ -z "$$tmp" ] || rm -f "$$tmp"; \
	exit $$rc

## ledger-diff-gate: a RULE-FLOOR.md sentence never changes silently again (the
## idp-oss shape, THE-LEDGER-DIFF-GATE, rule LEDGER-DIFF-RECONCILED-1; ported
## by THE-UI-GATE-PARITY-2, 2026-09-06). Why this floor needs it: 66 rules over
## 11 witnessed slices, every one of which may reword, rebind or re-prove a
## rule, and the `rulefloor` entry only re-hashes what is there — it cannot
## tell a declared change from a quiet one. The judge (idp-oss
## tools/ledger-diff-gate) runs `rulefloor ledger-diff --base <the newest
## "Witness: make verify green at" commit strictly before HEAD>` and reconciles
## it BOTH ways against the committed, SHA-scoped ledger-amendments.json
## (ledger-amendments.v1): an undeclared change, a declaration the diff does
## not show, a wrong base_commit, rulefloor exit 2 — every one FAILS. Sits
## right after rulefloor in the plan, as in idp-oss. go, rulefloor or the
## sibling judge absent: exit 2 by name.
##
## Cadence: `make ledger-rebase` at the FIRST commit after a witness (HEAD must
## not itself be the witness, or the base lands one witness too early); a
## consumed declaration is removed by hand once its witness exists.
ledger-diff-gate:
	@for t in go rulefloor; do command -v "$$t" >/dev/null 2>&1 || { echo "ledger-diff-gate: $$t is not installed — cannot reconcile the ledger; refusing to pass silently" >&2; exit 2; }; done; \
	test -d "$(IDP_OSS_DIR)/tools/ledger-diff-gate" || { echo "ledger-diff-gate: sibling judge absent at $(IDP_OSS_DIR)/tools/ledger-diff-gate — refusing to pass silently" >&2; exit 2; }; \
	go run -C "$(IDP_OSS_DIR)" ./tools/ledger-diff-gate --manifest "$(CURDIR)/ledger-amendments.json" --repo "$(CURDIR)" --rulefloor "$$(command -v rulefloor)"

ledger-rebase:
	@go run -C "$(IDP_OSS_DIR)" ./tools/ledger-diff-gate --rebase --manifest "$(CURDIR)/ledger-amendments.json" --repo "$(CURDIR)"

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
	@printf 'yq         %s  %s\n' "$$(yq --version 2>/dev/null | grep -oE 'v[0-9.]+' | head -1)" "$$(command -v yq || echo MISSING)"

## e2e-full: the DISPOSABLE full-behavior suite (THE-DISPOSABLE-HARNESS).
## DESTROYS the OSS dev stack's postgres volume, rebuilds the appliance from
## the sibling working tree, bootstraps a run-local site_admin, runs the
## e2e-full Playwright project serially (--workers=1, TOTP physics), then
## fast-cleans again. OPT-IN ONLY — never wired into verify, wiki make
## check, or CI: fired by accident it eats the local dev database.
e2e-full:
	@bash e2e-full/scripts/full-run.sh

## WHY wiki-fresh RUNS LAST (THE-SEVENTEEN-MASKED-TARGETS, 2026-09-11; the
## rule is THE-SEALED-GATES, identuum-idp-oss, 2026-08-04)
## --------------------------------------------------------------------
## wiki-fresh is SIBLING-COUPLED: its subject is the pin in ../wiki, not this
## tree, and it goes red for the entirely expected reason that a slice has
## just added commits here. gate-witness stops at the first red target, so
## every target placed BELOW it is silently unrun whenever the pin lags.
## Until 2026-09-11 it sat at position 2 of 19, and a pin one commit behind
## masked SEVENTEEN targets — image-base-check through ledger-diff-gate,
## grype-scan, biome, tsc and vitest: the whole lint and test suite under a
## documentation-freshness gate. Measured on the real plan that day: the
## record stopped at 2 of 19 (tool-versions, wiki-fresh exit=2). OSS learned
## the same lesson in THE-SEALED-GATES when commit 032737c landed with a
## non-compiling tree because verify stopped at wiki-fresh and never reached
## vet. A gate that judges THIS repository's code or dependencies must never
## run after one whose subject lives elsewhere, so wiki-fresh is the LAST
## plan entry, after vitest, with nothing below it. It stays fatal — nothing
## here is downgraded — it simply no longer masks what it is not about.
## No RULE-FLOOR row pins this order; this comment is its record.
verify:
	# THE-UNWITNESSED-GREEN: the same targets as before, driven through
	# scripts/gate-witness.sh so the run leaves a committed record
	# (GATE-RUN.txt): per-target exit codes, the tool versions, the tools'
	# own count lines, and a digest of the tree the run saw (minus the
	# record itself). A run that stops early reads INCOMPLETE, never green.
	@bash scripts/gate-witness.sh run GATE-RUN.txt "identuum-ui make verify" \
		'tool-versions=$(MAKE) --no-print-directory tool-versions' \
		'image-base-check=$(MAKE) --no-print-directory image-base-check' \
		'image-base-parity=$(MAKE) --no-print-directory image-base-parity' \
		'witness-parity=$(MAKE) --no-print-directory witness-parity' \
		'tracked-binary-check=$(MAKE) --no-print-directory tracked-binary-check' \
		'credential-transparency=$(MAKE) --no-print-directory credential-transparency' \
		'workflow-yaml=$(MAKE) --no-print-directory workflow-yaml' \
		'workflow-yaml-parity=$(MAKE) --no-print-directory workflow-yaml-parity' \
		'frozen-lockfile=$(MAKE) --no-print-directory frozen-lockfile' \
		'advisory=$(MAKE) --no-print-directory advisory' \
		'ci-witness=$(MAKE) --no-print-directory ci-witness' \
		'toolchain-parity=$(MAKE) --no-print-directory toolchain-parity' \
		'rulefloor=pnpm rulefloor' \
		'ledger-diff-gate=$(MAKE) --no-print-directory ledger-diff-gate' \
		'grype-scan=$(MAKE) --no-print-directory grype-scan' \
		'biome=pnpm exec biome check . --reporter=json --max-diagnostics=none' \
		'tsc=pnpm exec tsc --noEmit' \
		'vitest=pnpm exec vitest run' \
		'wiki-fresh=$(MAKE) --no-print-directory wiki-fresh'

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

.PHONY: witness witness-parity

## witness — THE ONLY WAY A WITNESS COMMIT IS MADE (THE-WITNESS-THAT-CANNOT-LIE,
## 2026-09-07). A witness made any other way is a defect.
##
## MEASURED, idp-oss reflog, 2026-09-07: `commit: Witness: make verify green at
## 64a71cb` then `reset: moving to HEAD~1`. A hand-typed chain committed a
## witness over a RED record because one `;` ended its `&&` guard; a read of
## the output caught it, not a gate. The witness is the one claim this
## workspace trusts, so it is made HERE, by a recipe that REFUSES unless every
## one of these holds, in this order:
##   1. the parts gate ran FIRST (../wiki/tools/parts-commit-gate.sh, fed a
##      PreToolUse payload naming this commit; IDENTUUM_TRANSCRIPT names the
##      harness transcript it reads, and without one it denies). A refusal
##      commits only under IDENTUUM_PARTS_BYPASS, and then the body quotes the
##      refusal and `achta parts verify`'s fact line — the bypass is on the
##      record, never silent;
##   2. GATE-RUN.txt exists and says `result: green`;
##   3. its `repo-head:` is a prefix of `git rev-parse HEAD` — a green record
##      for another head witnesses that head, not this one;
##   4. `scripts/gate-witness.sh check` accepts it: complete, no non-zero
##      exit, and its `tree:` digest equals the tree NOW (the record excluded);
##   5. nothing but GATE-RUN.txt is modified — a witness is record-only.
## Only then: `git add GATE-RUN.txt` and ONE commit with the canonical subject
## `Witness: make verify green at <short HEAD>`. Nothing else is staged, ever;
## the message is written by this recipe, never typed.
## The recipe exits 1 for a refusal the record explains and 2 when it cannot
## evaluate (no gate, no record). This block is byte-identical in
## identuum-idp-oss and identuum-ui and pinned by `witness-parity` below.
witness:
	@set -u; rec=GATE-RUN.txt; gate=../wiki/tools/parts-commit-gate.sh; \
	test -f "$$gate" || { echo "witness: REFUSED — $$gate is absent; the parts gate runs first or nothing commits"; exit 2; }; \
	payload=$$(printf '{"session_id":"make-witness","transcript_path":"%s","cwd":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -F witness-message","description":"make witness"}}' "$${IDENTUUM_TRANSCRIPT:-}" "$$PWD"); \
	verdict=$$(printf '%s' "$$payload" | bash "$$gate" 2>&1); grc=$$?; bypass=""; \
	if [ "$$grc" -ne 0 ]; then \
		why=$$(printf '%s\n' "$$verdict" | grep -m1 -E 'banner is at|attest|transcript|parts' || printf '%s\n' "$$verdict" | head -1); \
		if [ -z "$${IDENTUUM_PARTS_BYPASS:-}" ]; then echo "witness: REFUSED — the parts gate refused and no IDENTUUM_PARTS_BYPASS is declared:"; printf '%s\n' "$$verdict"; exit 2; fi; \
		wiki=$$(cd ../wiki && pwd -P); fact=$$(achta --wiki-dir "$$wiki" parts verify --dir "$$wiki/prompt/parts" --lock "$$wiki/prompt/parts.lock" 2>&1) || { echo "witness: REFUSED — achta parts verify failed: $$fact"; exit 2; }; \
		bypass=$$(printf 'BYPASS USED: IDENTUUM_PARTS_BYPASS (%s), the gate run first by make witness. What the gate refused: %s. The fact half: %s.' "$$IDENTUUM_PARTS_BYPASS" "$$why" "$$fact"); \
	fi; \
	test -f "$$rec" || { echo "witness: REFUSED — $$rec is absent; run make verify first"; exit 2; }; \
	res=$$(sed -n 's/^result: //p' "$$rec" | head -1); \
	[ "$$res" = green ] || { echo "witness: REFUSED — $$rec says result: $${res:-<absent>}, not green"; exit 1; }; \
	full=$$(git rev-parse HEAD); rhead=$$(sed -n 's/^repo-head: //p' "$$rec" | head -1); \
	[ -n "$$rhead" ] || { echo "witness: REFUSED — $$rec carries no repo-head: line"; exit 1; }; \
	case "$$full" in "$$rhead"*) ;; *) echo "witness: REFUSED — $$rec was written at repo-head $$rhead, HEAD is $$(git rev-parse --short HEAD)"; exit 1;; esac; \
	bash scripts/gate-witness.sh check . "$$rec" || { echo "witness: REFUSED — $$rec does not witness this tree (gate-witness check, above)"; exit 1; }; \
	other=$$(git status --porcelain | grep -v " $$rec$$" || true); \
	[ -z "$$other" ] || { echo "witness: REFUSED — a witness is record-only, and the tree carries more than $$rec:"; printf '%s\n' "$$other"; exit 1; }; \
	subject="Witness: make verify green at $$(git rev-parse --short HEAD)"; \
	n=$$(grep -c '^target: .* exit=0$$' "$$rec" || true); msg=$$(mktemp "$${TMPDIR:-/tmp}/witness.XXXXXX"); \
	{ printf '%s\n\n' "$$subject"; printf 'Record-only commit made by make witness: %s as make verify wrote it at the clean HEAD %s, %s planned target(s) at exit=0, tree digest verified by gate-witness check. A witness made any other way is a defect.\n' "$$rec" "$$full" "$$n"; [ -z "$$bypass" ] || printf '\n%s\n' "$$bypass"; } > "$$msg"; \
	if git add "$$rec" && git commit -q -F "$$msg"; then rm -f "$$msg"; echo "witness: $$subject -> $$(git rev-parse --short HEAD)"; \
	else rm -f "$$msg"; echo "witness: REFUSED — git commit did not land"; exit 1; \
	fi

## witness-parity: the two copies of `witness` check THEMSELVES — the
## image-base-parity discipline: from `witness:` through its closing `fi`, plus
## the blank line that terminates the recipe, hashed and compared with a pin
## shared by identuum-idp-oss and identuum-ui. A copy edited by one character
## turns its repo red with no sibling checkout required. CHANGING IT ON
## PURPOSE: edit one copy, run `make witness-parity`, read the digest from the
## failure, update WITNESS_MD5 in both and copy the block to both.
WITNESS_MD5 ?= 179ce4a5e5c1111f2c5c51ebb1ea2236

witness-parity:
	@blk="$$(awk '/^witness:/{f=1} f{print; if(f&&/^\tfi$$/){getline; print; exit}}' Makefile)"; \
	got="$$(printf '%s\n\n' "$$blk" | { md5sum 2>/dev/null || md5; } | awk '{print $$1}')"; \
	if [ "$$got" != "$(WITNESS_MD5)" ]; then \
		echo "check FAILED: witness-parity — the witness recipe has diverged from the copy shared with identuum-idp-oss and identuum-ui: wanted md5 $(WITNESS_MD5), got $$got; restore this copy, or update the block AND WITNESS_MD5 in both"; \
		exit 1; \
	fi; \
	echo "check OK: witness-parity witness block md5 $$got matches the shared pin"

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
