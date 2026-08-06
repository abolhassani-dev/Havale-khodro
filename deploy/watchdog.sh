#!/usr/bin/env bash
#
# Notices that something is wrong before a user does — and fixes it if it can.
#
# Every outage this project has had announced itself as a blank page or a
# confusing error, minutes to hours after the actual cause. The cause was
# always visible on the server the whole time: a container not running, a full
# disk, a database refusing connections. This runs every few minutes, finds
# those, tries the restart a human would have tried, and puts what is left on a
# phone with the command that fixes it.
#
#   */5 * * * * root /opt/feranocar/deploy/watchdog.sh
#   0   9 * * * root /opt/feranocar/deploy/watchdog.sh --digest
#
# ── What it costs ────────────────────────────────────────────────────────────
#
# A run is a dozen local commands — docker inspect, df, free, one curl to
# localhost. No polling of anything remote, no daemon, no open connection. On a
# healthy server it sends nothing and finishes in about a second, which is why
# five minutes is a reasonable interval rather than an expensive one.
#
# ── What it will not do ──────────────────────────────────────────────────────
#
# Spam. One message per problem, one when it clears, a ceiling of twelve an
# hour, and a single daily digest. A phone that buzzes forty times gets muted,
# and a muted alerting channel is worse than none — because everybody still
# believes it is working.
#
set -uo pipefail   # not -e: a failing check must be reported, not fatal

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PROJECT_SLUG="${PROJECT_SLUG:-feranocar}"
STATE="/var/lib/${PROJECT_SLUG}/alerts"
ALERT_STATE="$STATE"

# shellcheck disable=SC1091
. "$ROOT/deploy/notify.sh"

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/${PROJECT_SLUG}}"
DIGEST=0
[ "${1:-}" = "--digest" ] && DIGEST=1

problems=0
_bad() { problems=$((problems + 1)); notify_problem "$@"; }

# ═════════════════════════════════════════════════════════════════════════════
# Repair, once, before waking anyone
#
# Most outages this stack can have are a container that stopped or a service
# that stopped answering, and both are cured by the same restart a human would
# type after being woken up. Waiting for that human is the expensive part: it
# is the difference between forty seconds of downtime and forty minutes.
#
# Bounded on purpose, because an unbounded self-heal is worse than none:
#
#   - One attempt per problem per hour. A service that crashes on startup would
#     otherwise be restarted every five minutes forever, which turns a visible
#     outage into a quiet flapping one and buries the alert.
#   - Only restarts. Nothing here deletes, migrates, or reconfigures anything.
#   - Silence is not success. A heal that works still sends a message, because
#     "it fixed itself twice today" is exactly the signal that something is
#     wrong underneath and needs a real fix.
# ═════════════════════════════════════════════════════════════════════════════
heal() {
  local key="$1" category="$2" what="$3" recheck="$4"; shift 4
  local stamp="$STATE/heal-$key"
  local now; now="$(date +%s)"

  if [ -f "$stamp" ]; then
    local last; last="$(cat "$stamp" 2>/dev/null || echo 0)"
    if [ $((now - last)) -lt 3600 ]; then
      echo "[$(date '+%F %T')] $what: already attempted a repair within the hour"
      return 1
    fi
  fi
  echo "$now" > "$stamp"

  echo "[$(date '+%F %T')] $what: attempting repair — $*"
  "$@" >/dev/null 2>&1

  local i
  for i in 1 2 3 4 5 6; do
    sleep 5
    if eval "$recheck" >/dev/null 2>&1; then
      echo "[$(date '+%F %T')] $what: recovered after repair"
      notify_raw "🟡 <b>خودکار برطرف شد: $what</b>
$(_category_label "$category") · <i>$(date '+%Y-%m-%d %H:%M')</i>

سرویس از کار افتاده بود و دیده‌بان خودش راه‌اندازی مجددش کرد.
اگر این پیام تکرار شد، یعنی علت اصلی هنوز سر جایش است:
<pre>docker compose logs $key --tail 100</pre>"
      return 0
    fi
  done

  echo "[$(date '+%F %T')] $what: repair did not help"
  return 1
}

