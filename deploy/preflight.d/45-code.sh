# shellcheck shell=bash disable=SC2154
# کد روی سرور — نسخه و فایل‌های لازم
#
# Portable except EXPECTED_FILES.

section "۴۵ — کد روی سرور"

: "${EXPECTED_FILES:=frontend/index.html docker-compose.yml deploy/update.sh}"

if [ -d "$ROOT/.git" ] && have git; then
  local_sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"
  remote_sha="$(git -C "$ROOT" ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1)"
  cur_branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"

  if [ "$cur_branch" != "$BRANCH" ]; then
    bad "شاخه‌ی سرور «$cur_branch» است، نه $BRANCH" "./deploy/update.sh"
  elif [ -z "$remote_sha" ]; then
    skip "شاخه‌ی راه دور خوانده نشد (شبکه؟) — نسخه‌ی سرور: ${local_sha:0:7}"
  elif [ "$local_sha" = "$remote_sha" ]; then
    ok "کد سرور آخرین نسخه است (${local_sha:0:7})"
  else
    bad "کد سرور عقب است (${local_sha:0:7} در برابر ${remote_sha:0:7})" "./deploy/update.sh"
  fi

  # Files edited by hand on the server are the ones an update silently reverts,
  # and nobody remembers making them.
  dirty="$(git -C "$ROOT" status --porcelain 2>/dev/null | grep -v '^??' | wc -l)"
  [ "${dirty:-0}" -eq 0 ] \
    && ok "هیچ فایلی روی سرور دستی تغییر نکرده" \
    || warn "$dirty فایل ردیابی‌شده روی سرور دستی تغییر کرده — آپدیت بعدی برشان می‌گرداند" "git -C $ROOT status --short"
else
  skip "نصب از روی tarball — نسخه از گیت قابل تشخیص نیست"
fi

missing=""
for f in $EXPECTED_FILES; do
  [ -e "$ROOT/$f" ] || missing="$missing $f"
done
[ -z "$missing" ] \
  && ok "فایل‌های لازم سر جایشان‌اند" \
  || bad "فایل غایب:$missing" "./deploy/update.sh"

# Scripts that must be executable, or the cron entry pointing at them fails
# silently every time it fires.
nonexec=""
for s in "$ROOT"/deploy/*.sh; do
  [ -f "$s" ] || continue
  [ -x "$s" ] || nonexec="$nonexec $(basename "$s")"
done
[ -z "$nonexec" ] \
  && ok "همه‌ی اسکریپت‌های deploy اجرایی‌اند" \
  || bad "اسکریپت غیراجرایی:$nonexec — کرونی که صداشان بزند بی‌صدا شکست می‌خورد" "chmod +x $ROOT/deploy/*.sh"
