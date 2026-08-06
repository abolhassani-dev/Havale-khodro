#!/usr/bin/env bash
#
# Connect the alerting bot, and prove it works before trusting it.
#
#   /opt/feranocar/deploy/alert-setup.sh
#
# The token is typed here, on the server, and goes straight into .env. It is
# never echoed, never passed as an argument (which would put it in the shell
# history and in `ps`), and never leaves this machine except to the Bot API.
#
# Every step is verified rather than assumed:
#   1. can this server reach the API at all
#   2. is the token real          (getMe)
#   3. which chat should it use   (getUpdates — read from your own message)
#   4. does a message actually arrive
#
# Step 1 matters more than it looks. Telegram is filtered in Iran and this
# server is in Iran, so it is tried second, not first — an alerting channel
# that silently cannot send is worse than none, because you would believe you
# were being watched. Bale (بله) speaks the same Bot API, so choosing it
# changes one line in .env and nothing else, anywhere.
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env"

if [ -t 1 ]; then
  G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=''; Y=''; R=''; D=''; B=''; N=''
fi

say()  { printf '%s\n' "$1"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
bad()  { printf '  %s✗%s %s\n' "$R" "$N" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
step() { printf '\n%s▸ %s%s\n' "$B" "$1" "$N"; }

[ -f "$ENV_FILE" ] || { bad ".env پیدا نشد. این اسکریپت باید از داخل $ROOT اجرا شود."; exit 1; }

# Writes or replaces a key in .env without disturbing anything else, and
# without ever printing the value.
set_env() {
  local key="$1" value="$2"
  if grep -qE "^$key=" "$ENV_FILE"; then
    # `|` as the delimiter and the value fed through a temp file: a token can
    # contain characters sed would read as syntax.
    local tmp; tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

printf '\n%s▌ اتصال ربات هشدار%s\n' "$B" "$N"
printf '%s  توکن روی همین سرور می‌ماند و هیچ‌جا چاپ نمی‌شود.%s\n' "$D" "$N"

# ── 1. reachability ──────────────────────────────────────────────────────────
step "۱ — آیا این سرور به API دسترسی دارد؟"

# Bale first. Telegram is filtered in Iran, so trying it first would mean
# every run of this script begins with a twelve-second timeout and a scary
# message about the thing that was never going to work.
API_BASE=""
BOT_HOST=""

if curl -sS --max-time 12 -o /dev/null "https://tapi.bale.ai" 2>/dev/null; then
  ok "بله (tapi.bale.ai) در دسترس است"
  API_BASE="https://tapi.bale.ai"
  BOT_HOST="بله"
else
  warn "بله از این سرور در دسترس نیست"
fi

if [ -z "$API_BASE" ]; then
  if curl -sS --max-time 12 -o /dev/null "https://api.telegram.org" 2>/dev/null; then
    ok "تلگرام در دسترس است"
    API_BASE="https://api.telegram.org"
    BOT_HOST="تلگرام"
  else
    bad "نه بله و نه تلگرام از این سرور در دسترس نیستند."
    say ""
    say "  بررسی کنید فایروال خروجی چیزی را نبسته باشد:"
    say "    curl -v --max-time 10 https://tapi.bale.ai"
    say ""
    say "  اگر واقعاً هیچ‌کدام در دسترس نبود، پیامک تنها راه باقی‌مانده است."
    say "  در .env این سه را بگذارید و همین اسکریپت را رد کنید:"
    say "    SMS_API_KEY=…   SMS_SENDER=…   ALERT_SMS_TO=09…"
    exit 1
  fi
fi

say ""
say "  ${D}هشدارها از طریق ${BOT_HOST} فرستاده می‌شوند.${N}"

# ── 2. the token ─────────────────────────────────────────────────────────────
step "۲ — توکن ربات"
say "  اگر هنوز ربات نساخته‌اید: در $BOT_HOST به @BotFather پیام دهید، /newbot را بزنید،"
say "  و توکنی که می‌دهد را اینجا بچسبانید."
say ""
printf '  توکن (نمایش داده نمی‌شود): '
read -r -s TOKEN
echo

[ -n "$TOKEN" ] || { bad "توکنی وارد نشد."; exit 1; }

me="$(curl -sS --max-time 12 "$API_BASE/bot$TOKEN/getMe" 2>/dev/null)"
if ! printf '%s' "$me" | grep -q '"ok":true'; then
  bad "این توکن را API نپذیرفت."
  say "  دوباره از BotFather کپی کنید — معمولاً یک کاراکتر جا افتاده است."
  exit 1
fi
BOT_NAME="$(printf '%s' "$me" | grep -o '"username":"[^"]*"' | head -1 | cut -d'"' -f4)"
ok "توکن معتبر است — ربات: @${BOT_NAME:-?}"

# ── 3. the chat ──────────────────────────────────────────────────────────────
step "۳ — کدام گفتگو؟"
say "  حالا در $BOT_HOST به @${BOT_NAME:-ربات} پیام بدهید (هر چیزی، مثلاً «سلام»)."
say "  اگر می‌خواهید هشدارها به یک گروه بروند، ربات را به گروه اضافه کنید و"
say "  آنجا یک پیام بفرستید."
say ""
printf '  بعد از فرستادن پیام، Enter را بزنید… '
read -r _

CHAT=""
for attempt in 1 2 3; do
  updates="$(curl -sS --max-time 12 "$API_BASE/bot$TOKEN/getUpdates" 2>/dev/null)"
  CHAT="$(printf '%s' "$updates" | grep -o '"chat":{"id":-\?[0-9]*' | tail -1 | grep -o '\-\?[0-9]*$')"
  [ -n "$CHAT" ] && break
  warn "هنوز پیامی دیده نشد (تلاش $attempt از ۳)"
  printf '  یک پیام بفرستید و Enter بزنید… '
  read -r _
done

if [ -z "$CHAT" ]; then
  bad "نتوانستم گفتگو را پیدا کنم."
  say "  اگر ربات را تازه به گروه اضافه کرده‌اید، یک پیام دیگر در گروه بفرستید."
  say "  یا chat id را دستی در .env بگذارید: TELEGRAM_CHAT_ID=..."
  exit 1
fi
ok "گفتگو پیدا شد (شناسه: $CHAT)"

# ── 4. write, then prove ─────────────────────────────────────────────────────
step "۴ — ذخیره و آزمایش"

set_env TELEGRAM_BOT_TOKEN "$TOKEN"
set_env TELEGRAM_CHAT_ID   "$CHAT"
set_env ALERT_API_BASE "$API_BASE"
ok "در .env ذخیره شد (دسترسی ۶۰۰)"

sent="$(curl -sS --max-time 12 -X POST "$API_BASE/bot$TOKEN/sendMessage" \
  -d "chat_id=$CHAT" -d "parse_mode=HTML" \
  --data-urlencode "text=🟢 <b>ربات هشدار فرانوکار وصل شد</b>
<i>$(date '+%Y-%m-%d %H:%M')</i>

از این پس این موارد را زیر نظر دارم:
🖥️ سرور — دیسک، حافظه، swap، inode
🗄️ دیتابیس — پاسخ‌گویی و ظرفیت اتصال
⚙️ برنامه — کانتینرها، سلامت API، حلقه‌ی ری‌استارت
💾 بکاپ — تازگی و سلامت آرشیو
🔐 گواهی — انقضا

هر مشکل <b>یک بار</b> گزارش می‌شود، و یک بار هم وقتی برطرف شد.
هر روز صبح هم یک گزارش کوتاه می‌آید تا بدانید زنده‌ام." 2>/dev/null)"

if printf '%s' "$sent" | grep -q '"ok":true'; then
  ok "پیام آزمایشی رسید — گوشی‌تان را ببینید"
else
  bad "پیام فرستاده نشد. پاسخ API: $(printf '%s' "$sent" | head -c 200)"
  exit 1
fi

unset TOKEN

# ── 5. the digest schedule ───────────────────────────────────────────────────
step "۵ — گزارش روزانه"
DIGEST_CRON="/etc/cron.d/${PROJECT_SLUG:-feranocar}-digest"
if [ -f "$DIGEST_CRON" ]; then
  ok "کرون گزارش روزانه از قبل نصب است"
else
  printf '0 6 * * * root %s/deploy/watchdog.sh --digest >> /var/log/%s-watchdog.log 2>&1\n' \
    "$ROOT" "${PROJECT_SLUG:-feranocar}" > "$DIGEST_CRON"
  chmod 644 "$DIGEST_CRON"
  ok "گزارش روزانه هر روز ۶ صبح نصب شد"
fi

printf '\n%s  تمام شد.%s\n' "$G" "$N"
printf '%s  دیده‌بان هر ۵ دقیقه بررسی می‌کند و فقط وقتی خبری هست حرف می‌زند.%s\n' "$D" "$N"
printf '%s  آزمایش دستی:  %s/deploy/watchdog.sh --digest%s\n' "$D" "$ROOT" "$N"
