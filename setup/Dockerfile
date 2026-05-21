##############################################################################
# identuum-ui-setup — one-shot runtime configuration writer.
#
# No build step needed; setup.mjs has zero npm dependencies.
##############################################################################
FROM node:22-bookworm-slim

WORKDIR /app

# Non-root user. UID/GID 10001 is within Debian's default UID_MIN/UID_MAX
# range (1000–60000) so useradd produces no warnings.
RUN groupadd --gid 10001 nonroot && \
    useradd --uid 10001 --gid nonroot --no-create-home --shell /usr/sbin/nologin nonroot

COPY --chown=nonroot:nonroot setup.mjs ./

USER nonroot

ENTRYPOINT ["node", "/app/setup.mjs"]
