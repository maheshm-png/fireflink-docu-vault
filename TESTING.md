# Testing FireFlink Deck Vault Locally

You don't need the Oracle VM for testing — the same `infra/docker-compose.yml`
runs fine on your own laptop. Only move MinIO/Meilisearch/Ollama to the
Oracle VM when you're ready to actually deploy for real use.

Nothing here has been compiled yet (the environment that generated this code
had no internet access to run `npm install`), so your first real step —
`npm run build` — is also the first genuine correctness check. Expect to
fix a few things; that's normal for a first build, not a sign something
is fundamentally wrong.

## 1. Prerequisites
- Node.js 18+
- Docker Desktop (for MinIO + Meilisearch + Ollama, running locally)
- A free Supabase account (supabase.com) — takes ~3 minutes to spin up a project

## 2. Start local infra

```bash
cd infra
MINIO_ROOT_USER=admin MINIO_ROOT_PASSWORD=admin12345 MEILI_MASTER_KEY=localtestkey \
  docker compose up -d
```

Check they're up:
- MinIO console: http://localhost:9001 (login with the user/password above)
- Meilisearch: http://localhost:7700
- Ollama: http://localhost:11434

Create the storage bucket (MinIO console → Buckets → Create Bucket → name it
`fireflink-docs`, matching `MINIO_BUCKET` in your `.env`).

Pull a model for the staleness agent (optional for early testing, skip if
you just want to test upload/review/search first):
```bash
docker exec -it <ollama-container-name> ollama pull llama3.1:8b
```

## 3. Create your Supabase project
1. supabase.com → New Project.
2. Once it's up: Settings → API → copy the Project URL, `anon` key, and
   `service_role` key.
3. Settings → Database → copy the connection string for `DATABASE_URL`.

## 4. Configure the app

```bash
cp .env.example .env
```
Fill in: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (from Supabase), and
`MINIO_ENDPOINT=http://localhost:9000`, `MINIO_ACCESS_KEY=admin`,
`MINIO_SECRET_KEY=admin12345`, `MEILISEARCH_HOST=http://localhost:7700`,
`MEILISEARCH_API_KEY=localtestkey`, `OLLAMA_HOST=http://localhost:11434`.

Leave `GCHAT_WEBHOOK_URL`/`GCHAT_MANAGER_WEBHOOK_URL` blank for now — every
notification call already no-ops without them, so you can test the whole
app without a real Google Chat space wired up.
`ALLOWED_EMAIL_DOMAINS` — set it to a domain you can actually receive test
invites at (e.g. your own email's domain), or the Supabase invite flow
won't be usable in testing.

## 5. Install, migrate, index

```bash
npm install
npx prisma migrate dev --name init
npm run search:setup
```
Then open the Supabase SQL editor and paste/run the contents of
`prisma/rls_policies.sql`.

## 6. Bootstrap your superadmin account
The app can only create users once a superadmin exists, so the first one
has to be created directly in Supabase:
1. Supabase dashboard → Authentication → Users → Add user (your email +
   a password you'll actually use to log in).
2. Supabase dashboard → Table Editor → `User` table → insert a row:
   `id` = the same UUID as the auth user you just created, plus your
   email, name, and `role = superadmin`.

## 7. Run it

```bash
npm run dev
```
Open http://localhost:3000/login and sign in with the superadmin account
from step 6.

## 8. What to actually click through

Go roughly in this order — each step sets up what the next one needs:

1. **Manage Users** (nav) → invite a second test account (must match your
   `ALLOWED_EMAIL_DOMAINS`) with role `sc`. Accept the invite email from
   Supabase to set a password for that account.
2. **Categories** → New Category. Give it a name, then add 2-3 custom
   fields (e.g. a required dropdown "Region: APAC, EMEA, NA" and a
   required text field "Client Name").
3. Log in as the SC test account → **Upload Document** → pick your new
   category → confirm its custom fields appear and block submission until
   filled in → pick your superadmin as reviewer → upload any small file
   (a PDF or PPTX is the best test since those get text-extracted).
4. Log back in as superadmin → open the document from **Pending Review**
   (or the dashboard) → confirm you see the custom field answers under
   "Document Details" → try clicking **Approve & Publish** with neither
   Yes/No picked (should be disabled) → pick "Yes, announce it" → approve.
5. Confirm: the doc now shows as Published, appears in **All Documents**
   search/filters, and (if you set a real `GCHAT_WEBHOOK_URL`) the team
   space got a notification, plus every other user's in-app bell.
6. Click **Download Current Version** — confirm it actually downloads the
   file (not a JSON blob) with the correct original filename and opens
   without any corruption/quality loss.
7. Upload a new version of the same doc with a changelog note → approve it
   too → go to the document page → **Compare Versions** → confirm you see
   a real diff of the extracted text between the two versions.
8. **Analytics** (nav) → confirm your view/download just now shows up.
9. **Audit Log** (nav) → confirm upload/approve/download all logged.
10. Log in as an "Other" (view-only) role user → confirm they can view and
    download published docs but have no Upload/Manage Users/Categories
    options anywhere in the nav.
11. Try `npm run staleness:run` after backdating a category's review cycle
    or a doc's `lastReviewedAt` in the DB — confirm a staleness flag shows
    up on the doc.
12. Try `npm run digest:send` — confirms it doesn't error even with no
    `GCHAT_WEBHOOK_URL` set (should just skip silently).

If all of that works, you have a genuinely working local instance. Moving
to production from there is just swapping the local Docker services for
the Oracle VM ones and deploying the Next.js app to Render, per the main
README.
