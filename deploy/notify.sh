# shellcheck shell=bash
#
# Sending an alert, once.
#
# Sourced by watchdog.sh and by anything else that needs to reach a human.
# Nothing here runs on its own.
#
# ── Why a shared file ────────────────────────────────────────────────────────
#
# The rules that stop an alerting channel from becoming noise are the same
# wherever the alert comes from, and they are easy to get subtly wrong: dedupe,
# a ceiling on messages per hour, a recovery notice, and never blocking the
# thing that is trying to report a problem. Written once, every caller gets
# them.
#
# ── Why the API base is configurable ─────────────────────────────────────────
#
# Telegram is filtered in Iran, and this server is in Iran. An alerting channel
# that cannot send is worse than none, because you believe you are being
# watched.
#
# Bale (بله) is Iranian, unfiltered, and speaks the *same* Bot API — the same
# /bot<token>/sendMessage, the same chat_id, text and parse_mode fields. So the
# entire migration is one line, and nothing in this file or in watchdog.sh
# knows the difference:
#
#   ALERT_API_BASE=https://tapi.bale.ai        (default here — Iran)
#   ALERT_API_BASE=https://api.telegram.org    (if you ever have a route to it)
#
# ── Why SMS as well ──────────────────────────────────────────────────────────
#
# A messaging app is read when someone opens it. For the handful of problems
# that mean "the system is down right now", that is not good enough — those
# deserve the one channel in Iran that reaches a person who is not looking at a
# screen. SMS costs money per message, so it is deliberately reserved for the
# keys in NOTIFY_SMS_KEYS and nothing else, and it stays inert until an SMS
# panel is configured.
#
# ── Load ─────────────────────────────────────────────────────────────────────
#
# Nothing polls. Nothing runs as a daemon. A message is one curl with a ten
# second ceiling, and only when there is something to say — so on a healthy
# server this file costs nothing at all.

ALERT_STATE="${ALERT_STATE:-/var/lib/${PROJECT_SLUG:-feranocar}/alerts}"
ALERT_MAX_PER_HOUR="${ALERT_MAX_PER_HOUR:-12}"

mkdir -p "$ALERT_STATE" 2>/dev/null || true

_env_val() { grep -E "^$1=" "${ROOT:-.}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'; }

ALERT_TOKEN="$(_env_val TELEGRAM_BOT_TOKEN)"
ALERT_CHAT="$(_env_val TELEGRAM_CHAT_ID)"
ALERT_API_BASE="$(_env_val ALERT_API_BASE)"
# Bale by default: this server is in Iran, where Telegram does not answer.
ALERT_API_BASE="${ALERT_API_BASE:-https://tapi.bale.ai}"

# SMS escalation, for the few problems that mean the system is down now.
SMS_KEY="$(_env_val SMS_API_KEY)"
SMS_SENDER="$(_env_val SMS_SENDER)"
SMS_TO="$(_env_val ALERT_SMS_TO)"
NOTIFY_SMS_KEYS="${NOTIFY_SMS_KEYS:-db-connections api-health container-db container-api container-web disk backup-corrupt}"

notify_enabled() { [ -n "$ALERT_TOKEN" ] && [ -n "$ALERT_CHAT" ]; }
sms_enabled()    { [ -n "$SMS_KEY" ] && [ -n "$SMS_SENDER" ] && [ -n "$SMS_TO" ]; }

# One SMS per problem per six hours, on top of the per-problem dedupe. Two
# safeguards rather than one, because this is the channel that costs money and
# wakes people up — and a loop here is expensive in both senses.
_sms_send() {
  local key="$1" text="$2"
  sms_enabled || return 0

  local stamp="$ALERT_STATE/sms-$key"
  local now; now="$(date +%s)"
  if [ -f "$stamp" ]; then
    local last; last="$(cat "$stamp" 2>/dev/null || echo 0)"
    [ $((now - last)) -lt 21600 ] && return 0
  fi
  echo "$now" > "$stamp"

  curl -sS --max-time 15 -o /dev/null \
    -X POST "https://api.kavenegar.com/v1/$SMS_KEY/sms/send.json" \
    --data-urlencode "receptor=$SMS_TO" \
    --data-urlencode "sender=$SMS_SENDER" \
    --data-urlencode "message=$text" 2>/dev/null || true
}

# Telegram's HTML mode needs exactly three characters escaped. Values that reach
# here include container names and error text, which can contain any of them.
_esc() { printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }

# The categories an alert can belong to, and the icon each gets. Having the
# category in the message is what makes a phone full of alerts readable at a
# glance: "which part of the system is unhappy" answered before reading a word.
_category_label() {
  case "$1" in
    server)   printf '🖥️ سرور' ;;
    database) printf '🗄️ دیتابیس' ;;
    app)      printf '⚙️ برنامه' ;;
    backup)   printf '💾 بکاپ' ;;
    cert)     printf '🔐 گواهی' ;;
    *)        printf '📋 عمومی' ;;
  esac
}

