#!/bin/sh
set -e

echo "Applying database migrations (DIRECT_URL)..."
npx prisma migrate deploy

exec "$@"
