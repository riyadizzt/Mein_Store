FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# ──────────────────────────────────────────────────────────────
# Stage 1 — Dependencies
# ──────────────────────────────────────────────────────────────
# Full install (incl. dev-deps) so the build stage has nest CLI,
# tsc, prisma CLI, jest types, etc. Cached on package.json files
# + lockfile — only reruns when any of those change.
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
RUN pnpm install --frozen-lockfile --filter @omnichannel/api...

# ──────────────────────────────────────────────────────────────
# Stage 2 — Build
# ──────────────────────────────────────────────────────────────
# Runs `pnpm --filter @omnichannel/api build` which itself calls
# `prisma generate && nest build`. Emits compiled JS into
# /app/apps/api/dist (including compiled workspace packages under
# /app/apps/api/dist/packages/types/src/).
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @omnichannel/api build

# ──────────────────────────────────────────────────────────────
# Stage 3 — Runner
# ──────────────────────────────────────────────────────────────
# Runner owns its own install + prisma generate. This guarantees a
# clean, internally-consistent node_modules that resolves every
# import correctly at runtime — no cross-stage symlink brittleness,
# no generated-prisma-dir placement ambiguity, no Sentry resolution
# failures (Railway incident cluster 22.04.2026).
#
# Cost: slightly larger image (+ build tools + prisma CLI still in
# place). Acceptable for Staging; easy to strip later if we ever
# need a minimal Production image.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# pg_dump for the backup cron; gzip for compression. See
# docs/admin-runbook/backup-wiederherstellung.md.
RUN apk add --no-cache postgresql-client gzip

# pnpm CLI for install + prisma generate.
RUN corepack enable && corepack prepare pnpm@9 --activate

# Install layout: lockfile + all manifests. Keep these BEFORE
# source copies so Docker layer-caching kicks in on every
# unchanged-dependency rebuild.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/

# Clean, runner-local prod install. Filter only @omnichannel/api
# and its transitive deps. Workspace deps (@omnichannel/types) are
# linked as expected; dev-deps are stripped.
RUN pnpm install --frozen-lockfile --prod --filter @omnichannel/api...

# Prisma schema needed for `prisma generate` AND for runtime
# `prisma migrate deploy` (see railway.json startCommand).
COPY prisma ./prisma

# Generate Prisma Client INSIDE runner's own node_modules. This
# is the same pnpm workspace resolution as local dev, so the
# generated .prisma/client lands where @prisma/client/default.js
# expects to `require('.prisma/client/default')`.
RUN pnpm --filter @omnichannel/api exec prisma generate --schema=/app/prisma/schema.prisma

# Workspace-package source — @omnichannel/types' package.json sets
# main: ./src/index.ts. That TS entry is compiled into the API's
# dist tree by nest build (see /app/dist/packages/types/src/index.js
# after the COPY below). But the symlink `node_modules/@omnichannel/
# types → packages/types` needs the directory to exist at runtime
# for module resolution, so we copy the minimal manifest + compiled
# artefact. The manifest was already copied above; the compiled
# source comes with the dist tree below.
# (No separate handling needed — pnpm install already wired up the
# symlink during the install step above.)

# Compiled output from builder, placed UNDER apps/api so Node's
# upward module resolution from dist/apps/api/src/main.js reaches
# /app/apps/api/node_modules (where pnpm --filter installed deps).
# Railway incident 22.04.2026: flat /app/dist/ layout caused
# Cannot find module '@nestjs/common' at container start.
#   /app/apps/api/dist/apps/api/src/**        — compiled API source
#   /app/apps/api/dist/packages/types/src/**  — compiled workspace types
#   /app/apps/api/dist/modules/email/**       — handlebars templates
COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3001
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
