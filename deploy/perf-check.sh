#!/usr/bin/env bash
#
# Why does it feel slow? — measured, not guessed.
#
# «The site feels slower» has four possible answers and they need different
# fixes: the browser is fetching too much, the API is slow, the database is
# slow, or the network between the user and the server is slow. This prints
# enough to tell them apart in under a minute.
#
#   ./deploy/perf-check.sh --accounts-file /root/.feranocar-loadtest
#   ./deploy/perf-check.sh --url https://feranocar.com
#
# Read-only: it fetches pages and reads container stats. Signing in does end
# any other session on that account, because the system allows one at a time.
set -euo pipefail

cd "$(dirname "$0")/.."

URL=""
ACCOUNTS_FILE=""
ACCOUNT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --accounts-file) ACCOUNTS_FILE="$2"; shift 2 ;;
    --account) ACCOUNT="$2"; shift 2 ;;
    -h|--help)
      echo "استفاده: ./deploy/perf-check.sh [--url https://…] [--accounts-file مسیر] [--account نام]"
      exit 0
      ;;
    *) echo "گزینه‌ی ناشناخته: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$URL" ]; then
  DOMAIN="$(grep -E '^BRAND_DOMAIN=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  URL="https://${DOMAIN:-feranocar.com}"
fi

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── 1. what the browser pulls ───────────────────────────────────────────────
#
# The first visit is the one people judge. These four are what it costs before
# a single row of data arrives.
say "─── آنچه مرورگر در بازدید اول می‌گیرد ───"
printf '  %-28s %8s %10s %9s %9s  %s\n' 'فایل' 'کد' 'حجم' 'اولین‌بایت' 'کل' 'فشرده'
for path in / /src/main.js /src/styles/app.css /assets/vazirmatn.woff2; do
  read -r code size ttfb total enc < <(
    curl -s -o /dev/null -H 'Accept-Encoding: gzip, br' \
      -w '%{http_code} %{size_download} %{time_starttransfer} %{time_total} %{content_type}\n' \
      "$URL$path" 2>/dev/null || echo '000 0 0 0 -'
  )
  gz="$(curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' "$URL$path" 2>/dev/null |
        grep -i '^content-encoding:' | tr -d '\r' | awk '{print $2}' || true)"
  printf '  %-28s %8s %9sK %8sms %8sms  %s\n' \
    "$path" "$code" "$((size / 1024))" \
    "$(awk "BEGIN{printf \"%.0f\", $ttfb * 1000}")" \
    "$(awk "BEGIN{printf \"%.0f\", $total * 1000}")" \
    "${gz:-—}"
done

MODULES="$(find frontend/src -name '*.js' 2>/dev/null | wc -l)"
BYTES="$(find frontend/src -name '*.js' -exec cat {} + 2>/dev/null | wc -c)"
echo "  ماژول‌های جاوااسکریپت: ${MODULES} فایل، $((BYTES / 1024)) کیلوبایت خام"
echo "  (هر کدام یک درخواست جداست. با HTTP/2 موازی می‌روند، ولی تعدادشان روی"
echo "   اتصال ضعیف حس می‌شود.)"

# ── 2. the API, through the real path ───────────────────────────────────────
say "─── API از همان مسیری که کاربر می‌آید ───"

CREDS=""
if [ -n "$ACCOUNTS_FILE" ] && [ -r "$ACCOUNTS_FILE" ]; then
  CREDS="$(grep -m1 ':' "$ACCOUNTS_FILE" || true)"
elif [ -n "$ACCOUNT" ]; then
  read -rsp "رمز «$ACCOUNT»: " PASS; echo
  CREDS="$ACCOUNT:$PASS"
  unset PASS
fi

if [ -z "$CREDS" ]; then
  echo "  بدون حساب، فقط سلامت اندازه‌گیری می‌شود. برای اندازه‌گیری کامل:"
  echo "  ./deploy/perf-check.sh --accounts-file /root/.feranocar-loadtest"
  PATHS=(/api/v1/health)
else
  USER_NAME="${CREDS%%:*}"
  PASSWORD="${CREDS#*:}"
  LOGIN="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASSWORD\"}" \
    "$URL/api/v1/auth/login" 2>/dev/null)"
  LOGIN="${LOGIN:-000}"
  unset PASSWORD
  if [ "$LOGIN" != "200" ]; then
    echo "  ورود «$USER_NAME» ناموفق بود ($LOGIN) — فقط سلامت اندازه‌گیری می‌شود."
    PATHS=(/api/v1/health)
  else
    echo "  ورود با «$USER_NAME» انجام شد."
    PATHS=(
      /api/v1/health
      /api/v1/auth/me
      /api/v1/subscriptions/me
      /api/v1/catalog
      "/api/v1/havales?limit=20"
      "/api/v1/havales/mine?limit=20"
    )
  fi
