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
  # Newest of either shape. The full archive is what backup.sh writes now; the
  # bare dump is what an older install produced, and this script looked only
  # for that one — so on a server running the current backup it reported "no
  # backup found" while a directory full of good archives sat next to it.
  FILE="$(ls -1t "$BACKUP_DIR"/*/feranocar-full-*.tar.gz \
                 "$BACKUP_DIR"/feranocar-full-*.tar.gz \
                 "$BACKUP_DIR"/*/db-*.sql.gz \
                 "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[ -n "$FILE" ] || { echo "✗ no backup found in $BACKUP_DIR" >&2; exit 1; }
[ -f "$FILE" ] || { echo "✗ $FILE does not exist" >&2; exit 1; }

echo "→ verifying $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"

# A gzip that was truncated mid-write decompresses partially and restores
# partially — the counts below would look plausible and be wrong.
gunzip -t "$FILE" || { echo "✗ the archive is corrupt." >&2; exit 1; }
echo "  archive intact ✓"

UNPACK=""
cleanup() {
  docker compose exec -T db psql -U "$DB_USER" -q -c "DROP DATABASE IF EXISTS $TEST_DB;" postgres >/dev/null 2>&1 || true
  [ -n "$UNPACK" ] && rm -rf "$UNPACK"
}
trap cleanup EXIT

# Pull the dump out of the full archive, and check the other parts are there
# while we have it open. A backup missing .env restores a database whose phone
# numbers can never be read again — worth finding out now rather than then.
case "$FILE" in
  *.tar.gz)
    UNPACK="$(mktemp -d)"
    tar xzf "$FILE" -C "$UNPACK"
    DUMP="$UNPACK/database/database.sql"
    [ -f "$DUMP" ] || { echo "✗ the archive has no database/database.sql" >&2; exit 1; }

    echo "→ what the archive carries:"
    for part in \
      "config/.env:کلید رمزنگاری و رمزها" \
      "config/docker-compose.yml:تعریف سرویس‌ها" \
      "config/nginx:پیکربندی nginx" \
      "source/source.tar.gz:کد برنامه" \
      "certs/letsencrypt.tar.gz:گواهی TLS" \
      "system/os.txt:مشخصات سرور"
    do
      p="${part%%:*}"; label="${part#*:}"
      if [ -e "$UNPACK/$p" ]; then
        printf '   ✓ %-28s %s\n' "$p" "$label"
      else
        printf '   ✗ %-28s %s — نیست\n' "$p" "$label"
        # .env is the only one whose absence makes the restore unrecoverable
        # rather than merely inconvenient.
        [ "$p" = "config/.env" ] && { echo "✗ بدون .env، شماره‌های داخل این دامپ برای همیشه ناخوانا هستند." >&2; exit 1; }
      fi
    done
    echo
    ;;
  *)
    DUMP=""   # a bare .sql.gz, streamed below
    ;;
esac

echo "→ restoring into a temporary database"
docker compose exec -T db psql -U "$DB_USER" -q -c "CREATE DATABASE $TEST_DB;" postgres
if [ -n "$DUMP" ]; then
  docker compose exec -T db psql -U "$DB_USER" -q "$TEST_DB" < "$DUMP" >/dev/null
else
  gunzip -c "$FILE" | docker compose exec -T db psql -U "$DB_USER" -q "$TEST_DB" >/dev/null
fi

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
case "$FILE" in
  *.tar.gz)
    # `gunzip -c` on the full archive would pipe a tar stream into psql, which
    # fails in a confusing way. The dump has to come out of the archive first.
    echo "  mkdir -p /tmp/restore && tar xzf $FILE -C /tmp/restore"
    echo "  docker compose exec -T db psql -U $DB_USER ${POSTGRES_DB:-havale} < /tmp/restore/database/database.sql"
    echo "  (بقیه‌ی مراحل — کد، گواهی، کرون — در RESTORE.md داخل همین آرشیو)"
    ;;
  *)
    echo "  gunzip -c $FILE | docker compose exec -T db psql -U $DB_USER ${POSTGRES_DB:-havale}"
    ;;
esac
echo "  docker compose start api"
echo "(the dump carries --clean, so it replaces what is there)"
