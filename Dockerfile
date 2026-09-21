##############################################################################
# Stage 1: install dependencies
##############################################################################
# node:26-bookworm-slim, pinned by DIGEST (THE-UI-NODE-26-LATEST, 2026-09-06;
# measured at this digest: node v26.8.1, npm 11.19.0, NO corepack — Node 25+
# stopped bundling it). pnpm is therefore installed straight from npm at the
# version package.json's packageManager pins: one moving part fewer than
# `npm i -g corepack` plus a floating corepack. toolchain-parity holds every
# `pnpm@` in this file equal to packageManager. Build stages are never
# published — only the runner stage's filesystem ships — so a shell here is
# fine.
FROM node:26-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS deps
WORKDIR /app

RUN npm install -g pnpm@11.3.0

# pnpm-workspace.yaml must be present at install time so pnpm 11 reads
# the `allowBuilds:` map and runs the native-binary postinstall scripts
# (sharp / esbuild / @biomejs/biome). Without it, `pnpm install
# --frozen-lockfile` fails in CI mode with ERR_PNPM_IGNORED_BUILDS.
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

##############################################################################
# Stage 2: build
##############################################################################
FROM node:26-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS builder
WORKDIR /app

RUN npm install -g pnpm@11.3.0

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# The runner's config mount point is created HERE, where root and a shell
# are guaranteed, and copied into the runner with the runner's ownership.
RUN mkdir -p /app/config-mount

##############################################################################
# Stage 3: production runner (Next.js standalone)
##############################################################################
# cgr.dev/chainguard/node, pinned by DIGEST (owner ruling THE-UI-NODE-26-LATEST,
# 2026-09-06; moved digest-to-digest by THE-PATCHED-BASE, 2026-09-12).
# Measured AT THIS DIGEST (sha256:4a274a26…, image created 2026-09-10): node
# v26.8.2; busybox /bin/sh PRESENT (/bin/sh -> /bin/busybox, 231 entries in
# /bin); ENTRYPOINT ["/usr/bin/node"]; USER 65532 (`node`); WORKDIR /app; npm
# at /usr/bin/npm; grype through the pinned judge lictor (`lictor grype`; the
# idp-oss tools/grype-gate it was ported from is retired since OSS 63ee215):
# matches=0 fixable=0 severe=0. glibc (Wolfi), not Alpine: IMG-NONALPINE holds.
#
# WHY IT MOVED: the previous digest (sha256:753a6601…) shipped glibc 2.44-r5,
# and on 2026-09-12 the vulnerability database attached CVE-2026-18374 and
# GHSA-qg52-8pr2-xj9v to it with a published fix in 2.44-r6 — eight fixable
# findings across glibc, glibc-locale-posix, ld-linux and libcrypt1. The judge
# fails a finding WITH A FIX by design, so the pin moved to a digest that
# carries the fix; nothing was suppressed.
#
# THE SHELL BELONGS TO THIS DIGEST, NOT TO THE TAG. A bump must re-measure
# both the scan (`make grype-scan`) and the shell
# (`docker run --rm --entrypoint /bin/sh <ref> -c id`), and move the
# node-major annotation below to whatever node the new digest ships —
# toolchain-parity reads that annotation and holds it equal to the build
# stages, engines, @types/node and the CI matrix.
# node-major=26
FROM cgr.dev/chainguard/node@sha256:4a274a26acabd969b086b5a4840c5286f915d6ce43b8c2e74155a7061a30cd87 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=7104
ENV HOSTNAME=0.0.0.0

# The base ships the non-root user `node` (uid/gid 65532) and runs as it by
# default: the Debian runner's groupadd/useradd RUN line is DROPPED.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Config volume mount point (bind-mounted read-only by compose; written by
# identuum-ui-setup). The Debian runner's `mkdir -p && chown` RUN line is
# REWORKED into a COPY of the empty directory made in the builder: neither
# root nor a shell is needed in this stage to create it.
COPY --from=builder --chown=node:node /app/config-mount ./config

# The Debian runner's npm-removal RUN line is DROPPED: this base carries npm
# at /usr/bin/npm inside its node package (no vendored tree under
# /usr/local/lib), it scans to zero findings at this digest, and removing it
# would need root. `server.js` remains the only thing this image executes.

USER node

EXPOSE 7104

# Health check in EXEC form on the base's node: no shell is consulted, so the
# check keeps working even if a future digest drops busybox.
HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=30s \
  CMD ["/usr/bin/node", "-e", "fetch('http://localhost:7104/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"]

# ENTRYPOINT is the base's ["/usr/bin/node"]; CMD supplies only the script.
CMD ["server.js"]
