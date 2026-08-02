#!/bin/sh
set -e

# Bring the database schema up to date before serving anything.
#
# `migrate deploy` only applies migrations that already exist — it never invents
# one and never resets data, which is what makes it safe to run on every start.
# Doing it here rather than by hand means a fresh machine needs one command, and
# nobody can forget the step that leaves the app talking to a schema that is a
# version behind.
echo "→ applying migrations"
npx prisma migrate deploy

# Optional demo data, for a staging box somebody is going to click around in.
if [ "$SEED_ON_START" = "true" ]; then
  echo "→ seeding"
  node scripts/seed.js
  if [ "$SEED_DEMO" = "true" ]; then
    node scripts/seed-demo.js
  fi
fi

echo "→ starting"
exec "$@"
