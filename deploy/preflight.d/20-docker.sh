# shellcheck shell=bash disable=SC2154
# داکر — نصب، سیاست ری‌استارت، سقف حافظه، چرخش لاگ
#
# Portable: reads whatever compose project it is pointed at.

section "۲۰ — داکر"

if ! have docker; then
  bad "داکر نصب نیست" "docs/deployment.md گام ۲"
  return 0 2>/dev/null || true
else
  ok "داکر نصب است ($(docker --version 2>/dev/null | cut -d, -f1))"

  # Without this, a reboot at 3am takes the site down until somebody notices.
  [ "$(systemctl is-enabled docker 2>/dev/null)" = "enabled" ] \
    && ok "داکر بعد از ریبوت خودکار بالا می‌آید" \
    || bad "داکر بعد از ریبوت بالا نمی‌آید" "systemctl enable docker"

  docker compose version >/dev/null 2>&1 \
    && ok "docker compose (نسخه ۲) در دسترس است" \
    || bad "docker compose v2 نصب نیست" "docs/deployment.md گام ۲"
fi

# ── per-container settings ───────────────────────────────────────────────────
#
# Read off the running containers, not off the compose file. The point is to
# know whether the settings are in effect — a compose change that was never
# applied because nobody recreated the containers looks identical on disk.
n_containers=0
unlimited=""; unrotated=""; no_policy=""; restarting=""; unhealthy=""
limits_mb=0

for cid in $(compose_ids); do
  n_containers=$((n_containers + 1))
  name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | tr -d '/')"

  mem="$(docker inspect -f '{{.HostConfig.Memory}}' "$cid" 2>/dev/null)"
  if [ "${mem:-0}" -gt 0 ] 2>/dev/null; then
    limits_mb=$((limits_mb + mem / 1048576))
  else
    unlimited="$unlimited $name"
  fi

  docker inspect -f '{{.HostConfig.LogConfig.Config}}' "$cid" 2>/dev/null | grep -q 'max-size' \
    || unrotated="$unrotated $name"

  policy="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$cid" 2>/dev/null)"
  case "$policy" in unless-stopped|always) ;; *) no_policy="$no_policy $name" ;; esac

  # A container that keeps dying and coming back looks "running" every time you
  # check, and is the failure that hides best.
  count="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null)"
  [ "${count:-0}" -ge 3 ] 2>/dev/null && restarting="$restarting ${name}(${count})"

  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null)"
  [ -n "$health" ] && [ "$health" != "healthy" ] && unhealthy="$unhealthy ${name}(${health})"
done

if [ "$n_containers" = "0" ]; then
  # Counted, not just looped over. A loop with nothing in it finds no
  # violations and prints a tick — the same false pass that once made the
  # masking audit report "no phone leaked in 0 listings" as if it had checked.
  skip "کانتینری در حال اجرا نیست — تنظیمات کانتینرها بررسی نشد"
else
  [ -z "$no_policy" ] \
    && ok "هر $n_containers کانتینر سیاست ری‌استارت دارند" \
    || bad "بدون سیاست ری‌استارت:$no_policy" "docker compose up -d --force-recreate"

  [ -z "$unlimited" ] \
    && ok "همه‌ی کانتینرها سقف حافظه دارند" \
    || warn "بدون سقف حافظه:$unlimited — کرنل موقع کمبود، بزرگ‌ترین را می‌کشد (معمولاً دیتابیس)" \
            "./deploy/update.sh (کانتینرها باید دوباره ساخته شوند تا سقف اعمال شود)"

  # The quietest way a small server dies: logs grow until the disk is full,
  # the database cannot write, everything stops, and nothing in the application
  # log says why — because there was no room to write that either.
  [ -z "$unrotated" ] \
    && ok "چرخش لاگ کانتینرها فعال است" \
    || warn "بدون چرخش لاگ:$unrotated — لاگ‌ها تا پر شدن دیسک رشد می‌کنند" "./deploy/update.sh"

  [ -z "$restarting" ] \
    && ok "هیچ کانتینری در حلقه‌ی ری‌استارت نیست" \
    || bad "کانتینرهایی که چند بار ری‌استارت شده‌اند:$restarting" \
           "docker compose logs --tail 80 $(echo "$restarting" | sed 's/([0-9]*)//g')"

  [ -z "$unhealthy" ] \
    && ok "وضعیت سلامت کانتینرها درست است" \
    || bad "کانتینر ناسالم:$unhealthy" "docker inspect --format '{{json .State.Health}}' <name> | head -c 400"

  # The limits are ceilings, not reservations — but their sum still has to
  # leave the host room to breathe, or the first time they are all approached
  # at once the machine is out of memory anyway and the limits bought nothing.
  if [ "$limits_mb" -gt 0 ]; then
    total_mb="$(free -m | awk '/^Mem:/{print $2}')"
    pct=$((limits_mb * 100 / total_mb))
    if [ "$pct" -ge 85 ]; then
      warn "مجموع سقف‌ها ${limits_mb}MB از ${total_mb}MB رم است (${pct}%) — جایی برای سیستم‌عامل نمی‌ماند" \
           "در .env مقدارهای *_MEM_LIMIT را کم کنید، سپس ./deploy/update.sh"
    else
      ok "مجموع سقف‌ها ${limits_mb}MB از ${total_mb}MB رم (${pct}%) — جای کافی برای سیستم می‌ماند"
    fi
  fi
fi

# Reclaimable space is not a fault, but it is the cheapest disk you will ever
# find, and it is worth knowing about before the disk check goes red.
if [ "$FULL" = "1" ]; then
  reclaim="$(docker system df 2>/dev/null | awk '/Images/{print $NF}')"
  [ -n "$reclaim" ] && note "قابل آزادسازی با docker system prune: $reclaim"
fi
