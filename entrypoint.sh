#!/bin/sh
set -e

# Create required runtime directories. Product images are stored in PostgreSQL.
mkdir -p /tmp/.wwebjs_auth

echo "Applying database schema migrations (safe - no data loss)..."
MAX_RETRIES=20
RETRY_COUNT=0

until npx prisma db push || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "Database not ready yet. Retrying in 5 seconds... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 5
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "❌ Error: Could not connect to the database after $MAX_RETRIES attempts. Exiting."
  exit 1
fi

echo "Database schema applied successfully ✅"

echo "Checking and executing SQLite to PostgreSQL data migration if needed..."
node restore_postgres.js

exec "$@"
