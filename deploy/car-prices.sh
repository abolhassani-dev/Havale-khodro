#!/usr/bin/env bash
#
# The market-price fetch, from the host, every fifteen minutes.
#
#   /opt/feranocar/deploy/car-prices.sh              # do it
#   /opt/feranocar/deploy/car-prices.sh --dry-run    # fetch and judge, write nothing
#
# Installed by deploy/update.sh as /etc/cron.d/feranocar-car-prices, the same
# pattern as the nightly run. Not a timer inside the API: a setInterval dies
# with the container and nobody notices for a month, whereas a cron entry is
# visible in one command and a missed hour is one line in the log.
#
# What it does is in backend/src/jobs/car-prices.js — two pages, parsed,
# checked, written as one snapshot; a bad page leaves the previous one alone.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f docker-compose.yml ]; then
  echo "✗ docker-compose.yml is not here. Run this from inside the project." >&2
  exit 1
fi

# `run --rm --entrypoint node`, exactly as nightly.sh: works whether or not the
# API is up, and skips the image entrypoint's migration-and-seed pass, which
# is right on boot and wrong sixty times a day.
docker compose run --rm --no-deps --entrypoint node api src/jobs/car-prices.js "$@"
