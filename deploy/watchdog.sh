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

# Try to fix it once, then report what happened.
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
#   - Only restarts. Nothing here deletes, migrates, or reconfigures anything —
#     a repair that can lose data must be a person's decision.
#   - Silence is not success. A heal that works still sends a message, because
#     "it fixed itself twice today" is exactly the signal that something is
#     wrong underneath and needs a real fix.
#
# Returns 0 when the service is healthy afterwards.
heal() {
  local key="$1" what="$2" recheck="$3"; shift 3
  local stamp="$STATE/heal-$key"
  local now; now="$(date +%s)"

  if [ -f "$stamp" ]; then
    local last; last="$(cat "$stamp" 2>/dev/null || echo 0)"
    if [ $((now - last)) -lt 3600 ]; then
      echo "[$(date '+%F %T')] $what: already attempted a repair within the hour — not retrying"
      return 1
    fi
  fi
  echo "$now" > "$stamp"

  echo "[$(date '+%F %T')] $what: attempting repair — $*"
  "$@" >/dev/null 2>&1

  # Give it a moment to actually come up before judging it.
  local i
  for i in 1 2 3 4 5 6; do
    sleep 5
    if eval "$recheck" >/dev/null 2>&1; then
      echo "[$(date '+%F %T')] $what: recovered after repair"
      [ -n "$TOKEN" ] && [ -n "$CHAT" ] && curl -sS --max-time 10 -o /dev/null \
        -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
        -d "chat_id=$CHAT" -d "parse_mode=HTML" \
        --data-urlencode "text=🟡 <b>خودکار برطرف شد: $what</b>
<i>فرانوکار · $(date '+%Y-%m-%d %H:%M')</i>

سرویس از کار افتاده بود و دیده‌بان خودش راه‌اندازی مجددش کرد.
اگر این پیام تکرار شد، یعنی علت اصلی هنوز سر جایش است — لاگ را ببینید:
<pre>docker compose logs $key --tail 100</pre>" || true
      return 0
    fi
  done

  echo "[$(date '+%F %T')] $what: repair did not help"
  return 1
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
    # Start it before waking anyone. If that works, the outage is over in under
    # a minute and the message that arrives says so.
    if heal "$service" "سرویس $service" \
         "docker compose ps --format '{{.Service}} {{.State}}' | grep -q '^$service running'" \
         docker compose up -d "$service"; then
      clear_alert "container-$service" "سرویس $service"
    else
      alert "container-$service" \
        "سرویس $service بالا نیست و راه‌اندازی خودکار هم جواب نداد" \
        "وضعیت: ${state:-وجود ندارد}" \
        "cd /opt/feranocar && docker compose logs $service --tail 50
علت را همان‌جا ببینید — چون یک بار خودکار start شد و نماند، احتمالاً موقع بالا آمدن می‌میرد."
    fi
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
elif heal "db" "اتصال به دیتابیس" \
       "docker compose exec -T db pg_isready -q" \
       docker compose restart db; then
  clear_alert "db-connections" "اتصال به دیتابیس"
else
  alert "db-connections" \
    "دیتابیس جواب نمی‌دهد و ری‌استارت خودکار هم درستش نکرد" \
    "کانتینر بالاست ولی pg_isready رد می‌کند." \
    "docker compose logs db --tail 50
اگر «out of memory» بود، مصرف حافظه را ببینید: docker stats --no-stream
اگر «No space left» بود: df -h"
fi

# ---- 3. the application answers ----
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost/api/v1/health || echo 000)"
if [ "$code" = "200" ]; then
  clear_alert "api-health" "سلامت API"
elif heal "api" "سلامت API" \
       "curl -fsS --max-time 10 http://localhost/api/v1/health" \
       docker compose restart api; then
  clear_alert "api-health" "سلامت API"
else
  alert "api-health" \
    "API جواب نمی‌دهد و ری‌استارت خودکار هم جواب نداد" \
    "پاسخ: HTTP $code" \
    "docker compose logs api --tail 50
اگر migration گیر کرده باشد، در لاگ پیداست — ری‌استارت تنهایی حلش نمی‌کند."
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