# ═════════════════════════════════════════════════════════════════════════════
# ⚙️ Application — containers and the API
# ═════════════════════════════════════════════════════════════════════════════

for service in db api web; do
  state="$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$service" '$1==s{print $2}')"
  if [ "$state" = "running" ]; then
    notify_clear "container-$service" app "سرویس $service"
  elif heal "$service" app "سرویس $service" \
         "docker compose ps --format '{{.Service}} {{.State}}' | grep -q '^$service running'" \
         docker compose up -d "$service"; then
    notify_clear "container-$service" app "سرویس $service"
  else
    _bad "container-$service" app \
      "سرویس $service بالا نیست" \
      "وضعیت: ${state:-وجود ندارد}" \
      "cd $ROOT && docker compose logs $service --tail 50
یک بار خودکار start شد و نماند — احتمالاً موقع بالا آمدن می‌میرد."
  fi
done

# No `|| echo 000`: -w prints the code even when the request fails, so the
# fallback appended a second one and the alert read «پاسخ: HTTP 000000».
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost/api/v1/health 2>/dev/null)"
code="${code:-000}"
if [ "$code" = "200" ]; then
  notify_clear "api-health" app "سلامت API"
elif heal "api" app "سلامت API" \
       "curl -fsS --max-time 10 http://localhost/api/v1/health" \
       docker compose restart api; then
  notify_clear "api-health" app "سلامت API"
else
  _bad "api-health" app \
    "API جواب نمی‌دهد" \
    "پاسخ: HTTP $code" \
    "docker compose logs api --tail 50
اگر migration گیر کرده باشد، در لاگ پیداست — ری‌استارت تنهایی حلش نمی‌کند."
fi

# A container that keeps dying and coming back reports "running" every time it
# is checked, and is the failure that hides best.
loops=""
for cid in $(docker compose ps -q 2>/dev/null); do
  n="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null)"
  [ "${n:-0}" -ge 5 ] 2>/dev/null && loops="$loops $(docker inspect -f '{{.Name}}' "$cid" | tr -d '/')($n)"
done
if [ -n "$loops" ]; then
  _bad "restart-loop" app "کانتینر در حلقه‌ی ری‌استارت" "$loops" \
    "docker compose logs --tail 80
ری‌استارت خودکار اینجا کمکی نمی‌کند — علت موقع بالا آمدن است."
else
  notify_clear "restart-loop" app "حلقه‌ی ری‌استارت"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 🗄️ Database
# ═════════════════════════════════════════════════════════════════════════════

# A container in state `running` whose Postgres is refusing connections is the
# failure that looks healthiest from outside.
if docker compose exec -T db pg_isready -q 2>/dev/null; then
  notify_clear "db-connections" database "اتصال به دیتابیس"

  used="$(docker compose exec -T db psql -U "${POSTGRES_USER:-havale}" -tAc \
          'SELECT count(*) FROM pg_stat_activity;' postgres 2>/dev/null | tr -d '[:space:]')"
  if [ "${used:-0}" -ge 80 ] 2>/dev/null; then
    _bad "db-connections-high" database "اتصال‌های دیتابیس رو به اتمام" "$used از ۱۰۰" \
      "SELECT pid, state, now()-query_start FROM pg_stat_activity ORDER BY 3 DESC LIMIT 10;"
  else
    notify_clear "db-connections-high" database "ظرفیت اتصال دیتابیس"
  fi
elif heal "db" database "اتصال به دیتابیس" \
       "docker compose exec -T db pg_isready -q" \
       docker compose restart db; then
  notify_clear "db-connections" database "اتصال به دیتابیس"
else
  _bad "db-connections" database \
    "دیتابیس جواب نمی‌دهد و ری‌استارت خودکار هم درستش نکرد" \
    "کانتینر بالاست ولی pg_isready رد می‌کند." \
    "docker compose logs db --tail 50
