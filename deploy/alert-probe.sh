#!/usr/bin/env bash
#
# Which notification channels can this server actually reach?
#
#   /opt/feranocar/deploy/alert-probe.sh
#
# Every alerting design starts with the same unknown, and getting it wrong
# costs a week: an alerting channel that silently cannot send is worse than
# none, because you believe you are being watched. This answers it with data
# instead of assumption, in about twenty seconds.
#
# It only opens connections. It sends nothing, needs no key, and changes
# nothing.
#
set -uo pipefail

if [ -t 1 ]; then
  G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=''; Y=''; R=''; D=''; B=''; N=''
fi

TIMEOUT=8
reachable=()

# A TLS handshake, not a ping: ICMP is often allowed where HTTPS is not, and a
# DNS answer proves nothing at all — filtered hosts usually resolve fine and
# then refuse to talk.
probe() {
  local label="$1" host="$2" why="$3"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "https://$host" 2>/dev/null)"

  # Any HTTP status means the connection completed. 000 means it did not.
  #
  # No column padding: printf's width counts bytes, and every Persian character
  # is several of them, so %-26s puts the second column in a different place on
  # every line. An em-dash costs nothing and always lines up with itself.
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    printf '  %s✓%s %s %s— %s%s\n' "$G" "$N" "$label" "$D" "$why" "$N"
    reachable+=("$label")
  else
    printf '  %s✗%s %s %s— در دسترس نیست%s\n' "$R" "$N" "$label" "$D" "$N"
  fi
}

printf '\n%s▌ کدام مسیرهای هشدار از این سرور باز است؟%s\n' "$B" "$N"
printf '%s  فقط اتصال را امتحان می‌کند — هیچ پیامی فرستاده نمی‌شود.%s\n\n' "$D" "$N"

printf '%s▸ پوش مرورگر (PWA — طراحی خودمان)%s\n' "$B" "$N"
probe "FCM (اندروید/کروم)"  "fcm.googleapis.com"     "پوش به کروم و اندروید"
probe "Apple Push"          "web.push.apple.com"     "پوش به سافاری و آیفون"
probe "Mozilla Push"        "updates.push.services.mozilla.com" "پوش به فایرفاکس"

printf '\n%s▸ پیام‌رسان‌ها%s\n' "$B" "$N"
probe "بله"                 "tapi.bale.ai"           "Bot API سازگار با تلگرام"
probe "ایتا"                "eitaayar.ir"            "Bot API اختصاصی"
probe "روبیکا"              "botapi.rubika.ir"       "Bot API اختصاصی"
probe "تلگرام"              "api.telegram.org"       "معمولاً از ایران فیلتر است"

printf '\n%s▸ ایمیل و پیامک%s\n' "$B" "$N"
probe "کاوه‌نگار (پیامک)"    "api.kavenegar.com"      "هزینه‌دار"
probe "SMTP گوگل"           "smtp.gmail.com"         "معمولاً از آی‌پی ایران رد می‌شود"

printf '\n%s─────────────────────────────────────────────%s\n' "$B" "$N"
if [ ${#reachable[@]} -eq 0 ]; then
  printf '  %sهیچ مسیری باز نیست.%s فایروال خروجی را بررسی کنید:\n' "$R" "$N"
  printf '    ufw status verbose\n'
  exit 1
fi

printf '  %sمسیرهای باز:%s %s\n\n' "$G" "$N" "${reachable[*]}"

# The recommendation, in the order that actually matters: a channel that
# reaches a locked phone without a third-party app beats one that needs an app
# installed, which beats one that costs money per message.
if printf '%s\n' "${reachable[@]}" | grep -q 'FCM'; then
  printf '  %s→ پوش مرورگر ممکن است.%s این همان «خودمان بسازیم» است:\n' "$B" "$N"
  printf '    سایت خودتان روی گوشی نصب می‌شود و نوتیف مستقیم از سرور خودمان\n'
  printf '    می‌آید — بدون هیچ اپ واسطه‌ای و بدون هزینه.\n'
elif printf '%s\n' "${reachable[@]}" | grep -qE 'ایتا|روبیکا'; then
  printf '  %s→ پوش مرورگر بسته است.%s بهترین گزینه، ربات در پیام‌رسانی است که\n' "$B" "$N"
  printf '    روی گوشی‌تان نصب باشد و نوتیف بدهد.\n'
else
  printf '  %s→ فقط پیام‌رسان‌های محدود باز است.%s گزینه‌ها را با هم مرور کنیم.\n' "$Y" "$N"
fi
echo
