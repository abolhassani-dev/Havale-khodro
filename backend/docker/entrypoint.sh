#!/bin/sh
set -e

# What happens before the server accepts a request.
#
# The distinction that matters here is between steps the application cannot run
# without and steps that are a convenience. `set -e` treats every failure as
# fatal, which is right for the first kind and wrong for the second — and got it
# wrong on the first deploy: the optional demo seed declined to run, the
# entrypoint died on its exit code, and the container restarted in a loop with a
# perfectly healthy database behind it. An optional extra must never be able to
# take the system down.

# ---- required ----

# `migrate deploy` only applies migrations that already exist — it never invents
# one and never resets data, which is what makes it safe on every start. Doing it
# here means a fresh machine needs one command, and nobody can forget the step
# that leaves the app talking to a schema one version behind.
echo "→ applying migrations"
npx prisma migrate deploy

# Contact encryption is opt-in and off by default. To turn it on: set
# DATA_ENCRYPTION_KEY in .env and run `node scripts/encrypt-existing.js` once,
# deliberately, when nothing else is going on. Deliberately not automatic —
# a conversion that rewrites every contact column should be something someone
# chose, on a day they are watching.

if [ "$SEED_ON_START" = "true" ]; then
  # The first administrator and the car catalogue. Without these there is no way
  # to sign in and nothing to post a listing about, so a failure here is fatal.
  echo "→ seeding"
  node scripts/seed.js
fi

# ---- optional ----

if [ "$SEED_DEMO" = "true" ]; then
  echo "→ demo data"
  # Deliberately not fatal. This refuses to run under NODE_ENV=production
  # without an explicit override, because it creates accounts whose password is
  # written in the repository — and that refusal is the script doing its job,
  # not an error worth stopping the application for.
  if ! node scripts/seed-demo.js; then
    echo "→ demo data skipped — see the message above. The application is starting anyway."
  # The sample خودرو advertisements ride on the demo agencies, so they only
  # make sense once those exist — and are just as optional.
  elif ! node scripts/seed-cars.js; then
    echo "→ sample خودرو advertisements skipped — see the message above."
  fi
fi

echo "→ starting"
exec "$@"
