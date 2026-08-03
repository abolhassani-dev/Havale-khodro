#!/usr/bin/env bash
#
# Restore the latest backup into a throwaway database and count what arrived.
#
# A backup nobody has restored is a file, not a backup. The failure modes are
# quiet ones — a dump that captured an empty database, a truncated gzip, a
# pg_dump that errored into a file nobody read — and every one of them looks
# exactly like a working backup until the day it is the only copy left.
#
# The live database is never touched: everything happens in a temporary
# database that is dropped at the end, including if this script fails.
#
#   /opt/feranocar/deploy/verify-backup.sh
#   /opt/feranocar/deploy/verify-backup.sh /var/backups/feranocar/db-20260803-1318.sql.gz
#
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-/var/backups/feranocar}"
# `|| true` matters: under `set -e`, an assignment from a command substitution
# takes the substitution's exit status, and grep exits non-zero when the
# pattern is absent or the file is missing. Without it the script died here
# with no output and exit 2, which looks like a broken script rather than a
# missing line in .env.
DB_USER="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2 || true)"
DB_USER="${DB_USER:-havale}"
TEST_DB="restore_check_$$"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  FILE="$(ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[ -n "$FILE" ] || { echo "✗ no backup found in $BACKUP_DIR" >&2; exit 1; }
[ -f "$FILE" ] || { echo "✗ $FILE does not exist" >&2; exit 1; }

echo "→ verifying $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"

# A gzip that was truncated mid-write decompresses partially and restores
# partially — the counts below would look plausible and be wrong.
gunzip -t "$FILE" || { echo "✗ the archive is corrupt." >&2; exit 1; }
echo "  archive intact ✓"

cleanup() {
  docker compose exec -T db psql -U "$DB_USER" -q -c "DROP DATABASE IF EXISTS $TEST_DB;" postgres >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "→ restoring into a temporary database"
docker compose exec -T db psql -U "$DB_USER" -q -c "CREATE DATABASE $TEST_DB;" postgres
gunzip -c "$FILE" | docker compose exec -T db psql -U "$DB_USER" -q "$TEST_DB" >/dev/null

echo "→ what came back:"
FAILED=0
for table in User Havale Subscription ContactReveal ViolationReport Ticket CarModel; do
  n="$(docker compose exec -T db psql -U "$DB_USER" -tAc \
        "SELECT count(*) FROM \"$table\";" "$TEST_DB" 2>/dev/null || echo MISSING)"
  printf '   %-18s %s\n' "$table" "$n"
  # User and CarModel can never legitimately be empty: without an
  # administrator nobody can sign in, and without the catalogue nobody can
  # post. Zero in either means the dump is not a usable restore point.
  case "$table" in
    User|CarModel) [ "$n" != "0" ] && [ "$n" != "MISSING" ] || FAILED=1 ;;
  esac
done

echo
if [ "$FAILED" = "0" ]; then
  echo "✓ this backup restores. Verified $(date '+%Y-%m-%d %H:%M')."
else
  echo "✗ the backup restored but is missing data that cannot legitimately be empty." >&2
  echo "  Do not rely on it. Check /var/log/feranocar-backup.log." >&2
  exit 1
fi

echo
echo "If you ever need the real thing, on a machine with the stack running:"
echo "  cd /opt/feranocar"
echo "  docker compose stop api"
echo "  gunzip -c $FILE | docker compose exec -T db psql -U $DB_USER ${POSTGRES_DB:-havale}"
echo "  docker compose start api"
echo "(the dump carries --clean, so it replaces what is there)"
