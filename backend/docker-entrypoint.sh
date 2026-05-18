#!/bin/sh
# Optional helper: run migrations then start the app.
# Use as ENTRYPOINT override or call manually: docker compose run --rm backend ./docker-entrypoint.sh
set -e

echo "[entrypoint] running prisma migrate deploy..."
npx prisma migrate deploy

echo "[entrypoint] starting app..."
exec node dist/main.js