اگر «out of memory» بود: docker stats --no-stream
اگر «No space left» بود: df -h"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 🖥️ Server — disk, memory, swap
# ═════════════════════════════════════════════════════════════════════════════

# A full disk stops Postgres from writing and takes everything down with it.
# Eighty-five percent is the point at which there is still time to act.
usage="$(df -P "$ROOT" | awk 'NR==2{print $5}' | tr -d '%')"
if [ "${usage:-0}" -ge 85 ]; then
  _bad "disk" server "دیسک در حال پر شدن است (${usage}%)" "$(df -h "$ROOT" | tail -1)" \
    "بکاپ‌های قدیمی: ls -lt $BACKUP_ROOT/*/ | tail -20
فضای داکر: docker system df
پاک‌سازی امن: docker image prune -f"
else
  notify_clear "disk" server "فضای دیسک"
fi

# Inodes run out independently of bytes, and when they do everything fails with
# "No space left on device" while df shows plenty of room.
inodes="$(df -Pi "$ROOT" 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')"
if [ "${inodes:-0}" -ge 90 ] 2>/dev/null; then
  _bad "inodes" server "inodeها ${inodes}% مصرف شده‌اند" "دیسک جا دارد ولی فایل جدید ساخته نمی‌شود" \
    "du --inodes -x -d 3 / 2>/dev/null | sort -rn | head"
else
  notify_clear "inodes" server "inodeها"
fi

# Postgres is usually the biggest process, so the kernel's OOM killer usually
# picks it — which is exactly the "database went away for no reason" everyone
# eventually meets.
mem_free_pct="$(free | awk '/^Mem:/{printf "%d", $7*100/$2}')"
if [ "${mem_free_pct:-100}" -le 8 ]; then
  _bad "memory" server "حافظه‌ی سرور تقریباً تمام شده (${mem_free_pct}% آزاد)" "$(free -h | head -2)" \
    "پرمصرف‌ترین کانتینر: docker stats --no-stream
کرنل در این حالت معمولاً Postgres را می‌کشد."
else
  notify_clear "memory" server "حافظه"
fi

# Swap filling up means main memory already ran short and the kernel has not
# been able to page it back.
swap_used_pct="$(free | awk '/^Swap:/{ if ($2>0) printf "%d", $3*100/$2; else print 0 }')"
if [ "${swap_used_pct:-0}" -ge 75 ] 2>/dev/null; then
  _bad "swap" server "${swap_used_pct}% از swap مصرف شده" "حافظه‌ی اصلی کم آمده است" \
    "docker stats --no-stream — اگر ادامه دارد، رم سرور را افزایش دهید."
else
  notify_clear "swap" server "swap"
fi

# ═════════════════════════════════════════════════════════════════════════════
# 🔐 Certificate
# ═════════════════════════════════════════════════════════════════════════════

if [ -f deploy/nginx/ssl.conf ]; then
  domain="$(grep -E '^BRAND_DOMAIN=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r')"
  days="$(echo | openssl s_client -connect localhost:443 -servername "${domain:-localhost}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 \
    | { read -r d; [ -n "$d" ] && echo $(( ($(date -d "$d" +%s) - $(date +%s)) / 86400 )) || echo ""; })"
  if [ -n "$days" ] && [ "$days" -lt 20 ]; then
    _bad "cert" cert "گواهی SSL تا $days روز دیگر منقضی می‌شود" \
      "تمدید خودکار از ۳۰ روز مانده شروع می‌شود — یعنی حداقل دو بار شکست خورده." \
      "cd $ROOT && docker compose run --rm --entrypoint certbot certbot renew --dry-run
و لاگ تمدید: tail -50 /var/log/${PROJECT_SLUG}-certbot.log"
  else
    notify_clear "cert" cert "گواهی SSL"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# 💾 Backup
