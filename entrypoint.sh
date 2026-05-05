#!/bin/sh
set -e

# Create uploads directory if it doesn't exist
mkdir -p /app/uploads

# Run migrations if needed
npx prisma migrate deploy || true

exec "$@"
