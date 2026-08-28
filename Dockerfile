# syntax=docker/dockerfile:1

# ---------- Stage 1: install dependencies ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Stage 2: build ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are special: `next build` compiles them directly into
# the browser-side JS bundle (e.g. app/login/page.tsx's client-side
# `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)`).
# Setting them as a plain runtime ENV in the runner stage below has NO
# effect on code that's already been compiled — the value has to be
# correct HERE, at build time. Real deployments MUST pass these via
# --build-arg / docker-compose's build.args (see infra/docker-compose.yml
# and infra/.env.example) with the actual production values, or the app
# will be permanently built pointing at a fake auth endpoint. The defaults
# below exist only so a build without them doesn't fail outright (e.g. a
# local test build that never logs in) — never rely on them for a real
# deployment.
ARG NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Everything below is server-only (no NEXT_PUBLIC_ prefix) — read fresh
# from process.env at runtime, never compiled into client code. These
# placeholders only need to exist so build-time steps don't fail:
# - DATABASE_URL/DIRECT_URL: `prisma generate` validates the referenced env
#   vars exist, even though it never connects to them.
# - The rest: Next.js executes route handlers (e.g.
#   app/api/admin/users/route.ts) during "collect page data" to trace their
#   dependencies, and those modules create clients at import time.
# The runner stage below gets the real values for these from the container
# environment at startup, same as any other server-side config.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
ENV DIRECT_URL="postgresql://user:pass@localhost:5432/db"
ENV SUPABASE_SERVICE_ROLE_KEY="placeholder"
ENV MEILISEARCH_HOST="http://localhost:7700"
ENV MINIO_ACCESS_KEY="placeholder"
ENV MINIO_SECRET_KEY="placeholder"
RUN npx prisma generate
RUN npm run build

# ---------- Stage 3: production runtime ----------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# - openssl: required by Prisma's query engine at runtime
# - libreoffice + fontconfig/fonts-dejavu: headless PPT/Word/Excel -> PDF
#   conversion for document previews (lib/officeConvert.ts, lib/storage.ts).
#   Optional at the app level (falls back gracefully if missing) but needed
#   here for that feature to actually work in production.
# - cron: only used by the separate `cron` compose service (same image,
#   different entrypoint/command) that runs the scheduled maintenance
#   scripts below — unused, harmless weight in the `app` service itself.
RUN apt-get update -y && apt-get install -y --no-install-recommends \
      libreoffice \
      openssl \
      fontconfig \
      fonts-dejavu \
      ca-certificates \
      cron \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# Not part of the Next.js build output — these run directly via `tsx` (see
# package.json's staleness:run/retention:run/digest:send/etc. scripts),
# invoked by the `cron` service.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY docker/crontab /etc/cron.d/fireflink-jobs
COPY docker/cron-entrypoint.sh ./docker/cron-entrypoint.sh
COPY docker/run-cron-job.sh ./docker/run-cron-job.sh
RUN chmod +x ./docker-entrypoint.sh ./docker/cron-entrypoint.sh ./docker/run-cron-job.sh \
    && chmod 0644 /etc/cron.d/fireflink-jobs

# Run as the non-root `node` user baked into the base image for the `app`
# service. LibreOffice needs a writable HOME for its profile directory.
# The `cron` service overrides this back to root (crond requires it) via
# `user: root` in docker-compose.yml.
RUN mkdir -p /home/node/.config && chown -R node:node /home/node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
