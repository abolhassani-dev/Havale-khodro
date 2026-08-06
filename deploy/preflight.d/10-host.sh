# shellcheck shell=bash disable=SC2154
# سرور — سیستم‌عامل، ساعت، به‌روزرسانی
#
# Portable: nothing here knows what the server runs.

section "۱۰ — سیستم‌عامل و ساعت"

tz="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)"
if [ "$tz" = "$TIMEZONE" ]; then
  ok "منطقه‌ی زمانی: $TIMEZONE"
else
  # Not cosmetic: daily quotas and retention windows reset on the server's idea
  # of midnight, so a wrong zone moves the reset into the middle of the workday.
  bad "منطقه‌ی زمانی «${tz:-نامشخص}» است، نه $TIMEZONE" \
      "timedatectl set-timezone $TIMEZONE"
fi

# A clock that has drifted breaks TLS handshakes, expires sessions early, and
# makes two log files impossible to line up — and it drifts silently.
sync_state="$(timedatectl show -p NTPSynchronized --value 2>/dev/null)"
case "$sync_state" in
  yes) ok "ساعت با سرور زمان همگام است" ;;
  no)  warn "ساعت سرور با NTP همگام نیست — انحراف ساعت، دست‌دادن TLS و لاگ‌ها را خراب می‌کند" \
            "timedatectl set-ntp true" ;;
  *)   skip "وضعیت همگام‌سازی ساعت خوانده نشد" ;;
esac

# A kernel or libc update that has been installed but not booted into is a
# machine running code it no longer has on disk.
if [ -f /var/run/reboot-required ]; then
  warn "سرور برای تکمیل به‌روزرسانی نیاز به ریبوت دارد" \
       "$(cat /var/run/reboot-required.pkgs 2>/dev/null | tr '\n' ' ' | cut -c1-90) → reboot در ساعت کم‌ترافیک"
else
  ok "ریبوت معلقی در کار نیست"
fi

if have apt-get; then
  # `apt list --upgradable` is slow and needs a fresh index; this reads what the
  # unattended-upgrades machinery already knows and costs nothing.
  sec_updates="$(apt-get -s -o Debug::NoLocking=true upgrade 2>/dev/null \
                 | grep -ci '^Inst.*security' || true)"
  if [ "${sec_updates:-0}" -eq 0 ] 2>/dev/null; then
    ok "به‌روزرسانی امنیتی معلقی نیست"
  elif [ "${sec_updates:-0}" -le 5 ] 2>/dev/null; then
    warn "$sec_updates به‌روزرسانی امنیتی نصب نشده" "apt update && apt upgrade -y"
  else
    bad "$sec_updates به‌روزرسانی امنیتی نصب نشده" "apt update && apt upgrade -y"
  fi

  systemctl is-active --quiet unattended-upgrades 2>/dev/null \
    && ok "به‌روزرسانی خودکار امنیتی فعال است" \
    || warn "به‌روزرسانی خودکار امنیتی فعال نیست" \
            "apt install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades"
fi
