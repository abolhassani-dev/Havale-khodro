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
#
# ── What is in the archive, and why it is laid out this way ──────────────────
#
#   database/   the SQL dump
#   config/     .env, compose file, nginx, cron — the settings that make this
#               server this server
#   certs/      the TLS certificate
#   source/     the application code, exactly as it is running
#   system/     the machine around it: OS, packages, firewall, docker, disk
#   MANIFEST.txt  what is inside and how big, readable without extracting
#   RESTORE.md    the steps, so a future reader is not reverse-engineering this
#
# Every archive is self-contained on purpose. It would be cheaper to store the
# source once and have the hourly copies point at it — the code only changes on
# deploy — but then restoring means finding two files instead of one, and the
# moment you are restoring is the worst moment to discover that the second one
# was never copied off-site. The source adds about 13MB to each archive; the
# full retention is roughly 1.2GB, which is a percent of this disk. Paying that
# to keep every archive independently sufficient is the right trade.
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

mkdir -p "$WORK/database" "$WORK/config/nginx" "$WORK/config/cron" "$WORK/certs" \
         "$WORK/source" "$WORK/system"

# ---- 1. the database ----
echo "  database"
docker compose exec -T db pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" > "$WORK/database/database.sql"
# A dump that failed halfway still leaves a file. pg_dump always ends with this
# line, so its absence means the archive would have been a lie.
tail -5 "$WORK/database/database.sql" | grep -q "PostgreSQL database dump complete" || {
  echo "✗ the dump is incomplete — refusing to write a backup that cannot restore." >&2
  exit 1
}

# ---- 2. the secrets and the configuration ----
#
# .env carries DATA_ENCRYPTION_KEY. Without it the dump above is a table of
# ciphertext — the backup would restore and every contact number would be gone.
echo "  configuration"
cp .env "$WORK/config/.env"
cp docker-compose.yml "$WORK/config/"
cp -r deploy/nginx/. "$WORK/config/nginx/" 2>/dev/null || true

# ---- 2b. ticket attachments ----
#
# The database rows point at files on a named volume. Restoring the dump
# without them gives back conversations whose evidence — the screenshot of the
# error, the payment receipt — is gone, and nothing in the panel would say why.
echo "  attachments"
mkdir -p "$WORK/uploads"
# The existence check is not politeness — `docker run -v name:/path` *creates*
# a missing named volume, empty and owned by root. On the first deploy of this
# feature the backup ran before compose did exactly that, compose then mounted
# the root-owned volume into a container that runs as a non-root user, and the
# API died in a restart loop unable to create a folder. A backup must never
# bring anything into existence.
if docker volume inspect feranocar_uploads >/dev/null 2>&1; then
  docker run --rm -v feranocar_uploads:/uploads:ro -v "$WORK/uploads:/out" alpine:3 \
    sh -c 'tar czf /out/uploads.tar.gz -C /uploads . 2>/dev/null || true' >/dev/null 2>&1 || \
    echo "    (could not read the volume — skipping)"
else
  echo "    (no attachments volume yet — skipping)"
fi

# ---- 3. the TLS certificate ----
#
# Re-issuing is possible but rate-limited to five a week per domain, and the
# day you are restoring is the day you cannot afford to discover that.
echo "  certificates"
docker run --rm -v feranocar_certbot-certs:/certs:ro -v "$WORK/certs:/out" alpine:3 \
  sh -c 'tar czf /out/letsencrypt.tar.gz -C /certs . 2>/dev/null || true' >/dev/null 2>&1 || \
  echo "    (none yet — skipping)"

# ---- 4. the cron jobs ----
echo "  schedules"
cp /etc/cron.d/feranocar-* "$WORK/config/cron/" 2>/dev/null || true
cp /usr/local/bin/feranocar-backup "$WORK/config/" 2>/dev/null || true
crontab -l > "$WORK/config/cron/root-crontab.txt" 2>/dev/null || true

# ---- 5. the application source ----
#
# Restoring used to mean fetching the code from GitHub again. That works right
# up until it does not: a repository that was made private, a branch that was
# renamed, an account nobody can sign into any more, or simply no internet on
# the machine you are rebuilding onto. The code that was *running* is part of
# the system, so it belongs in the copy of the system.
#
# node_modules is excluded because `npm ci` reproduces it from the lockfile,
# which is included — 200MB of the 225MB tree, for nothing.
echo "  source"
tar czf "$WORK/source/source.tar.gz" \
  --exclude='./node_modules' --exclude='*/node_modules' \
  --exclude='./.git' \
  --exclude='./coverage' --exclude='*/coverage' \
  --exclude='./.env' \
  -C "$ROOT" . 2>/dev/null || true

