#!/bin/sh
set -e

# Create required runtime directories. Product images are stored in PostgreSQL.
mkdir -p /tmp/.wwebjs_auth

echo "Running Prisma migrations..."
# Use migrate deploy for production (PostgreSQL)
npx prisma migrate deploy

echo "Database ready ✅"

exec "$@"
