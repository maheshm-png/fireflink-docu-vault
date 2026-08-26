# FireFlink Deck Vault

A secure, role-based document hub for case study PPTs, competitor comparisons,
demo videos, and other sales/demo collateral — free/open-source stack throughout.

## What's built (Phase 1 + Phase 2 — everything, complete)
- Supabase Auth login + role-aware navbar
- RBAC enforced in code (`lib/rbac.ts`) **and** in the database (`prisma/rls_policies.sql`)
- Document upload → pending review → owner approval → published workflow
- Version control with a full **diff viewer** (`/dashboard/documents/[id]`) comparing extracted text between any two versions, line by line
- **Text extraction on upload** for PPTX (slide text via XML parsing), PDF, and DOCX — this is what makes search actually search *content*, not just titles (`lib/extract.ts`)
- MinIO-backed file storage (self-hosted on Oracle Cloud free tier from day one) with AES-256 server-side encryption and short-lived presigned URLs only
- Meilisearch-backed search + category/type/staleness filters
- Superadmin console to invite users and assign roles
- Full audit log (upload/approve/reject/delete/download/login/role_change) — viewable at `/admin/audit-log`
- **Analytics dashboard** (`/admin/analytics`): most-viewed/downloaded docs, pending review count, staleness count
- **Google Chat notifications**: reviewer gets notified on upload (manager-only space), uploader gets notified on the decision, plus a weekly digest script (`npm run digest:send`) covering pending reviews + staleness flags per user (team-wide space)
- **Publish announcement, manager-controlled**: approving a document requires the manager to explicitly pick Yes/No on "announce to all users" — the API rejects the approval if this isn't set, so it can't be skipped or forgotten. Choosing Yes posts a "new document published" notification to the team-wide Google Chat space and the in-app bell for every active user (excluding the uploader, who already gets their own decision notification)
- **Invite-by-domain restriction**: only email addresses on your configured company domain(s) can be added as users (`ALLOWED_EMAIL_DOMAINS` in `.env`, defaults to `fireflink.com`) — enforced server-side in `/api/admin/users`, not just in the UI
- **Downloads preserve the original file exactly**: no re-encoding, re-compression, or transformation happens anywhere in the pipeline — the exact uploaded bytes are what get served back, so PPT layout, video quality, and PDF formatting are untouched. Downloads also now redirect straight to the file (fixed a bug where the link previously just showed raw JSON) and use the original filename instead of the internal storage key
- **Download access matches view access**: every active role (including view-only "Other") can download a *published* document — download is just part of viewing. Pending/rejected versions stay restricted to the uploader, the doc's owner, and Manager/Superadmin
- **Per-category custom upload forms**: managers/superadmins can attach a form to any category (`/admin/categories`) — short text, long text, dropdown, date, number, or yes/no fields, each optionally required. Whoever uploads into that category (`/dashboard/upload`) gets that form rendered live and can't submit without answering the required fields (enforced both in the form and again server-side, since the API can be called directly). The answers show up on the document's detail page with their real labels, so anyone opening it later has the context without chasing the uploader down
- Staleness-check script: rule-based (review-cycle age) + AI-assisted, using a **self-hosted open-source Ollama LLM** (Llama 3.1) — no paid API
- Theme colors pulled from FireFlink's actual site metadata (`#29102D`)

## Production deployment (Docker + self-hosted Supabase)

The app is containerized (`Dockerfile`) for handoff to devops:

