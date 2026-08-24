#!/usr/bin/env bash
#
# «جابه‌جا شدن بین صفحه‌ها کند شده» — کدام قسمتش؟
#
#   ./deploy/panel-check.sh --account admin
#   ./deploy/panel-check.sh --account admin --url https://feranocar.com
#
# perf-check.sh کنار این، همان سؤال را برای پنل نمایندگی و بار اول جواب می‌دهد.
# این یکی مخصوص شکایتِ «رفتن از صفحه‌ای به صفحه‌ی دیگر» است، و سه چیز را از هم
# جدا می‌کند که هر کدام درمان متفاوتی دارند:
#
#   ۱. سرور کند است            → «سرور» بالا
#   ۲. مسیر شبکه کند است       → «شبکه» بالا، «سرور» پایین
#   ۳. صفحه زیادی درخواست دارد → «تماس» زیاد، هر کدام سریع، جمعش کند
#
# ستون «سرور» از هدر X-Response-Time می‌آید که خود API می‌گذارد، پس تفاضلش با
# «کل» دقیقاً همان چیزی است که بین مرورگر و سرور گذشته.
#
# فقط می‌خواند. ورود، نشست دیگرِ همان حساب را می‌بندد — سامانه یک نشست بیشتر
# اجازه نمی‌دهد.
set -uo pipefail

cd "$(dirname "$0")/.."

URL=""
ACCOUNT=""
ROUNDS=5

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --account) ACCOUNT="$2"; shift 2 ;;
    --rounds) ROUNDS="$2"; shift 2 ;;
    -h|--help)
      echo "استفاده: ./deploy/panel-check.sh --account <نام‌کاربری> [--url https://…] [--rounds ۵]"
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
psql_q() {
  docker compose exec -T db psql -U "${POSTGRES_USER:-havale}" -d "${POSTGRES_DB:-havale}" \
    -tAc "$1" </dev/null 2>/dev/null || echo '?'
}

# ── sign in ─────────────────────────────────────────────────────────────────
if [ -z "$ACCOUNT" ]; then
  echo "برای اندازه‌گیری صفحه‌های پنل به یک حساب نیاز است:" >&2
  echo "  ./deploy/panel-check.sh --account admin" >&2
  exit 1
fi

read -rsp "رمز «$ACCOUNT»: " PASS; echo
LOGIN_MS="$(curl -s -o /dev/null -c "$JAR" -w '%{time_total}' \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ACCOUNT\",\"password\":\"$PASS\"}" \
  "$URL/api/v1/auth/login" 2>/dev/null)"
unset PASS

if ! grep -q 'havale_session' "$JAR" 2>/dev/null; then
  echo "✗ ورود انجام نشد. نام کاربری یا رمز را بررسی کنید." >&2
  exit 1
fi
printf '✓ ورود انجام شد (%.0f میلی‌ثانیه)\n' "$(awk "BEGIN{print $LOGIN_MS * 1000}")"

# ── what each screen actually costs ─────────────────────────────────────────
#
# Grouped the way the panel loads them: one line per screen, listing every call
# that screen makes. A screen that is slow because it makes six calls needs a
# different fix from one that makes a single slow call.
say "─── هر صفحه‌ی پنل، از همان مسیری که کاربر می‌آید ───"
printf '  %-38s %6s %8s %8s %8s\n' 'مسیر' 'کد' 'سرور' 'شبکه' 'کل'

total_all=0

