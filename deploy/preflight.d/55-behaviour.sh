# shellcheck shell=bash disable=SC2154
# رفتار واقعی برنامه — چیزی که سرور جواب می‌دهد
#
# These test the code that is *running*, not the file on disk. A server whose
# update never took shows up here even when every file looks right.
#
# Project-specific: the paths are this API's.

section "۵۵ — رفتار واقعی برنامه"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost$HEALTH_PATH" 2>/dev/null)"
if [ "$code" = "200" ]; then
  # A health endpoint that answers slowly is the first sign of a database under
  # strain, and it shows up here long before anything goes red.
  ms="$(curl -s -o /dev/null -w '%{time_total}' --max-time 10 "http://localhost$HEALTH_PATH" 2>/dev/null \
        | awk '{printf "%d", $1*1000}')"
  if [ "${ms:-0}" -gt 1500 ] 2>/dev/null; then
    warn "API سالم است ولی کند جواب می‌دهد (${ms}ms)" "docker compose logs $API_SERVICE --tail 50"
  else
    ok "API سالم است (${ms}ms)"
  fi
else
  bad "API پاسخ ${code:-هیچ} داد" "docker compose logs $API_SERVICE --tail 50"
  WEB_UP=0
fi

# An unreachable API cannot be asked how it handles a malformed body. Skipping
# says "not checked"; failing would say "broken", and only one of those is true.
if [ "${WEB_UP:-0}" != "1" ]; then
  skip "برنامه بالا نیست — بررسی رفتار انجام نشد"
  return 0 2>/dev/null || true
fi

code="$(http_code -X POST -H 'Content-Type: application/json' -d '{bad' "$BASE$API_PREFIX/auth/login")"
[ "$code" = "400" ] \
  && ok "درخواست خراب → ۴۰۰ (نه ۵۰۰)" \
  || bad "درخواست خراب پاسخ $code داد، انتظار ۴۰۰ — یعنی آخرین کد روی سرور نیست" "./deploy/update.sh"

# Through a file, not a shell variable: two megabytes on a command line is
# close enough to ARG_MAX that this check would fail for the wrong reason.
BIGFILE="$(mktemp)"
{ printf '{"a":"'; head -c 2000000 /dev/zero | tr '\0' 'a'; printf '"}'; } > "$BIGFILE"
code="$(http_code -X POST -H 'Content-Type: application/json' --data-binary "@$BIGFILE" "$BASE$API_PREFIX/auth/login")"
rm -f "$BIGFILE"
[ "$code" = "413" ] \
  && ok "درخواست حجیم → ۴۱۳" \
  || bad "درخواست حجیم پاسخ $code داد، انتظار ۴۱۳" "./deploy/update.sh"

# `havales`, plural — the singular is not a route at all and answers 404, so
# the first version of this check called a perfectly healthy server broken.
for p in havales admin/users settings; do
  code="$(http_code "$BASE$API_PREFIX/$p")"
  [ "$code" = "401" ] \
    && ok "مسیر محافظت‌شده /$p بدون ورود → ۴۰۱" \
    || bad "مسیر /$p بدون ورود پاسخ $code داد، انتظار ۴۰۱" "بررسی میان‌افزار احراز هویت"
done

code="$(http_code "$BASE$API_PREFIX/does-not-exist")"
[ "$code" = "404" ] \
  && ok "مسیر ناموجود → ۴۰۴" \
  || bad "مسیر ناموجود پاسخ $code داد" "docker compose logs $API_SERVICE --tail 30"

methods_ok=1
for m in TRACE TRACK; do
  code="$(http_code -X "$m" "$BASE/")"
  if [ "$code" = "200" ]; then
    methods_ok=0
    bad "متد $m فعال است" "در app.conf متدهای غیرمجاز را ببندید"
  fi
done
[ "$methods_ok" = "1" ] && ok "متدهای TRACE/TRACK فعال نیستند"

# Infrastructure files that must never be reachable over HTTP. Each of these
# has been served by a misconfigured root at some point in somebody's career.
#
# Matched on the *content*, not the status code. nginx serves this as a single
# page application — `try_files $uri $uri/ /index.html` — so every path that
# does not exist comes back as 200 with the app's HTML in it. Judging by status
# alone, the first version of this check reported that .env, .git/config and
# the database panel's password file were all downloadable from the public
# internet. They were not; every one of those responses was the home page.
#
# There is no scarier false positive available in this project, and it was
# printed to the person who owns the server. So: ask for the file, and only
# call it exposed if what comes back is recognisably that file.
declare -A SIGNATURE=(
  ['.env']='SESSION_SECRET=|POSTGRES_PASSWORD='
  ['.git/config']='\[core\]|\[remote '
  ['docker-compose.yml']='^services:|^  api:'
  ['deploy/nginx/.htpasswd']='^[A-Za-z0-9_-]+:\$(apr1|2y)\$'
  ['backend/package.json']='"dependencies"|"name":'
  ['backend/.env']='SESSION_SECRET=|DATABASE_URL='
  ['.git/HEAD']='^ref: refs/'
)

exposed=""
for path in "${!SIGNATURE[@]}"; do
  body="$(curl -s --max-time 10 "${CURL_OPTS[@]}" "$BASE/$path" 2>/dev/null | head -c 4000)"
  [ -n "$body" ] || continue
  echo "$body" | grep -qE "${SIGNATURE[$path]}" && exposed="$exposed /$path"
done

if [ -z "$exposed" ]; then
  ok "فایل‌های زیرساختی از وب در دسترس نیستند"
else
  bad "این فایل‌ها واقعاً از وب قابل دریافت‌اند:$exposed" \
      "فوری: در app.conf مسدود کنید و بعد همه‌ی رازهای داخلشان را عوض کنید"
fi

# Compression: not correctness, but the difference between a panel that feels
# fast on a phone connection and one that does not.
#
# Measured on a response big enough to be worth compressing. nginx has a
# `gzip_min_length`, so asking about a 200-byte reply and calling the answer
# "compression is off" would be a warning about a setting working exactly as
# intended.
probe="$(curl -s -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: identity' "${CURL_OPTS[@]}" "$BASE/" 2>/dev/null)"
if [ "${probe:-0}" -lt 1024 ] 2>/dev/null; then
  skip "پاسخ صفحه‌ی اصلی کوچک‌تر از حد فشرده‌سازی است (${probe:-0} بایت) — بررسی نشد"
elif curl -s -I -H 'Accept-Encoding: gzip' "${CURL_OPTS[@]}" "$BASE/" 2>/dev/null | grep -qi '^content-encoding:'; then
  ok "پاسخ‌ها فشرده می‌شوند"
else
  warn "فشرده‌سازی پاسخ فعال نیست" "gzip on; در app.conf"
fi