# ═════════════════════════════════════════════════════════════════════════════

newest="$(ls -1t "$BACKUP_ROOT"/*/*.tar.gz "$BACKUP_ROOT"/*.tar.gz "$BACKUP_ROOT"/*.sql.gz 2>/dev/null | head -1)"
if [ -z "$newest" ]; then
  _bad "backup-none" backup "هیچ بکاپی وجود ندارد" "$BACKUP_ROOT خالی است" \
    "$ROOT/deploy/backup.sh daily"
else
  notify_clear "backup-none" backup "وجود بکاپ"

  age_h=$(( ($(date +%s) - $(date -r "$newest" +%s)) / 3600 ))
  if [ "$age_h" -gt 30 ]; then
    _bad "backup-stale" backup "بیش از $age_h ساعت است بکاپ گرفته نشده" "آخرین: $(basename "$newest")" \
      "tail -30 /var/log/${PROJECT_SLUG}-backup.log
و دستی: $ROOT/deploy/backup.sh daily"
  else
    notify_clear "backup-stale" backup "تازگی بکاپ"
  fi

  # An archive that cannot be decompressed is not a backup, and gzip finds that
  # out in under a second. Nobody checks otherwise until the day it matters.
  if gunzip -t "$newest" 2>/dev/null; then
    notify_clear "backup-corrupt" backup "سلامت آرشیو بکاپ"
  else
    _bad "backup-corrupt" backup "آخرین آرشیو بکاپ خراب است" "$(basename "$newest")" \
      "$ROOT/deploy/backup.sh daily && rm '$newest'"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# Daily digest
#
# One message a day, whether or not anything is wrong — because a channel that
# only ever speaks when there is trouble is indistinguishable from a channel
# that has stopped working. This is how you know the bot is still alive, and it
# is the only message that arrives on a good day.
# ═════════════════════════════════════════════════════════════════════════════

if [ "$DIGEST" = "1" ]; then
  open="$(notify_open_problems)"
  suppressed="$(notify_suppressed_count)"

  backup_line="—"
  if [ -n "$newest" ]; then
    backup_line="$(basename "$newest") · $(du -h "$newest" | cut -f1) · ${age_h}h پیش"
  fi

  cert_line="—"
  [ -n "${days:-}" ] && cert_line="${days} روز اعتبار"

  running="$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -c 'running')"
  offsite="$(grep -E '^BACKUP_(RCLONE_REMOTE|SCP_TARGET)=' .env 2>/dev/null | cut -d= -f2- | grep -c .)"

  notify_raw "$([ -z "$open" ] && echo '🟢' || echo '🟠') <b>گزارش روزانه‌ی فرانوکار</b>
<i>$(date '+%Y-%m-%d %H:%M')</i>

⚙️ سرویس‌ها: <b>${running}</b> در حال اجرا
🗄️ دیتابیس: $(docker compose exec -T db pg_isready -q 2>/dev/null && echo 'پاسخ‌گو' || echo '<b>بی‌پاسخ</b>')
🖥️ دیسک: <b>${usage}%</b> · حافظه‌ی آزاد: <b>${mem_free_pct}%</b> · swap: <b>${swap_used_pct}%</b>
🔐 گواهی: ${cert_line}
💾 بکاپ: ${backup_line}
📤 نسخه‌ی بیرون از سرور: $([ "$offsite" -gt 0 ] && echo 'تنظیم شده' || echo '<b>تنظیم نشده</b>')

$([ -z "$open" ] && echo 'هیچ مشکل بازی وجود ندارد.' || echo "⚠️ مشکلات باز: <code>${open}</code>")
$([ "$suppressed" -gt 0 ] && echo "
<i>${suppressed} پیام به‌خاطر سقف ساعتی ارسال نشد.</i>")"

  echo "[$(date '+%F %T')] digest sent"
  exit 0
fi

if [ "$problems" = "0" ]; then
  echo "[$(date '+%F %T')] all checks passed"
fi
exit 0
