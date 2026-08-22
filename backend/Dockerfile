# Debian slim, not Alpine.
#
# Alpine looked like the obvious choice — smaller image, fewer packages — and it
# failed on the first real deploy. Prisma's query engine is a compiled binary
# that links against OpenSSL, and on Alpine (musl libc, OpenSSL 3) it could not
# work out which build to load. It then printed a plain-text error where Prisma
# expected JSON, so the actual message was buried:
#
#   Error: Could not parse schema engine response: SyntaxError: Unexpected
#   token 'E', "Error load"... is not valid JSON
#
# Alpine can be made to work with the right packages and binary targets, but
# Debian is the platform Prisma builds and tests for by default. A hundred extra
# megabytes on a server with a hundred gigabytes of disk is not worth a class of
# failure that shows up only in production.

# ---- dependencies ----
FROM node:20-slim AS deps
WORKDIR /app

# Prisma's engine links against OpenSSL, and the slim image does not ship it.
# Installing it explicitly rather than relying on a transitive dependency, so a
# base-image change cannot quietly remove it again.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# The Prisma CLI is a runtime dependency here rather than a dev one, because the
# container applies its own migrations on start and therefore needs the CLI.
#
# The flags are not decoration — this build runs on a server whose route to the
# npm registry is slow and occasionally drops:
#
#   --no-audit   the audit is a second round trip to a *different* endpoint,
#                after every package is already downloaded. It tells a
#                production build nothing it can act on, and it is where a
#                ten-minute install spent its last minute before timing out.
#   --no-fund    another pointless request on a link nobody clicks.
#   fetch-*      five attempts with a longer ceiling, and a per-socket timeout
#                of ten minutes rather than the default five: a large package
#                on a slow link is not a failure, and giving up on it turns a
#                slow deploy into a failed one (ETIMEDOUT, seen in production).
#
# The cache mount is what makes the retries add up. Without it every failed
# attempt threw away everything it had downloaded and the next one started from
# nothing — which is how two builds in a row died at ETIMEDOUT having fetched
# almost the whole tree twice. The mount keeps npm's cache on the host between
# builds, so each attempt resumes where the last one stopped and a flaky link
# only has to be lucky once, spread over several tries.
#
# NPM_REGISTRY exists for the day the official registry is unreachable from
# here for hours rather than minutes: point it at a mirror. Safe to do because
# package-lock.json pins an integrity hash for every tarball — npm verifies each
# one and refuses anything that does not match, whoever served it.
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm config set registry "$NPM_REGISTRY" \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 600000 \
    && for attempt in 1 2 3 4 5; do \
         echo "npm ci — attempt $attempt/5" \
         && npm ci --omit=dev --no-audit --no-fund && break \
         || { [ "$attempt" = 5 ] && exit 1; echo "…retrying in 10s"; sleep 10; }; \
       done

# ---- runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user: a container breakout should not land on root.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --create-home app

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:nodejs . .

# Generated at build time so the first request does not pay for it, and so a
# schema the client does not match fails the build instead of production.
RUN npx prisma generate \
    && chmod +x docker/entrypoint.sh \
    && chown -R app:nodejs /app

USER app
EXPOSE 3000

# Aimed at the real health route. A healthcheck pointed at a path that does not
# exist reports the container unhealthy forever, and whoever meets that first
# spends an hour looking for a fault in the application.
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "server.js"]