fi

printf '  %-34s %8s %9s %9s  %s\n' 'مسیر' 'کد' 'حجم' 'میانه' 'فشرده'
for path in "${PATHS[@]}"; do
  best=""; code=""; size=""
  # Five samples; the median is reported, because one cold request is not a
  # speed and one warm request is not either.
  times=()
  for _ in 1 2 3 4 5; do
    read -r code size total < <(
      curl -s -o /dev/null -b "$JAR" -H 'Accept-Encoding: gzip' \
        -w '%{http_code} %{size_download} %{time_total}\n' "$URL$path" 2>/dev/null ||
        echo '000 0 0'
    )
    times+=("$(awk "BEGIN{printf \"%.0f\", $total * 1000}")")
  done
  best="$(printf '%s\n' "${times[@]}" | sort -n | awk 'NR==3')"
  gz="$(curl -s -o /dev/null -D - -b "$JAR" -H 'Accept-Encoding: gzip' "$URL$path" 2>/dev/null |
        grep -i '^content-encoding:' | tr -d '\r' | awk '{print $2}' || true)"
  printf '  %-34s %8s %8sK %8sms  %s\n' "$path" "$code" "$((size / 1024))" "$best" "${gz:-—}"
done

# ── 3. the machine, right now ───────────────────────────────────────────────
say "─── وضعیت سرور در همین لحظه ───"
docker stats --no-stream --format '  {{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null |
  awk -F'|' '{printf "  %-24s CPU %7s   حافظه %s\n", $1, $2, $3}' || true

CONNS="$(docker compose exec -T db psql -U "${POSTGRES_USER:-havale}" -d "${POSTGRES_DB:-havale}" \
  -tAc 'select count(*) from pg_stat_activity where datname = current_database();' </dev/null 2>/dev/null || echo '?')"
SLOW="$(docker compose exec -T db psql -U "${POSTGRES_USER:-havale}" -d "${POSTGRES_DB:-havale}" \
  -tAc "select count(*) from pg_stat_activity where state = 'active' and now() - query_start > interval '2 seconds';" \
  </dev/null 2>/dev/null || echo '?')"
echo "  اتصال دیتابیس: ${CONNS} · کوئری بیش از ۲ ثانیه در حال اجرا: ${SLOW}"

RESTARTS="$(docker inspect -f '{{.RestartCount}}' feranocar-api-1 2>/dev/null)"
RESTARTS="${RESTARTS:-?}"
UP="$(docker inspect -f '{{.State.StartedAt}}' feranocar-api-1 2>/dev/null | cut -dT -f1,2 | cut -d. -f1)"
UP="${UP:-?}"
echo "  کانتینر API: ${RESTARTS} بار ری‌استارت · روشن از ${UP}"

# ── 4. the settings that decide all of the above ────────────────────────────
say "─── تنظیماتی که روی سرعت اثر دارند ───"
check() { # label, file, pattern
  if grep -q "$3" "$2" 2>/dev/null; then echo "  ✓ $1"; else echo "  ✗ $1 — در $2 نیست"; fi
}
LIVE="deploy/nginx/ssl.conf"
[ -f "$LIVE" ] || LIVE="deploy/nginx/app.conf"
check "HTTP/2 روشن است" "$LIVE" 'http2 on'
check "فشرده‌سازی برای پاسخ‌های پراکسی‌شده" "$LIVE" 'gzip_proxied'
check "اتصال پایدار به API (Connection \"\")" "$LIVE" 'Connection *""'
echo "  فایل زنده‌ی nginx: $LIVE"
echo "  WEB_CONCURRENCY: $(grep -E '^WEB_CONCURRENCY=' .env 2>/dev/null | cut -d= -f2- || echo '۱ (پیش‌فرض)')"

say "خواندن این جدول"
cat <<'HOW'
  · «اولین‌بایت» بالا برای / یعنی سرور دیر شروع می‌کند؛ «کل» بالا با حجم زیاد
    یعنی مسیر شبکه کند است، نه سرور.
  · ستون «فشرده» برای پاسخ‌های JSON و JS باید gzip باشد. اگر «—» است، پاسخ
    فشرده‌نشده می‌رود و روی اتصال ضعیف چند برابر طول می‌کشد.
  · اگر همه‌ی زمان‌های API زیر ۲۰۰ms است ولی سایت کند حس می‌شود، مشکل سمت
    سرور نیست — مسیر اینترنت کاربر یا حجم بارگذاری اول است.
HOW
