# shellcheck shell=bash disable=SC2154
# دیده‌بان و هشدار
#
# Portable: driven by PROJECT_SLUG.

section "۸۰ — دیده‌بان و هشدار"

[ -x "$ROOT/deploy/watchdog.sh" ] \
  && ok "اسکریپت دیده‌بان موجود است" \
  || bad "deploy/watchdog.sh نیست یا اجرایی نیست" "chmod +x deploy/watchdog.sh"

if [ -f "/etc/cron.d/${PROJECT_SLUG}-watchdog" ]; then
  ok "کرون دیده‌بان نصب است"
  # Installed ≠ running. The log's mtime is the only proof cron actually fires.
  if [ -f "$WATCHDOG_LOG" ]; then
    age_m=$(( ($(date +%s) - $(date -r "$WATCHDOG_LOG" +%s)) / 60 ))
    [ "$age_m" -le 15 ] \
      && ok "دیده‌بان $age_m دقیقه پیش اجرا شده" \
      || bad "دیده‌بان $age_m دقیقه است اجرا نشده — کرون نصب است ولی کار نمی‌کند" \
             "systemctl status cron && cat /etc/cron.d/${PROJECT_SLUG}-watchdog"

    # Recoveries are rare by design, so a run of them is the signal that
    # something underneath needs a real fix rather than a nightly restart.
    heals="$(grep -c 'recovered after repair' "$WATCHDOG_LOG" 2>/dev/null || echo 0)"
    [ "${heals:-0}" -ge 3 ] 2>/dev/null \
      && warn "دیده‌بان $heals بار سرویسی را خودکار برگردانده — علت اصلی هنوز سر جایش است" \
              "grep -B2 'recovered after repair' $WATCHDOG_LOG | tail -30"
  else
    warn "لاگ دیده‌بان هنوز ساخته نشده" "تا ۵ دقیقه صبر کنید، بعد: cat $WATCHDOG_LOG"
  fi
else
  bad "کرون دیده‌بان نصب نیست — خرابی‌ها را کاربر قبل از شما می‌فهمد" \
      "printf '*/5 * * * * root $ROOT/deploy/watchdog.sh >> $WATCHDOG_LOG 2>&1\\n' > /etc/cron.d/${PROJECT_SLUG}-watchdog && chmod 644 /etc/cron.d/${PROJECT_SLUG}-watchdog"
fi

tg_token="$(env_get TELEGRAM_BOT_TOKEN)"; tg_chat="$(env_get TELEGRAM_CHAT_ID)"
if [ -z "$tg_token" ] || [ -z "$tg_chat" ]; then
  warn "هشدار تلگرام تنظیم نشده — خرابی‌ها فقط در لاگ می‌مانند" "docs/deployment.md — بخش هشدار تلگرام"
else
  # -o /dev/null and no error output: the URL carries the token, and this
  # script's output may be pasted somewhere.
  if curl -s -o /dev/null --max-time 10 -w '%{http_code}' \
       "https://api.telegram.org/bot$tg_token/getMe" 2>/dev/null | grep -q '^200$'; then
    ok "توکن ربات تلگرام معتبر است"
  else
    bad "تلگرام جواب نداد — توکن اشتباه است یا دسترسی شبکه ندارد" "توکن را در .env بررسی کنید (در چت نفرستید)"
  fi
fi
unset tg_token tg_chat

# Log files that nothing rotates grow until the disk does. The container logs
# are capped by Docker; these are the ones written by our own cron entries.
big_logs=""
for f in "$WATCHDOG_LOG" "$BACKUP_LOG" "/var/log/${PROJECT_SLUG}-certbot.log"; do
  [ -f "$f" ] || continue
  mb=$(( $(stat -c %s "$f") / 1048576 ))
  [ "$mb" -ge 100 ] && big_logs="$big_logs $(basename "$f")(${mb}MB)"
done
[ -z "$big_logs" ] \
  && ok "لاگ‌های کرون اندازه‌ی معقولی دارند" \
  || warn "لاگ بزرگ:$big_logs" "logrotate برایشان تنظیم کنید یا truncate -s 0 <file>"
