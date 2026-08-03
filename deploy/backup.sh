#!/usr/bin/env bash
#
# A backup you can rebuild the whole server from.
#
# The database alone is not a restore. On a fresh machine you would still be
# missing the encryption key — without which every phone number in that dump is
# unreadable — plus the TLS certificate, the database-panel password, and the
# nginx mode that decides whether HTTPS is on. Each is small, each lives outside
# the dump, and each is discovered to be missing at the worst possible moment.
#
#   deploy/backup.sh hourly     # kept 48 hours
#   deploy/backup.sh daily      # kept 30 days
#   deploy/backup.sh weekly     # kept 12 weeks
#
# Retention is per tier, so an hourly rotation can never age out the daily
# copies. Off-site transfer runs afterwards if configured — see OFFSITE below.
set -euo pipefail

TIER="${1:-daily}"
case "$TIER" in
  hourly) KEEP=48 ;;
  daily)  KEEP=30 ;;
  weekly) KEEP=12 ;;
  *) echo "Usage: $0 [hourly|daily|weekly]" >&2; exit 1 ;;
esac

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/feranocar}"
DEST="$BACKUP_ROOT/$TIER"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$DEST"

DB_USER="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2 || true)"
DB_NAME="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2 || true)"
DB_USER="${DB_USER:-havale}"
DB_NAME="${DB_NAME:-havale}"

echo "→ $TIER backup $STAMP"

# ---- 1. the database ----
echo "  database"
docker compose exec -T db pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" > "$WORK/database.sql"
# A dump that failed halfway still leaves a file. pg_dump always ends with this
# line, so its absence means the archive would have been a lie.
tail -5 "$WORK/database.sql" | grep -q "PostgreSQL database dump complete" || {
  echo "✗ the dump is incomplete — refusing to write a backup that cannot restore." >&2
  exit 1
}

# ---- 2. the secrets and the configuration ----
#
# .env carries DATA_ENCRYPTION_KEY. Without it the dump above is a table of
# ciphertext — the backup would restore and every contact number would be gone.
echo "  configuration"
mkdir -p "$WORK/config/nginx"
cp .env "$WORK/config/.env"
cp docker-compose.yml "$WORK/config/"
cp -r deploy/nginx/. "$WORK/config/nginx/" 2>/dev/null || true

# ---- 3. the TLS certificate ----
#
# Re-issuing is possible but rate-limited to five a week per domain, and the
# day you are restoring is the day you cannot afford to discover that.
echo "  certificates"
docker run --rm -v feranocar_certbot-certs:/certs:ro -v "$WORK:/out" alpine:3 \
  sh -c 'tar czf /out/letsencrypt.tar.gz -C /certs . 2>/dev/null || true' >/dev/null 2>&1 || \
  echo "    (none yet — skipping)"

# ---- 4. the cron jobs ----
echo "  schedules"
mkdir -p "$WORK/config/cron"
cp /etc/cron.d/feranocar-* "$WORK/config/cron/" 2>/dev/null || true
cp /usr/local/bin/feranocar-backup "$WORK/config/" 2>/dev/null || true

# ---- 5. a restore note, so a future reader is not reverse-engineering this ----
cat > "$WORK/RESTORE.md" <<'NOTE'
# بازگردانی روی یک سرور تازه

۱. گام‌های ۱ تا ۳ سند docs/deployment.md (کلید SSH، داکر، آوردن کد در /opt/feranocar)

۲. این آرشیو را باز کنید و تنظیمات را سر جایشان بگذارید:

    tar xzf feranocar-full-*.tar.gz
    cp config/.env              /opt/feranocar/.env
    chmod 600                   /opt/feranocar/.env
    cp -r config/nginx/.        /opt/feranocar/deploy/nginx/
    chmod 644                   /opt/feranocar/deploy/nginx/.htpasswd

   ⚠️ فایل .env حاوی DATA_ENCRYPTION_KEY است. بدون همین کلید، شماره‌های تماسِ
   داخل دامپ برای همیشه ناخواناست. هیچ راه بازیابی دیگری وجود ندارد.

۳. گواهی TLS (اگر در آرشیو هست):

    docker volume create feranocar_certbot-certs
    docker run --rm -v feranocar_certbot-certs:/certs -v "$PWD:/in" alpine:3 \
      sh -c 'tar xzf /in/letsencrypt.tar.gz -C /certs'

۴. بالا آوردن و بازگردانی دیتابیس:

    cd /opt/feranocar && docker compose up -d db
    sleep 10
    docker compose exec -T db psql -U havale havale < /path/to/database.sql
    docker compose up -d

۵. کرون‌ها:

    cp config/cron/* /etc/cron.d/ && chmod 644 /etc/cron.d/feranocar-*
    cp config/feranocar-backup /usr/local/bin/ && chmod 700 /usr/local/bin/feranocar-backup

۶. رکورد DNS دامنه را به آی‌پی سرور جدید ببرید.

۷. بررسی: deploy/verify-backup.sh و بعد ورود از مرورگر.
NOTE

# ---- 6. one archive ----
OUT="$DEST/feranocar-full-$STAMP.tar.gz"
tar czf "$OUT" -C "$WORK" .
chmod 600 "$OUT"

# ---- 7. retention, per tier ----
ls -1t "$DEST"/feranocar-full-*.tar.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm --

echo "  → $OUT ($(du -h "$OUT" | cut -f1))"

# ---- 8. off-site ----
#
# A backup on the machine it protects is not a backup. Configure one of these
# in .env; without either, this step is skipped and says so, because a silent
# skip is how people end up believing they have copies they do not have.
OFFSITE_RCLONE="$(grep -E '^BACKUP_RCLONE_REMOTE=' .env 2>/dev/null | cut -d= -f2- || true)"
OFFSITE_SCP="$(grep -E '^BACKUP_SCP_TARGET=' .env 2>/dev/null | cut -d= -f2- || true)"

if [ -n "$OFFSITE_RCLONE" ] && command -v rclone >/dev/null 2>&1; then
  echo "  off-site → $OFFSITE_RCLONE"
  rclone copy "$OUT" "$OFFSITE_RCLONE/$TIER/" --no-traverse || echo "    ✗ rclone failed"
elif [ -n "$OFFSITE_SCP" ]; then
  echo "  off-site → $OFFSITE_SCP"
  scp -q -o BatchMode=yes "$OUT" "$OFFSITE_SCP/" || echo "    ✗ scp failed"
else
  echo "  ⚠ no off-site destination configured — this copy only exists on this server."
fi
