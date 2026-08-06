# shellcheck shell=bash disable=SC2154
# بکاپ — زمان‌بندی، تازگی، سلامت، انتقال به بیرون
#
# Portable: driven by BACKUP_ROOT / BACKUP_TIERS / PROJECT_SLUG.

section "۷۰ — بکاپ"

BR="$BACKUP_ROOT"
CRON="/etc/cron.d/${PROJECT_SLUG}-backup"

[ -x "/usr/local/bin/${PROJECT_SLUG}-backup" ] \
  && ok "دستور ${PROJECT_SLUG}-backup نصب است" \
  || warn "میان‌بر /usr/local/bin/${PROJECT_SLUG}-backup نصب نیست" \
          "ln -s $ROOT/deploy/backup.sh /usr/local/bin/${PROJECT_SLUG}-backup"

# ── schedule ─────────────────────────────────────────────────────────────────
if [ -f "$CRON" ]; then
  # Which tiers are *actually* scheduled, read out of the file rather than
  # assumed. An earlier version grepped for the literal string "backup.sh
  # <tier>", which misses a cron line calling the /usr/local/bin shortcut — so
  # a working schedule was reported as three missing tiers.
  cron_body="$(grep -vE '^[[:space:]]*#' "$CRON" 2>/dev/null)"
  scheduled=""
  for tier in $BACKUP_TIERS; do
    echo "$cron_body" | grep -qE "(backup\.sh|${PROJECT_SLUG}-backup)[[:space:]]+$tier([[:space:]]|$|>)" \
      && scheduled="$scheduled $tier"
  done
  scheduled="${scheduled# }"

  # `${#BACKUP_TIERS}` would be the length of the string, not the number of
  # tiers in it — 19 rather than 3.
  n_tiers="$(set -- $BACKUP_TIERS; echo $#)"
  if [ "$scheduled" = "$BACKUP_TIERS" ]; then
    ok "کرون بکاپ نصب است و هر $n_tiers لایه زمان‌بندی شده‌اند"
  elif [ -n "$scheduled" ]; then
    warn "کرون بکاپ فقط این لایه‌ها را دارد: $scheduled" "docs/deployment.md گام ۹ — هر سه خط"
  else
    warn "کرون بکاپ نصب است ولی هیچ‌کدام از لایه‌های $BACKUP_TIERS را اجرا نمی‌کند" \
         "خط فعلی: $(echo "$cron_body" | grep -v '^[[:space:]]*$' | head -1)"
  fi
else
  bad "کرون بکاپ نصب نیست — هیچ بکاپ خودکاری گرفته نمی‌شود" "docs/deployment.md گام ۹"
fi

# cron itself has to be running, or a perfect crontab fires never.
if systemctl is-active --quiet cron 2>/dev/null || systemctl is-active --quiet crond 2>/dev/null; then
  ok "سرویس cron در حال اجراست"
else
  bad "سرویس cron اجرا نمی‌شود — هیچ زمان‌بندی‌ای اجرا نخواهد شد" "systemctl enable --now cron"
fi

# ── the files ────────────────────────────────────────────────────────────────
#
# A cron entry that exists but never produced a file is the failure mode that
# looks exactly like success until the day you need to restore.
newest="$(ls -1t "$BR"/*/*.tar.gz "$BR"/*/*.sql.gz "$BR"/*.tar.gz "$BR"/*.sql.gz 2>/dev/null | head -1)"
if [ -z "$newest" ]; then
  bad "هیچ فایل بکاپی در $BR نیست" "$ROOT/deploy/backup.sh daily"