measure() { # path -> prints a row, adds to total_all
  local path="$1" code size total server times=() servers=()
  local i
  for ((i = 0; i < ROUNDS; i++)); do
    local out
    out="$(curl -s -o /dev/null -b "$JAR" -H 'Accept-Encoding: gzip' -D - \
      -w 'HTTPCODE %{http_code} %{size_download} %{time_total}\n' "$URL$path" 2>/dev/null |
      tr -d '\r' | grep -iE '^(x-response-time:|HTTPCODE)' | tr '\n' ' ')"
    server="$(echo "$out" | grep -oiE 'x-response-time: *[0-9.]+' | grep -oE '[0-9.]+' || echo 0)"
    read -r _ code size total <<<"$(echo "$out" | grep -oE 'HTTPCODE.*')"
    times+=("$(awk "BEGIN{printf \"%.0f\", ${total:-0} * 1000}")")
    servers+=("$(awk "BEGIN{printf \"%.0f\", ${server:-0}}")")
  done

  local mid=$((ROUNDS / 2))
  local t s
  t="$(printf '%s\n' "${times[@]}" | sort -n | awk -v n=$((mid + 1)) 'NR==n')"
  s="$(printf '%s\n' "${servers[@]}" | sort -n | awk -v n=$((mid + 1)) 'NR==n')"
  local net=$(( t - s ))
  [ "$net" -lt 0 ] && net=0

  local label="$path"
  [ ${#label} -gt 38 ] && label="${label:0:35}…"
  printf '  %-38s %6s %7sms %7sms %7sms\n' "$label" "${code:-?}" "$s" "$net" "$t"
  total_all=$(( total_all + t ))
}

screen() { # label, paths…
  local label="$1"; shift
  printf '\n  \033[1m%s\033[0m\n' "$label"
  total_all=0
  local p
  for p in "$@"; do measure "$p"; done
  printf '  %-38s %6s %7s %7s %7sms  ← جمع صفحه\n' '' '' '' '' "$total_all"
}

screen 'داشبورد مدیریت' \
  '/api/v1/admin/overview' '/api/v1/admin/badges'

screen 'مدیریت حواله‌ها' \
  '/api/v1/admin/havales?market=HAVALE&status=LIVE&take=50' '/api/v1/admin/badges'

screen 'مدیریت ثبت‌نامی‌ها' \
  '/api/v1/admin/havales?market=REGISTRATION&status=LIVE&take=50' '/api/v1/admin/badges'

screen 'مانیتورینگ' \
  '/api/v1/admin/activity?take=50' '/api/v1/admin/activity/families' \
  '/api/v1/admin/reveals?take=30' '/api/v1/admin/badges'

screen 'نمایندگی‌ها' \
  '/api/v1/admin/agents?take=50' '/api/v1/admin/badges'

screen 'گزارش تخلف' \
  '/api/v1/reports?status=PENDING' '/api/v1/reports/pending-approval' '/api/v1/admin/badges'

screen 'کاتالوگ خودرو' \
  '/api/v1/catalog' '/api/v1/admin/badges'

# ── the database, where a slow screen usually starts ────────────────────────
say "─── دیتابیس ───"

CACHE="$(psql_q "select round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 1) from pg_statio_user_tables;")"
echo "  نرخ اصابت حافظه: ${CACHE}٪   (زیر ۹۹ یعنی دیتابیس دارد از دیسک می‌خواند)"

echo
printf '  %-22s %10s %12s %12s\n' 'جدول' 'ردیف' 'حجم' 'اسکن کامل'
psql_q "
  select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)), seq_scan
  from pg_stat_user_tables
  order by pg_total_relation_size(relid) desc
  limit 10;" |
  awk -F'|' '{printf "  %-22s %10s %12s %12s\n", $1, $2, $3, $4}'

echo
echo "  «اسکن کامل» زیاد روی جدول بزرگ یعنی جای یک ایندکس خالی است."

SLOWNOW="$(psql_q "select count(*) from pg_stat_activity where state='active' and now()-query_start > interval '1 second';")"
CONNS="$(psql_q "select count(*) from pg_stat_activity where datname=current_database();")"
echo "  اتصال‌های باز: ${CONNS} · کوئری در حال اجرا بیش از ۱ ثانیه: ${SLOWNOW}"

# ── what the API itself already recorded ────────────────────────────────────
#
# The slow-request log is the one measurement taken from *real* traffic rather
# than from this script's own probing, so it is the most honest number here.
say "─── کندترین مسیرها، از لاگ خودِ سامانه ───"
SLOWROWS="$(psql_q "
  select coalesce(string_agg(line, E'\n'), '')
  from (
    select '  ' || rpad(message, 44) || lpad(\"durationMs\"::text, 7) || 'ms  ×' || count as line
    from \"ErrorLog\" where level = 'slow'
    order by \"durationMs\" desc limit 12
  ) t;")"
if [ -n "$SLOWROWS" ] && [ "$SLOWROWS" != "?" ]; then
  echo "$SLOWROWS"
else
  echo "  هیچ درخواستی از آستانه کندتر نبوده — یا آستانه (SLOW_REQUEST_MS) بالاست."
  echo "  برای یافتن کندی‌های متوسط، موقتاً در .env بگذارید SLOW_REQUEST_MS=400"
fi

# ── the machine ─────────────────────────────────────────────────────────────
say "─── سرور در همین لحظه ───"
docker stats --no-stream --format '  {{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null |
  awk -F'|' '{printf "  %-26s CPU %7s   حافظه %s\n", $1, $2, $3}' || true
echo "  بار سیستم: $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo '?')  (روی ۳ هسته، بالای ۳ یعنی صف)"
echo "  دیسک: $(df -h / | awk 'NR==2 {print $4 " آزاد از " $2}')"

say "چطور بخوانید"
cat <<'HOW'
  · «سرور» بالا و «شبکه» پایین  → کار روی API و دیتابیس است.
  · «شبکه» بالا و «سرور» پایین  → مسیر بین کاربر و سرور کند است، نه سامانه.
  · هر دو پایین ولی «جمع صفحه» بالا → صفحه درخواست‌های زیادی می‌زند.
  · نرخ اصابت حافظه زیر ۹۹٪ یا «اسکن کامل» زیاد → کار روی ایندکس‌ها.
HOW