# A ceiling on how much this can say in an hour.
#
# The failure worth alerting on is usually the one that repeats, and a phone
# that buzzes forty times is a phone that gets muted — after which the alerting
# channel is worse than none, because everyone believes it is working. Past the
# ceiling, messages are counted and the count is reported in the next digest,
# so nothing is lost quietly.
_rate_ok() {
  local hour_file="$ALERT_STATE/rate-$(date +%Y%m%d%H)"
  local n=0
  [ -f "$hour_file" ] && n="$(cat "$hour_file" 2>/dev/null || echo 0)"
  if [ "$n" -ge "$ALERT_MAX_PER_HOUR" ] 2>/dev/null; then
    local sup="$ALERT_STATE/suppressed"
    echo $(( $(cat "$sup" 2>/dev/null || echo 0) + 1 )) > "$sup"
    return 1
  fi
  echo $((n + 1)) > "$hour_file"
  # Yesterday's counters are not worth a cron entry of their own.
  find "$ALERT_STATE" -name 'rate-*' -mmin +120 -delete 2>/dev/null || true
  return 0
}

# Post to the Bot API. Never blocks for long, never fails the caller, never
# prints the token — the URL carries it, so no output from curl is echoed.
notify_raw() {
  local text="$1"
  notify_enabled || return 0

  curl -sS --max-time 10 -o /dev/null \
    -X POST "$ALERT_API_BASE/bot$ALERT_TOKEN/sendMessage" \
    -d "chat_id=$ALERT_CHAT" \
    -d "parse_mode=HTML" \
    -d "disable_web_page_preview=true" \
    --data-urlencode "text=$text" 2>/dev/null || true
}

#
# notify_problem <key> <category> <title> <detail> <fix>
#
# Sends once per problem. A problem that lasts six hours is one message, not
# seventy-two — the state file is what makes that true, and it is also what
# lets notify_clear know there is something to clear.
#
notify_problem() {
  local key="$1" category="$2" title="$3" detail="$4" fix="$5"
  local flag="$ALERT_STATE/$key"

  [ -f "$flag" ] && return 1     # already reported, still broken
  : > "$flag"

  echo "[$(date '+%F %T')] [$category] $title — $detail"

  # SMS first, and outside the messaging-app rate limit: if this is one of the
  # problems that means the system is down, it must not be the message the
  # hourly ceiling happened to swallow.
  case " $NOTIFY_SMS_KEYS " in
    *" $key "*) _sms_send "$key" "فرانوکار: $title — $detail" ;;
  esac

  notify_enabled || return 0
  _rate_ok || return 0

  notify_raw "🔴 <b>$(_esc "$title")</b>
$(_category_label "$category") · <i>$(date '+%Y-%m-%d %H:%M')</i>

<pre>$(_esc "$detail")</pre>

🔧 <b>راه‌حل:</b>
$(_esc "$fix")"
}

#
# notify_clear <key> <category> <title>
#
# The other half. Without it, the last thing the phone ever said about a
# service is that it was broken, and there is no way to tell "still broken"
# from "fixed hours ago".
#
notify_clear() {
  local key="$1" category="$2" title="$3"
  local flag="$ALERT_STATE/$key"
  [ -f "$flag" ] || return 0
  rm -f "$flag"

  echo "[$(date '+%F %T')] [$category] recovered: $title"
  notify_enabled || return 0
  _rate_ok || return 0

  notify_raw "🟢 <b>برطرف شد: $(_esc "$title")</b>
$(_category_label "$category") · <i>$(date '+%Y-%m-%d %H:%M')</i>"
}

# How many messages the ceiling swallowed since the last digest, and reset.
notify_suppressed_count() {
  local sup="$ALERT_STATE/suppressed"
  local n; n="$(cat "$sup" 2>/dev/null || echo 0)"
  rm -f "$sup"
  echo "${n:-0}"
}

# Which problems are open right now, for the digest.
notify_open_problems() {
  find "$ALERT_STATE" -maxdepth 1 -type f ! -name 'rate-*' ! -name 'suppressed' \
       ! -name 'heal-*' ! -name 'last-digest' -printf '%f ' 2>/dev/null
}