else
  age_h="$(age_hours "$newest")"
  size="$(du -h "$newest" 2>/dev/null | cut -f1)"
  if [ "${age_h:-999}" -le "$BACKUP_MAX_AGE_H" ]; then
    ok "آخرین بکاپ $age_h ساعت پیش گرفته شده ($size)"
  else
    bad "آخرین بکاپ $age_h ساعت پیش است — کرون هست ولی کار نمی‌کند" "tail -30 $BACKUP_LOG"
  fi

  # An archive that cannot be decompressed is not a backup, and gzip finds that
  # out in a second. Nobody checks otherwise until the day it matters.
  if gunzip -t "$newest" 2>/dev/null; then
    ok "آخرین آرشیو سالم است (gzip بدون خطا باز می‌شود)"
  else
    bad "آخرین آرشیو خراب است — قابل بازگردانی نیست" "$ROOT/deploy/backup.sh daily && rm '$newest'"
  fi

  # A backup that is suspiciously smaller than the one before it usually means
  # a dump that failed halfway and still wrote a file.
  prev="$(ls -1t "$BR"/*/*.tar.gz "$BR"/*.tar.gz 2>/dev/null | sed -n 2p)"
  if [ -n "$prev" ]; then
    a="$(stat -c %s "$newest")"; b="$(stat -c %s "$prev")"
    if [ "$b" -gt 0 ] && [ $((a * 100 / b)) -lt 50 ]; then
      bad "آخرین بکاپ کمتر از نصف بکاپ قبلی است ($(numfmt --to=iec "$a" 2>/dev/null || echo "$a") در برابر $(numfmt --to=iec "$b" 2>/dev/null || echo "$b"))" \
          "tail -30 $BACKUP_LOG — احتمالاً دامپ نیمه‌کاره مانده"
    else
      ok "اندازه‌ی بکاپ نسبت به قبلی طبیعی است"
    fi
  fi

  # Reporting "hourly is empty / daily is empty / weekly is empty" right after
  # "a backup was taken an hour ago" is warnings that contradict the line above
  # them, and says nothing about where the file actually went.
  tiers_found=""; tiers_missing=""
  for tier in $BACKUP_TIERS; do
    n="$(ls -1 "$BR/$tier"/* 2>/dev/null | wc -l)"
    if [ "$n" -gt 0 ]; then tiers_found="$tiers_found $tier($n)"; else tiers_missing="$tiers_missing $tier"; fi
  done
  flat="$(ls -1 "$BR"/*.tar.gz "$BR"/*.sql.gz 2>/dev/null | wc -l)"

  if   [ -z "$tiers_missing" ]; then ok "هر لایه پر است:$tiers_found"
  elif [ -n "$tiers_found" ];   then warn "لایه‌های پر:$tiers_found — هنوز خالی:$tiers_missing" "اگر تازه نصب شده طبیعی است؛ فردا دوباره ببینید"
  elif [ "$flat" -gt 0 ];       then warn "بکاپ‌ها تک‌لایه در $BR ذخیره می‌شوند ($flat فایل)، نه چندلایه" "کرون چندلایه‌ی گام ۹ را نصب کنید"
  else                               warn "هیچ لایه‌ای پر نیست" "$ROOT/deploy/backup.sh daily"
  fi
fi

# ── off-site ─────────────────────────────────────────────────────────────────
#
# A backup on the machine it protects is not a backup.
rc="$(env_get BACKUP_RCLONE_REMOTE)"; sc="$(env_get BACKUP_SCP_TARGET)"
if [ -n "$rc" ]; then
  have rclone && ok "انتقال به بیرون از سرور با rclone تنظیم شده ($rc)" \
              || bad "BACKUP_RCLONE_REMOTE تنظیم شده ولی rclone نصب نیست" "curl https://rclone.org/install.sh | bash"
elif [ -n "$sc" ]; then
  ok "انتقال به بیرون از سرور با scp تنظیم شده"
else
  bad "بکاپ فقط روی همین سرور می‌ماند — اگر سرور از دست برود، بکاپ هم می‌رود" \
      "یکی از این دو را در .env بگذارید: BACKUP_RCLONE_REMOTE=... یا BACKUP_SCP_TARGET=..."
fi

# ── restore test ─────────────────────────────────────────────────────────────
#
# The only check that proves a backup is a backup. verify-backup.sh writes the
# stamp; without a date here, nobody has ever restored one.
[ -x "$ROOT/deploy/verify-backup.sh" ] \
  || warn "deploy/verify-backup.sh اجرایی نیست" "chmod +x deploy/verify-backup.sh"

if [ -f "$RESTORE_STAMP" ]; then
  d="$(age_days "$RESTORE_STAMP")"
  [ "${d:-999}" -le "$RESTORE_TEST_MAX_DAYS" ] \
    && ok "تست بازگردانی $d روز پیش انجام شده" \
    || warn "آخرین تست بازگردانی $d روز پیش بوده" "$ROOT/deploy/verify-backup.sh"
else
  warn "هیچ‌وقت تست بازگردانی انجام نشده — بکاپی که بازگردانی نشده، یک فایل است نه بکاپ" \
       "$ROOT/deploy/verify-backup.sh  (ماهی یک بار)"
fi
