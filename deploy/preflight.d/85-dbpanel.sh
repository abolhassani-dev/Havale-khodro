# shellcheck shell=bash disable=SC2154
# پنل دیتابیس — Adminer
#
# Skip the whole file in a project without one.

section "۸۵ — پنل دیتابیس"

if [ ! -f "$ROOT/deploy/nginx/adminer.conf" ]; then
  skip "پنل دیتابیس نصب نشده"
  return 0 2>/dev/null || true
fi

if [ -f "$ROOT/deploy/nginx/.htpasswd" ]; then
  m="$(stat -c '%a' "$ROOT/deploy/nginx/.htpasswd")"
  # 600 makes nginx's worker (user `nginx`, not root) unable to read it: the
  # prompt appears, and the *correct* password then returns 500.
  [ "$m" = "644" ] \
    && ok "رمز پنل ساخته شده و دسترسی‌اش درست است" \
    || bad "دسترسی .htpasswd روی $m است — رمز درست هم خطای ۵۰۰ می‌دهد" "chmod 644 deploy/nginx/.htpasswd"
else
  bad "رمز پنل دیتابیس ساخته نشده — nginx بالا نمی‌آید" "docs/deployment.md — بخش «مدیریت دیتابیس»"
fi

if [ "$SSL_ON" = "1" ]; then
  grep -q 'listen .* ssl' "$ROOT/deploy/nginx/adminer.conf" \
    && ok "پنل دیتابیس روی HTTPS است" \
    || bad "پنل دیتابیس روی HTTP ساده است — رمز دیتابیس بدون رمزنگاری رد می‌شود" "./deploy/enable-ssl.sh"
fi

# 401 is the pass. 200 would mean the panel is open to the internet.
if [ "${WEB_UP:-0}" != "1" ]; then
  skip "وب‌سرور بالا نیست — پاسخ پنل دیتابیس بررسی نشد"
else
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "https://127.0.0.1:$DB_PANEL_PORT/" 2>/dev/null)"
  [ "$code" = "000" ] && code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$DB_PANEL_PORT/" 2>/dev/null)"
  case "$code" in
    401) ok "پنل دیتابیس رمز می‌خواهد (۴۰۱)" ;;
    200) bad "پنل دیتابیس بدون رمز باز است" "docs/deployment.md — .htpasswd را بسازید" ;;
    *)   warn "پنل دیتابیس پاسخ ${code} داد" "docker compose logs $WEB_SERVICE --tail 30" ;;
  esac
fi
