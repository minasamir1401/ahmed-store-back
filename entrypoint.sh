#!/bin/sh
set -e

# Create uploads directory if it doesn't exist
mkdir -p /app/uploads

# Force schema push to ensure new columns are added to PostgreSQL
npx prisma db push --accept-data-loss || true

exec "$@"
