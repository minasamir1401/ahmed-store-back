#!/bin/sh
set -e

# If the database file doesn't exist in the volume, copy it from the backup
if [ ! -f /app/prisma/dev.db ]; then
    echo "Initializing database..."
    cp /app/prisma-backup/dev.db.template /app/prisma/dev.db || true
fi

# Create uploads directory if it doesn't exist
mkdir -p /app/uploads

# Run migrations if needed
npx prisma migrate deploy || true

exec "$@"
