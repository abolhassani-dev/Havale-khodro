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
#
# Decided by the shebang, not by the ‎.sh‎ suffix. Not every ‎.sh‎ file is a
# command: notify.sh is a library that watchdog.sh reads with ‎.‎, and its own
# header says nothing in it runs on its own. Flagging it produced a ✗ whose
# suggested fix — chmod +x — changed nothing except the ✗, which is the worst
# kind of check: it teaches you to make the report green instead of the server
# right.
#
# A shebang is the file saying which it is, and it stays right by itself: a new
# script meant to be run will have one, a new library will not.
#
# Two lists each: the bare names for the message, and the full paths for the
# command. Built as they are found rather than stitched together afterwards —
# the first version rebuilt the paths with a single printf over all the names,
# and printf recycles its format across the remaining arguments, so two
# offenders came out as `…/deploy/first.sh second.sh/deploy/`. A fix command
# that is quietly wrong is worse than none: it gets pasted.
nonexec=""; nonexec_paths=""
oddexec="";  oddexec_paths=""
for s in "$ROOT"/deploy/*.sh; do
  [ -f "$s" ] || continue
  if head -n 1 "$s" 2>/dev/null | grep -q '^#!'; then
    if [ ! -x "$s" ]; then
      nonexec="$nonexec $(basename "$s")"
      nonexec_paths="$nonexec_paths $s"
    fi
  elif [ -x "$s" ]; then
    # Harmless, but it means somebody expects to run a file that will not work
    # when run — and will get a confusing failure rather than "permission
    # denied" the moment they try.
    oddexec="$oddexec $(basename "$s")"
    oddexec_paths="$oddexec_paths $s"
  fi
done

[ -z "$nonexec" ] \
  && ok "همه‌ی اسکریپت‌های اجرایی deploy مجوز اجرا دارند" \
  || bad "اسکریپت غیراجرایی:$nonexec — کرونی که صداشان بزند بی‌صدا شکست می‌خورد" \
         "chmod +x$nonexec_paths"

[ -z "$oddexec" ] \
  || warn "فایل کتابخانه‌ای با مجوز اجرا:$oddexec — این‌ها source می‌شوند، اجرا نه" \
          "chmod -x$oddexec_paths"
