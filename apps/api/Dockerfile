FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# ──────────────────────────────────────────────────────────────
# Stage 1 — Dependencies (cached on package.json + lockfile)
# ──────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
RUN pnpm install --frozen-lockfile --filter @omnichannel/api...

# ──────────────────────────────────────────────────────────────
# Stage 2 — Build (TS → JS, prisma generate runs inside pnpm build)
# ──────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @omnichannel/api build

# ──────────────────────────────────────────────────────────────
# Stage 3 — Bundle production deps without symlinks
# ──────────────────────────────────────────────────────────────
# pnpm deploy produces a self-contained directory with a flat
# node_modules — no .pnpm/ symlink indirection, no broken cross-
# stage symlink paths. This is the pnpm-officially-recommended
# pattern for Docker runtime images (Railway incident 22.04.2026:
# @sentry/nestjs symlink dereferenced to nothing in runner stage).
FROM base AS deploy
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
# --prod strips devDependencies. The filter selects the api
# workspace package; pnpm resolves workspace-internal deps
# (@omnichannel/types, @omnichannel/utils) and bundles them in.
RUN pnpm deploy --filter=@omnichannel/api --prod /prod/api

# ──────────────────────────────────────────────────────────────
# Stage 4 — Runner (minimal Alpine + pg_dump + built artifact)
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# postgresql-client provides pg_dump — required by the daily backup cron
# (apps/api/src/modules/backup/backup.service.ts). Without it pg_dump
# shells out to ENOENT and every backup fails. gzip is in the alpine
# base already but we install it explicitly so a future base-image
# change never breaks the pipeline. See docs/admin-runbook/
# backup-wiederherstellung.md.
RUN apk add --no-cache postgresql-client gzip

# Compiled JavaScript artefact (from builder stage).
COPY --from=builder /app/apps/api/dist ./dist

# Production node_modules bundle (from deploy stage — flat,
# symlink-free, guaranteed to resolve in the runner stage).
COPY --from=deploy /prod/api/node_modules ./node_modules

# Prisma schema + migrations — needed by `prisma migrate deploy`
# on startup (see railway.json startCommand).
COPY --from=builder /app/prisma ./prisma

EXPOSE 3001
CMD ["node", "dist/apps/api/src/main.js"]
