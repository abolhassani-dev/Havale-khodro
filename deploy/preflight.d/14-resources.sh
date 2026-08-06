# shellcheck shell=bash disable=SC2154
# منابع — دیسک، حافظه، swap
#
# Portable.

section "۱۴ — منابع سرور"

usage="$(df -P "$ROOT" | awk 'NR==2{print $5}' | tr -d '%')"
if   [ "${usage:-0}" -ge "$DISK_FAIL" ]; then
  bad "دیسک ${usage}% پر است — Postgres با پر شدن دیسک می‌ایستد" \
      "docker image prune -f && ls -lt $BACKUP_ROOT/*/"
elif [ "${usage:-0}" -ge "$DISK_WARN" ]; then
  warn "دیسک ${usage}% پر است" "docker system df"
else
  ok "دیسک ${usage}% پر است ($(df -Ph "$ROOT" | awk 'NR==2{print $4}') آزاد)"
fi

# Inodes run out independently of bytes, and when they do everything fails with
# "No space left on device" while df shows plenty of room — which sends people
# looking in exactly the wrong place.
inodes="$(df -Pi "$ROOT" 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')"
if [ "${inodes:-0}" -ge 90 ] 2>/dev/null; then
  bad "inodeها ${inodes}% مصرف شده‌اند — «No space left» می‌گیرید در حالی که df جا نشان می‌دهد" \
      "بیشترین فایل‌ها: du --inodes -x -d 3 / 2>/dev/null | sort -rn | head"
else
  ok "inodeها ${inodes:-؟}% مصرف شده‌اند"
fi

mem_free="$(free | awk '/^Mem:/{printf "%d", $7*100/$2}')"
mem_total="$(free -h | awk '/^Mem:/{print $2}')"
if   [ "${mem_free:-100}" -le 8 ];  then
  bad "فقط ${mem_free}% از $mem_total حافظه آزاد است — کرنل معمولاً Postgres را می‌کشد" "docker stats --no-stream"
elif [ "${mem_free:-100}" -le 15 ]; then
  warn "${mem_free}% از $mem_total حافظه آزاد است" "docker stats --no-stream"
else
  ok "${mem_free}% از $mem_total حافظه آزاد است"
fi

# Swap, on a server with a few gigabytes of RAM, is not about running from
# disk — it is about what happens during a spike. With none, the kernel's only
# way to reclaim memory is to kill something, and it kills the largest process,
# which is the database.
swap_kb="$(free -k | awk '/^Swap:/{print $2}')"
if [ "${swap_kb:-0}" -eq 0 ] 2>/dev/null; then
  warn "سرور اصلاً swap ندارد — موقع اوج مصرف، کرنل چاره‌ای جز کشتن یک پروسه ندارد (و بزرگ‌ترین را می‌کشد: دیتابیس)" \
       "fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab && sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf"
else
  swappiness="$(cat /proc/sys/vm/swappiness 2>/dev/null)"
  ok "swap فعال است ($(free -h | awk '/^Swap:/{print $2}')، swappiness=${swappiness:-؟})"
  # Swap that is heavily in use on a box with free RAM means something already
  # spiked and the kernel has not paged it back.
  swap_used_pct="$(free | awk '/^Swap:/{ if ($2>0) printf "%d", $3*100/$2; else print 0 }')"
  [ "${swap_used_pct:-0}" -ge 60 ] 2>/dev/null && \
    warn "${swap_used_pct}% از swap مصرف شده — یعنی حافظه‌ی اصلی کم آمده است" "docker stats --no-stream"
fi

# One-minute load per core. Above 2× cores sustained means requests are queuing
# behind the CPU rather than behind the database.
if [ -r /proc/loadavg ]; then
  load1="$(awk '{print $1}' /proc/loadavg)"
  cores="$(nproc 2>/dev/null || echo 1)"
  per_core="$(awk -v l="$load1" -v c="$cores" 'BEGIN{printf "%.2f", l/c}')"
  if awk -v p="$per_core" 'BEGIN{exit !(p > 2)}'; then
    warn "بار پردازنده $load1 روی $cores هسته (${per_core} به ازای هر هسته)" "top -bn1 | head -15"
  else
    ok "بار پردازنده $load1 روی $cores هسته (${per_core} به ازای هر هسته)"
  fi
fi
