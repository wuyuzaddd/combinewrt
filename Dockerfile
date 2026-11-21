# combinewrt is a single Next.js process plus a SQLite file; everything heavy
# (ImageBuilder, source builds, feed publishing) runs on GitHub Actions. The
# image only needs Node, the built app, the runtime `config/` tree and the `apk`
# CLI the catalog/source-watch code shells out to.
#
# Build with resource caps on thermally-limited hosts:
#   docker build --build-arg NODE_OPTIONS=--max-old-space-size=6144 -t combinewrt-site .
#
# `NODE_BASE` defaults to the official Node image. On a host where Docker Hub is
# unreachable but an Alpine image is already cached, override it with
# `--build-arg NODE_BASE=nginx:alpine` (or BUILD_BASE_IMAGE in the compose
# environment): the base stage then installs Node 24 from the Alpine
# repositories, and `apk` is native either way, which is what production expects.
ARG NODE_BASE=node:24-alpine

# One shared base: Node, tini, the unprivileged `node` user (uid/gid 1000) and
# the /data layout are set up once and reused by every stage.
FROM ${NODE_BASE} AS base
# `openssl passwd -6` hashes the root password at plan time, `apk` parses the
# feed indexes; both are runtime dependencies, not just build ones.
RUN apk add --no-cache tini openssl \
 && if ! command -v node >/dev/null 2>&1; then apk add --no-cache nodejs npm; fi \
 && if ! id -u node >/dev/null 2>&1; then \
      addgroup -S -g 1000 node && adduser -S -D -H -u 1000 -G node -s /sbin/nologin node; \
    fi \
 && mkdir -p /data/artifacts /data/source-cache && chown -R node:node /data

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NODE_OPTIONS=--max-old-space-size=6144
ENV NODE_OPTIONS=${NODE_OPTIONS}
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/combinewrt.db \
    ARTIFACT_CACHE_DIR=/data/artifacts \
    SOURCE_CACHE_DIR=/data/source-cache

# Only production dependencies are shipped; the build already happened above.
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# Loaded from process.cwd() at runtime (capabilities, modes, presets, sources,
# extension bundles/themes), so it cannot be baked into the Next chunk graph.
COPY --from=builder /app/config ./config
COPY --from=builder /app/next.config.ts ./next.config.ts

USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start"]
