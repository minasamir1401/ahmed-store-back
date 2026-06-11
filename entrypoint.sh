#!/bin/sh
set -e

# Create required runtime directories. Product images are stored in PostgreSQL.
mkdir -p /tmp/.wwebjs_auth

echo "Waiting for database to be ready and running migrations..."
MAX_RETRIES=20
RETRY_COUNT=0

if npx prisma db push; then
  echo "Database ready and schema pushed successfully ✅"
else
  echo "Prisma db push failed. Attempting to drop conflicting ImageStore table (type mismatch)..."
  node drop-imagestore.js || true

  until npx prisma db push || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Database connection not ready yet or schema push failed. Retrying in 5 seconds... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 5
  done
fi

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
  echo "❌ Error: Could not connect to the database after $MAX_RETRIES attempts. Exiting."
  exit 1
fi

echo "Database ready and migrations applied successfully ✅"

exec "$@"
