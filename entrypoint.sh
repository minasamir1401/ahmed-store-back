#!/bin/sh
set -e

# Create required runtime directories. Product images are stored in PostgreSQL.
mkdir -p /tmp/.wwebjs_auth

echo "Resetting database and pushing schema (force-reset)..."
MAX_RETRIES=20
RETRY_COUNT=0

until npx prisma db push --force-reset || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "Database connection not ready yet or schema push failed. Retrying in 5 seconds... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 5
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
  echo "❌ Error: Could not connect to the database after $MAX_RETRIES attempts. Exiting."
  exit 1
fi

echo "Database reset and schema pushed successfully ✅"

exec "$@"
