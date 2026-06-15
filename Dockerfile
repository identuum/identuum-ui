##############################################################################
# Stage 1: install dependencies
##############################################################################
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# pnpm
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# pnpm-workspace.yaml must be present at install time so pnpm 11 reads
# the `allowBuilds:` map and runs the native-binary postinstall scripts
# (sharp / esbuild / @biomejs/biome). Without it, `pnpm install
# --frozen-lockfile` fails in CI mode with ERR_PNPM_IGNORED_BUILDS.
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

##############################################################################
# Stage 2: build
##############################################################################
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

##############################################################################
# Stage 3: production runner (Next.js standalone)
##############################################################################
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=7104
ENV HOSTNAME=0.0.0.0

# Non-root user. UID/GID 10001 is within Debian's default UID_MIN/UID_MAX
# range (1000–60000) so useradd produces no warnings.
RUN groupadd --gid 10001 nonroot && \
    useradd --uid 10001 --gid nonroot --no-create-home --shell /usr/sbin/nologin nonroot

COPY --from=builder --chown=nonroot:nonroot /app/.next/standalone ./
COPY --from=builder --chown=nonroot:nonroot /app/.next/static ./.next/static
COPY --from=builder --chown=nonroot:nonroot /app/public ./public

# Config volume mount point (written by identuum-ui-setup)
RUN mkdir -p /app/config && chown nonroot:nonroot /app/config

USER nonroot

EXPOSE 7104

# Health check using Node's built-in fetch (no wget/curl needed in slim images).
HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=30s \
  CMD node -e "fetch('http://localhost:7104/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
