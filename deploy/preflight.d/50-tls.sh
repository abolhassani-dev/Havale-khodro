# shellcheck shell=bash disable=SC2154
# دامنه، گواهی و هدرهای امنیتی
#
# Portable. Sets BASE / CURL_OPTS / SSL_ON / WEB_UP for the sections after it.

section "۵۰ — دامنه، SSL و هدرها"

DOMAIN="$(env_get BRAND_DOMAIN)"; DOMAIN="${DOMAIN:-localhost}"

if [ -f "$ROOT/deploy/nginx/ssl.conf" ]; then
  SSL_ON=1
  ok "پیکربندی SSL نصب است"
  # This one line is the difference between "the certificate exists" and "the
  # site uses it". An update used to revert it on every run.
  if grep -qE 'default[[:space:]]+1' "$ROOT/deploy/nginx/00-mode.conf" 2>/dev/null; then
    ok "ریدایرکت HTTP → HTTPS روشن است"
  else
    bad "گواهی هست ولی ریدایرکت خاموش است — سایت روی HTTP ساده سرو می‌شود" \
        "printf 'map \$host \$force_https {\\n    default 1;\\n}\\n' > deploy/nginx/00-mode.conf && docker compose exec -T $WEB_SERVICE nginx -s reload"
  fi
else
  warn "SSL فعال نیست — رمزها و کوکی‌ها بدون رمزنگاری رد و بدل می‌شوند" "./deploy/enable-ssl.sh"
fi

if [ "$SSL_ON" = "1" ]; then
  BASE="https://$DOMAIN"
  CURL_OPTS=(--resolve "$DOMAIN:443:127.0.0.1" --max-time 15)

  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/" 2>/dev/null)"
  { [ "$code" = "301" ] || [ "$code" = "308" ]; } \
    && ok "HTTP با $code به HTTPS می‌رود" \
    || bad "HTTP پاسخ $code داد، نه ۳۰۱" "docker compose logs $WEB_SERVICE --tail 30"

  # No -k: this validates the chain and the hostname, which is also the only
  # honest way to know the certificate is the right one and not expired.
  code="$(http_code "$BASE/")"
  [ "$code" = "200" ] \
    && ok "HTTPS پاسخ ۲۰۰ می‌دهد و گواهی معتبر است" \
    || bad "HTTPS پاسخ ${code:-هیچ} داد" "docker compose logs $WEB_SERVICE --tail 30"

  enddate="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null \
             | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$enddate" ]; then
    days=$(( ($(date -d "$enddate" +%s 2>/dev/null || echo 0) - $(date +%s)) / 86400 ))
    if   [ "$days" -lt 0 ];               then bad "گواهی منقضی شده است" "docker compose run --rm --entrypoint certbot certbot renew --force-renewal"
    elif [ "$days" -lt "$CERT_MIN_DAYS" ]; then bad "گواهی $days روز دیگر منقضی می‌شود — تمدید خودکار باید تا حالا کار کرده باشد" "tail -50 /var/log/${PROJECT_SLUG}-certbot.log"
    else                                       ok "گواهی $days روز اعتبار دارد"
    fi
  fi

  # Renewal is unattended, so its failure is silent until the site breaks.
  [ -f "/etc/cron.d/${PROJECT_SLUG}-certbot" ] \
    && ok "کرون تمدید خودکار گواهی نصب است" \
    || bad "کرون تمدید گواهی نصب نیست — گواهی سه ماه دیگر منقضی می‌شود و کسی خبردار نمی‌شود" "./deploy/enable-ssl.sh"

  # Old TLS versions are still accepted by default in many builds, and a client
  # that negotiates TLS 1.0 gets a connection nobody would call encrypted.
  weak=""
  for proto in tls1 tls1_1; do
    echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" "-$proto" >/dev/null 2>&1 \
      && weak="$weak ${proto/tls1_1/TLSv1.1}"
  done
  weak="${weak/tls1/TLSv1.0}"
  [ -z "$weak" ] \
    && ok "نسخه‌های قدیمی TLS پذیرفته نمی‌شوند" \
    || bad "نسخه‌های ضعیف TLS هنوز فعالند:$weak" "در ssl.conf: ssl_protocols TLSv1.2 TLSv1.3;"

  hdrs="$(curl -sI "${CURL_OPTS[@]}" "$BASE/" 2>/dev/null)"
else
  CURL_OPTS=(--max-time 15)
  hdrs="$(curl -sI --max-time 10 "$BASE/" 2>/dev/null)"
fi

# If nothing answered, nothing below is testable. Reporting "no CSP header",
# "no HSTS header", "X-Powered-By absent ✓" against an empty response is worse
# than useless: it buries the one real finding — the site is down — under a
# dozen invented ones, and one of them is a pass the server never earned.
if [ -z "$hdrs" ]; then
  bad "وب‌سرور به درخواست جواب نداد — بررسی هدرها انجام نشد" "docker compose logs $WEB_SERVICE --tail 30"
  WEB_UP=0
else
  WEB_UP=1
  for h in X-Content-Type-Options X-Frame-Options Content-Security-Policy Referrer-Policy; do
    echo "$hdrs" | grep -qi "^$h:" \
      && ok "هدر $h" \
      || bad "هدر $h فرستاده نمی‌شود" "deploy/nginx/app.conf — بعد از اصلاح: docker compose exec -T $WEB_SERVICE nginx -s reload"
  done

  if [ "$SSL_ON" = "1" ]; then
    hsts="$(echo "$hdrs" | grep -i '^Strict-Transport-Security:' | head -1)"
    if [ -z "$hsts" ]; then
      bad "هدر Strict-Transport-Security فرستاده نمی‌شود" "در ssl.conf اضافه کنید"
    else
      # Under six months, browsers will not preload it and the protection
      # lapses between visits.
      maxage="$(echo "$hsts" | grep -oE 'max-age=[0-9]+' | cut -d= -f2)"
      if [ "${maxage:-0}" -ge 15552000 ] 2>/dev/null; then
        ok "هدر Strict-Transport-Security (max-age=${maxage})"
      else
        warn "HSTS با max-age=${maxage:-؟} کوتاه است (کمتر از ۶ ماه)" "max-age=31536000"
      fi
    fi
  fi

  echo "$hdrs" | grep -qi '^X-Powered-By:' \
    && bad "هدر X-Powered-By فرستاده می‌شود — فریم‌ورک را لو می‌دهد" "app.disable('x-powered-by')" \
    || ok "X-Powered-By فرستاده نمی‌شود"

  echo "$hdrs" | grep -qiE '^Server: *nginx/[0-9]' \
    && warn "نسخه‌ی دقیق nginx در هدر Server است" "server_tokens off; در app.conf" \
    || ok "نسخه‌ی وب‌سرور پنهان است"
fi
