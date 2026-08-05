#!/usr/bin/env bash
#
# Notices that something is wrong before a user does.
#
# Every outage this project has had announced itself as a blank page or a
# confusing error, minutes to hours after the actual cause. The cause was
# always visible on the server the whole time: a container not running, a full
# disk, a database refusing connections. This runs every few minutes, finds
# those, and puts them on a phone with the command that fixes each one.
#
# Alerts are deduplicated by cron's own schedule plus a state file, so a
# problem that lasts an hour is one message, not twelve.
#
#   */5 * * * * root /opt/feranocar/deploy/watchdog.sh
#
set -uo pipefail   # not -e: a failing check must be reported, not fatal

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STATE="/var/lib/feranocar-watchdog"
mkdir -p "$STATE"

TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' .env 2>/dev/null | cut -d= -f2- || true)"
CHAT="$(grep -E '^TELEGRAM_CHAT_ID=' .env 2>/dev/null | cut -d= -f2- || true)"

problems=0

# Sends once per problem, and once more when it clears. A monitor that repeats
# itself every five minutes gets muted, and a muted monitor is not a monitor.
alert() {
  local key="$1" title="$2" detail="$3" help="$4"
  local flag="$STATE/$key"

  if [ -f "$flag" ]; then return; fi
  : > "$flag"
  problems=$((problems + 1))

  echo "[$(date '+%F %T')] $title — $detail"
  [ -n "$TOKEN" ] && [ -n "$CHAT" ] || return 0

  curl -sS --max-time 10 -o /dev/null \
    -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
    -d "chat_id=$CHAT" \
    -d "parse_mode=HTML" \
    --data-urlencode "text=🔴 <b>$title</b>
<i>فرانوکار · $(date '+%Y-%m-%d %H:%M')</i>

<pre>$detail</pre>

🔧 <b>راه‌حل:</b>
$help" || true
}

clear_alert() {
  local key="$1" title="$2"
  local flag="$STATE/$key"
  [ -f "$flag" ] || return 0
  rm -f "$flag"

  echo "[$(date '+%F %T')] recovered: $title"
  [ -n "$TOKEN" ] && [ -n "$CHAT" ] || return 0
  curl -sS --max-time 10 -o /dev/null \
    -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
    -d "chat_id=$CHAT" -d "parse_mode=HTML" \
    --data-urlencode "text=🟢 <b>برطرف شد: $title</b>
<i>$(date '+%Y-%m-%d %H:%M')</i>" || true
}

# ---- 1. every container that should be running ----
for service in db api web; do
  state="$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$service" '$1==s{print $2}')"
  if [ "$state" != "running" ]; then
    alert "container-$service" \
      "سرویس $service بالا نیست" \
      "وضعیت: ${state:-وجود ندارد}" \
      "cd /opt/feranocar && docker compose up -d $service
سپس علت را ببینید: docker compose logs $service --tail 50"
  else
    clear_alert "container-$service" "سرویس $service"
  fi
done

# ---- 2. the database answers, not just runs ----
#
# A container in state `running` whose Postgres is refusing connections is the
# failure that looks healthiest from outside.
if docker compose exec -T db pg_isready -q 2>/dev/null; then
  clear_alert "db-connections" "اتصال به دیتابیس"
else
  alert "db-connections" \
    "دیتابیس به اتصال جواب نمی‌دهد" \
    "کانتینر بالاست ولی pg_isready رد می‌کند." \
    "docker compose logs db --tail 50
اگر «out of memory» بود، مصرف حافظه را ببینید: docker stats --no-stream
اگر «No space left» بود: df -h"
fi

# ---- 3. the application answers ----
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost/api/v1/health || echo 000)"
if [ "$code" = "200" ]; then
  clear_alert "api-health" "سلامت API"
else
  alert "api-health" \
    "API جواب نمی‌دهد" \
    "پاسخ: HTTP $code" \
    "docker compose logs api --tail 50
اگر migration گیر کرده: docker compose restart api"
fi

# ---- 4. disk ----
#
# A full disk stops Postgres from writing and takes everything down with it.
# Eighty-five percent is the point at which there is still time to act.
usage="$(df -P "$ROOT" | awk 'NR==2{print $5}' | tr -d '%')"
if [ "${usage:-0}" -ge 85 ]; then
  alert "disk" \
    "دیسک در حال پر شدن است (${usage}%)" \
    "$(df -h "$ROOT" | tail -1)" \
    "بکاپ‌های قدیمی: ls -lt /var/backups/feranocar/*/ | tail -20
فضای داکر: docker system df
پاک‌سازی امن: docker image prune -f"
else
  clear_alert "disk" "فضای دیسک"
fi

# ---- 5. memory ----
#
# Postgres is usually the biggest process, so the kernel's OOM killer usually
# picks it — which is exactly the "database went away for no reason" everyone
# eventually meets.
mem_free_pct="$(free | awk '/^Mem:/{printf "%d", $7*100/$2}')"
if [ "${mem_free_pct:-100}" -le 8 ]; then
  alert "memory" \
    "حافظه‌ی سرور تقریباً تمام شده (${mem_free_pct}% آزاد)" \
    "$(free -h | head -2)" \
    "پرمصرف‌ترین کانتینر: docker stats --no-stream
اگر ادامه دارد، منابع سرور را افزایش دهید — کرنل در این حالت معمولاً Postgres را می‌کشد."
else
  clear_alert "memory" "حافظه"
fi

# ---- 6. the certificate ----
if [ -f deploy/nginx/ssl.conf ]; then
  days="$(echo | openssl s_client -connect localhost:443 -servername feranocar.com 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 \
    | { read -r d; [ -n "$d" ] && echo $(( ($(date -d "$d" +%s) - $(date +%s)) / 86400 )) || echo ""; })"
  if [ -n "$days" ] && [ "$days" -lt 20 ]; then
    alert "cert" \
      "گواهی SSL تا $days روز دیگر منقضی می‌شود" \
      "تمدید خودکار از ۳۰ روز مانده شروع می‌شود — یعنی حداقل دو بار شکست خورده." \
      "cd /opt/feranocar && docker compose run --rm --entrypoint certbot certbot renew --dry-run
و لاگ تمدید: tail -50 /var/log/feranocar-certbot.log"
  else
    clear_alert "cert" "گواهی SSL"
  fi
fi

# ---- 7. backups are actually being taken ----
newest="$(ls -1t /var/backups/feranocar/*/*.tar.gz /var/backups/feranocar/*.sql.gz 2>/dev/null | head -1)"
if [ -n "$newest" ]; then
  age_h=$(( ($(date +%s) - $(date -r "$newest" +%s)) / 3600 ))
  if [ "$age_h" -gt 30 ]; then
    alert "backup-stale" \
      "بیش از $age_h ساعت است بکاپ گرفته نشده" \
      "آخرین: $newest" \
      "cat /var/log/feranocar-backup.log | tail -30
و دستی: /opt/feranocar/deploy/backup.sh daily"
  else
    clear_alert "backup-stale" "بکاپ"
  fi
fi

if [ "$problems" = "0" ]; then
  echo "[$(date '+%F %T')] all checks passed"
fi
exit 0