1. **Self-hosted Supabase**: deploy Supabase's own official docker-compose
   stack (https://github.com/supabase/supabase/tree/master/docker) — this
   project doesn't bundle it, since it's a multi-container stack (Postgres,
   GoTrue auth, Kong, Studio, etc.) that Supabase maintains itself. Once it's
   up, set `NEXT_PUBLIC_SUPABASE_URL` to its Kong gateway URL and the
   anon/service-role keys to the JWTs configured in *that* stack's `.env`.
2. **App + MinIO/Meilisearch/Ollama**: `docker compose up -d --build` from
   `/infra` builds the app image from the repo-root `Dockerfile` and starts
   it alongside the existing self-hosted MinIO/Meilisearch/Ollama services.
   The app reads its config from `.env` at the repo root — copy
   `.env.example`, fill in real values (including both `DATABASE_URL`, the
   pooled connection, and `DIRECT_URL`, the direct one — see the comments in
   `.env.example` and `prisma/schema.prisma`).
3. **Migrations run automatically**: the container's entrypoint runs
   `prisma migrate deploy` (against `DIRECT_URL`) before starting the
   server, so a fresh deploy of a new image version applies any pending
   migrations on its own — no separate manual step. Still paste
   `prisma/rls_policies.sql` into the Supabase SQL editor once, after the
   first migration.
4. **Reverse proxy + TLS**: put the host behind Caddy/nginx/similar and
   terminate TLS there — the container itself just listens on port 3000.
5. **Health check**: `GET /api/health` (used by the image's own
   `HEALTHCHECK` and suitable for a load balancer / orchestrator probe).
6. **Scheduled jobs run automatically**: the `cron` service in
   `infra/docker-compose.yml` (same image as `app`) runs
   `retention:run`/`staleness:run`/`digest:send` on the schedule in
   `docker/crontab` — no host cron setup needed.
7. **Ollama model pulled automatically**: the one-shot `ollama-pull` service
   pulls `OLLAMA_MODEL` once `ollama` is up — no manual `docker exec` step.

## 1. Provision the free services (local dev / non-Docker deploy)

1. **Supabase** (auth + Postgres): create a free project at supabase.com.
   Copy the project URL, anon key, and service role key into `.env`.
2. **Oracle Cloud Always-Free VM**: create an Always-Free Ampere or AMD instance.
   This VM hosts three things via Docker Compose:
   - **MinIO** (object storage — case study PPTs, videos, everything)
   - **Meilisearch** (search index)
   - **Ollama** (open-source LLM for the staleness agent — `ollama pull llama3.1:8b`)
   A sample `docker-compose.yml` for these three is in `/infra` (add before first deploy).
3. **Render**: create a free Web Service pointed at this repo. Add all vars from `.env.example`.
4. **Google Chat** (optional): create incoming webhooks for `GCHAT_WEBHOOK_URL` (team-wide space) and `GCHAT_MANAGER_WEBHOOK_URL` (manager-only space). Notifications silently no-op if these aren't set, so it's safe to skip for local dev.

## 2. Logo

The real FireFlink logo is already in place — `public/logo-full.png` (wordmark) and `public/logo-icon.png` (mark only), used throughout via `components/Logo.tsx` (Navbar, login, reset-password, `BrandedLoader`) and as the watermark stamped onto downloaded PPT/Word/Excel files (`lib/watermark.ts`). The browser tab favicon (`app/icon.png`, picked up automatically by Next.js's App Router icon convention) is the same icon mark. To update the branding, replace those files directly — no code changes needed.

## 3. Database setup

```bash
npm install
npx prisma migrate deploy
# then paste prisma/rls_policies.sql into the Supabase SQL editor and run it
```

## 4. Create your superadmin account

Since the app itself only lets a superadmin invite people, bootstrap the first
one directly in Supabase:
1. Supabase dashboard → Authentication → Add user (your email + a temp password).
2. Supabase dashboard → Table editor → `User` table → insert a row with that
   same `id`, your email/name, and `role = superadmin`.
3. Log in at `/login` — you'll now see **Manage Users** in the nav and can
   invite everyone else properly from there.

## 5. Run locally

```bash
cp .env.example .env   # fill in real values
npm run dev
```

## 6. Schedule the background jobs

Handled automatically by the `cron` service in `infra/docker-compose.yml` when deploying via Docker (see "Production deployment" above) — `docker/crontab` runs `retention:run` daily, `staleness:run` daily, and `digest:send` weekly. Running outside Docker instead? Set up the equivalent host cron entries yourself, e.g.:
```
0 5 * * * cd /path/to/app && npm run retention:run >> /var/log/retention.log 2>&1
0 6 * * * cd /path/to/app && npm run staleness:run >> /var/log/staleness.log 2>&1
0 8 * * 1 cd /path/to/app && npm run digest:send >> /var/log/digest.log 2>&1
```

## Still open (smaller, lower-priority items)
- Video thumbnail generation (would need ffmpeg on the Oracle VM)
- AI-assisted staleness check comparing against live competitor web pages (needs outbound web access from the agent — currently it only reads the doc's own content)
- In-app notification bell (currently email-only)
