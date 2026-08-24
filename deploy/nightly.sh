#!/usr/bin/env bash
#
# The nightly housekeeping run, from the host.
#
#   /opt/feranocar/deploy/nightly.sh            # do it
#   /opt/feranocar/deploy/nightly.sh --dry-run  # say what it would do
#
# Installed by deploy/update.sh as /etc/cron.d/feranocar-nightly, the same
# pattern the backup and the certificate renewal already use. Deliberately not
# a timer inside the API process: a setInterval in there stops when the
# container restarts and nobody notices for a month, whereas a missing cron
# entry is visible in one command.
#
# What it does is in backend/src/jobs/nightly.js — archive the audit rows that
# are due, verify the archive, then delete them.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f docker-compose.yml ]; then
  echo "✗ docker-compose.yml is not here. Run this from inside the project." >&2
  exit 1
fi

# The archive directory is bind-mounted into the container, so it has to exist
# on the host first — Docker would otherwise create it as root and the API,
# which runs as uid 1001, could not write a byte into it.
ARCHIVE="$(grep -E '^ACTIVITY_ARCHIVE_DIR=' .env 2>/dev/null | cut -d= -f2- || true)"
ARCHIVE="${ARCHIVE:-/var/backups/feranocar/activity}"
mkdir -p "$ARCHIVE"
chown -R 1001:1001 "$ARCHIVE" 2>/dev/null || true

# `run --rm`, not `exec`: this must work whether or not the API is up. A night
# when the container is restarting is exactly the night you do not want the
# housekeeping skipped, and skipping it silently is how a disk fills.
#
# `--entrypoint node` matters more than it looks. The image's entrypoint applies
# migrations, seeds, and — where SEED_DEMO is on — recreates the demo agencies
# before it runs anything. That is right on startup and wrong at 3:30 every
# morning: it would re-run a migration check and a seed nightly, forever, to do
# a job that only reads and deletes. Going straight to `node` runs the script
# and nothing else.
docker compose run --rm --no-deps --entrypoint node api src/jobs/nightly.js "$@"