# ---- 6. the machine around it ----
#
# Not needed to restore onto an identical server, and exactly what you want
# when you are rebuilding onto a different one and cannot remember which
# firewall ports were open or which docker volumes existed.
echo "  system"
{
  echo "== os =="; cat /etc/os-release 2>/dev/null
  echo; echo "== kernel =="; uname -a
  echo; echo "== timezone =="; timedatectl 2>/dev/null || cat /etc/timezone 2>/dev/null
  echo; echo "== memory / swap =="; free -h; swapon --show 2>/dev/null
  echo; echo "== disk =="; df -h
} > "$WORK/system/os.txt" 2>&1 || true
ufw status verbose > "$WORK/system/firewall.txt" 2>&1 || true
{
  docker --version; docker compose version
  echo; echo "== containers =="; docker compose ps
  echo; echo "== volumes =="; docker volume ls
  echo; echo "== limits =="
  for cid in $(docker compose ps -q 2>/dev/null); do
    docker inspect -f '{{.Name}} mem={{.HostConfig.Memory}} restart={{.HostConfig.RestartPolicy.Name}}' "$cid"
  done
} > "$WORK/system/docker.txt" 2>&1 || true
dpkg -l > "$WORK/system/packages.txt" 2>&1 || true

# ---- 7. a restore note, so a future reader is not reverse-engineering this ----
cat > "$WORK/RESTORE.md" <<'NOTE'
# بازگردانی روی یک سرور تازه

این آرشیو خودکفاست: دیتابیس، تنظیمات، گواهی، **و خود کد**. برای بازگردانی به
اینترنت یا به گیت‌هاب نیازی نیست.

## ساختار

    database/   دامپ SQL
    config/     ‎.env، docker-compose، nginx، کرون
    certs/      گواهی TLS
    source/     کد برنامه، دقیقاً همان نسخه‌ای که در حال اجرا بود
    system/     سیستم‌عامل، بسته‌ها، فایروال، داکر، دیسک

## مراحل

۱. داکر را نصب کنید (گام ۲ سند docs/deployment.md). بقیه‌ی مراحل سند لازم نیست —
   چون کد و تنظیمات همین‌جا هستند.

۲. آرشیو را باز کنید و کد را سر جایش بگذارید:

    tar xzf feranocar-full-*.tar.gz
    mkdir -p /opt/feranocar
    tar xzf source/source.tar.gz -C /opt/feranocar

۳. تنظیمات:

    cp config/.env         /opt/feranocar/.env
    chmod 600              /opt/feranocar/.env
    cp -r config/nginx/.   /opt/feranocar/deploy/nginx/
    chmod 644              /opt/feranocar/deploy/nginx/.htpasswd

   ⚠️ فایل ‎.env حاوی DATA_ENCRYPTION_KEY است. بدون همین کلید، شماره‌های تماسِ
   داخل دامپ برای همیشه ناخواناست. هیچ راه بازیابی دیگری وجود ندارد.

۴. گواهی TLS (اگر در آرشیو هست):

    docker volume create feranocar_certbot-certs
    docker run --rm -v feranocar_certbot-certs:/certs -v "$PWD/certs:/in" alpine:3 \
      sh -c 'tar xzf /in/letsencrypt.tar.gz -C /certs'

۵. بالا آوردن و بازگردانی دیتابیس:

    cd /opt/feranocar && docker compose up -d db
    sleep 10
    docker compose exec -T db psql -U havale havale < /path/to/database/database.sql
    docker compose up -d --build

۶. کرون‌ها:

    cp config/cron/feranocar-* /etc/cron.d/ && chmod 644 /etc/cron.d/feranocar-*
    cp config/feranocar-backup /usr/local/bin/ && chmod 700 /usr/local/bin/feranocar-backup

۷. فایروال و swap را از روی system/firewall.txt و system/os.txt دوباره بسازید.

۸. رکورد DNS دامنه را به آی‌پی سرور جدید ببرید.

۹. بررسی نهایی: ‎./deploy/preflight.sh
NOTE

# ---- 8. a manifest, so the contents are visible without unpacking ----
#
# `tar tzf` on a 13MB archive over a slow link, just to answer "does this one
# have the certificate in it", is the kind of small friction that stops people
# checking their backups at all.
{
  echo "FeranoCar backup"
  echo "tier:      $TIER"
  echo "taken:     $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "host:      $(hostname)"
  echo
  echo "contents:"
  ( cd "$WORK" && find . -type f -printf '  %-46p %10s bytes\n' 2>/dev/null | sort ) || true
  echo
  echo "database:"
  echo "  tables:  $(docker compose exec -T db psql -U "$DB_USER" -tAc \
                     "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" \
                     "$DB_NAME" 2>/dev/null | tr -d '[:space:]')"
  echo "  users:   $(docker compose exec -T db psql -U "$DB_USER" -tAc \
                     'SELECT count(*) FROM "User";' "$DB_NAME" 2>/dev/null | tr -d '[:space:]')"
  echo "  havales: $(docker compose exec -T db psql -U "$DB_USER" -tAc \
                     'SELECT count(*) FROM "Havale";' "$DB_NAME" 2>/dev/null | tr -d '[:space:]')"
} > "$WORK.manifest" 2>&1 || true
# Written outside $WORK and moved in, because a manifest generated by listing
# the directory it is being written into records itself at whatever length it
# had reached mid-write — the one line in the file guaranteed to be wrong.
mv "$WORK.manifest" "$WORK/MANIFEST.txt"

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
