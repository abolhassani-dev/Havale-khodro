# shellcheck shell=bash disable=SC2154
# سرویس‌ها — کانتینرها، دیتابیس، مهاجرت‌ها
#
# Half portable: the loop over SERVICES is generic, the migration check is
# Prisma's.

section "۴۰ — سرویس‌ها"

for s in $SERVICES; do
  st="$(svc_state "$s")"
  if [ "$st" = "running" ]; then
    ok "سرویس $s بالاست"
  elif [ -z "$st" ] && [[ " $OPTIONAL_SERVICES " == *" $s "* ]]; then
    warn "سرویس $s وجود ندارد (اختیاری)" "در صورت نیاز: docker compose up -d $s"
  else
    bad "سرویس $s بالا نیست (وضعیت: ${st:-وجود ندارد})" "docker compose up -d $s && docker compose logs $s --tail 50"
  fi
done

# A container in state `running` whose database is refusing connections is the
# outage that looks healthiest from outside.
if docker compose exec -T "$DB_SERVICE" pg_isready -q 2>/dev/null; then
  ok "دیتابیس به اتصال جواب می‌دهد"

  # Connection headroom. Running out shows up as random failures under load,
  # never as a clear message.
  used="$(db_query 'SELECT count(*) FROM pg_stat_activity;')"
  maxc="$(db_query 'SHOW max_connections;')"
  if [ -n "$used" ] && [ -n "$maxc" ] && [ "$maxc" -gt 0 ] 2>/dev/null; then
    pct=$((used * 100 / maxc))
    if [ "$pct" -ge 80 ]; then
      bad "اتصال‌های دیتابیس $used از $maxc (${pct}%)" "SELECT * FROM pg_stat_activity ORDER BY backend_start;"
    else
      ok "اتصال‌های دیتابیس $used از $maxc (${pct}%)"
    fi
  fi

  # A query that has been running for minutes is holding locks the rest of the
  # application is queuing behind.
  longq="$(db_query "SELECT count(*) FROM pg_stat_activity WHERE state='active' AND now()-query_start > interval '60 seconds';")"
  [ "${longq:-0}" -gt 0 ] 2>/dev/null \
    && warn "$longq کوئری بیش از یک دقیقه در حال اجراست" \
            "SELECT pid, now()-query_start AS age, left(query,80) FROM pg_stat_activity WHERE state='active' ORDER BY age DESC;" \
    || ok "کوئری طولانی‌مدتی در جریان نیست"

  size="$(db_query 'SELECT pg_size_pretty(pg_database_size(current_database()));')"
  [ -n "$size" ] && note "اندازه‌ی دیتابیس: $size"
else
  bad "دیتابیس به اتصال جواب نمی‌دهد" "docker compose logs $DB_SERVICE --tail 50"
fi

# ── migrations ───────────────────────────────────────────────────────────────
#
# An application running against a schema older than its code fails in ways
# that look like application bugs: a column that "does not exist", a query that
# returns nothing. Slow, so it is behind --full.
if [ "$FULL" = "1" ] && [ "$(svc_state "$API_SERVICE")" = "running" ]; then
  out="$(docker compose exec -T "$API_SERVICE" npx prisma migrate status 2>&1)"
  if echo "$out" | grep -q 'Database schema is up to date'; then
    ok "همه‌ی مهاجرت‌های دیتابیس اعمال شده‌اند"
  elif echo "$out" | grep -qi 'following migration.*not.*applied\|pending'; then
    bad "مهاجرت اعمال‌نشده وجود دارد — کد جلوتر از ساختار دیتابیس است" \
        "docker compose exec -T $API_SERVICE npx prisma migrate deploy"
  else
    skip "وضعیت مهاجرت‌ها خوانده نشد"
  fi
fi
