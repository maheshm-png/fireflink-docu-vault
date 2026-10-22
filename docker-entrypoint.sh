#!/bin/sh
set -e

# Everything a deploy needs happens here, on every container start, so
# devops only has to build and start the image.

echo "Applying database migrations (DIRECT_URL)..."
npx prisma migrate deploy

# Row Level Security policies. The file is safe to re-run in full (every
# policy is dropped and recreated). Not fatal: the app enforces the same
# rules itself (lib/rbac.ts, lib/access.ts), so a failure here is logged
# loudly but doesn't stop the app from starting.
echo "Applying RLS policies (prisma/rls_policies.sql)..."
if ! npx prisma db execute --file prisma/rls_policies.sql --url "${DIRECT_URL:-$DATABASE_URL}"; then
  echo "WARNING: RLS policies could not be applied. The app will still start."
fi

# Search index settings (filterable/searchable attributes). Idempotent.
# Not fatal: Meilisearch may still be starting. The app adds any missing
# filter settings itself on first search (lib/search.ts), and the next
# container restart runs this again.
echo "Configuring the search index..."
if ! npx tsx scripts/setup-search.ts; then
  echo "WARNING: search index could not be configured. The app will still start."
fi

exec "$@"
