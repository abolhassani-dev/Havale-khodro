#!/usr/bin/env bash
#
# Load test the running deployment, and watch what it costs.
#
# The script inside the API container drives the traffic; this one watches the
# machine while it happens. Both halves matter: response times alone cannot
# tell you whether the system was comfortable or one request away from being
# killed by the memory limit.
#
# Traffic goes through nginx, so the path measured is the real one — nginx,
# API, Prisma's pool, Postgres — everything except TLS and the public internet.
#
#   ./deploy/loadtest.sh --account نام‌کاربری:رمز
#   ./deploy/loadtest.sh --users 100 --requests 2000 --account a:x --account b:y
#
# Read-only unless you pass --write N. Never reveals a contact.
#
# The password is typed on this server and never leaves it. Prefer a real
# agency account you own, on a quiet hour.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! printf '%s\n' "$@" | grep -q -- '--account'; then
  cat >&2 <<'USAGE'
یک حساب نماینده لازم است:

  ./deploy/loadtest.sh --account نام‌کاربری:رمز

گزینه‌ها:
  --users N       کاربر هم‌زمان (پیش‌فرض ۵۰)
  --requests N    مجموع درخواست (پیش‌فرض ۱۰۰۰)
  --write N       N درخواست خرید هم ثبت و بعد پاک می‌کند (پیش‌فرض ۰)
  --account a:b   می‌توانید چند بار بدهید تا بار روی چند نشست پخش شود

نکته: محافظ نرخ روی هر نشست ۱۲۰۰ درخواست در ۱۵ دقیقه است. برای آزمون
سنگین‌تر از یک حساب، چند حساب بدهید.
USAGE
  exit 1
fi

SAMPLES="$(mktemp)"
DBPEAK="$(mktemp)"
trap 'rm -f "$SAMPLES" "$DBPEAK"' EXIT

echo "→ نمونه‌برداری از منابع در پس‌زمینه شروع شد"
(
  while true; do
    docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null >> "$SAMPLES" || true
    # Connections actually in use, which is what a pool exhaustion looks like
    # from the database's side.
    docker compose exec -T db psql -U "${POSTGRES_USER:-havale}" -d "${POSTGRES_DB:-havale}" \
      -tAc "select count(*) from pg_stat_activity where datname = current_database();" \
      2>/dev/null >> "$DBPEAK" || true
    sleep 2
  done
) &
WATCHER=$!

echo "→ اجرای آزمون"
echo
set +e
docker compose exec -T api node scripts/loadtest.js --target http://web "$@"
RESULT=$?
set -e

kill "$WATCHER" 2>/dev/null || true
wait "$WATCHER" 2>/dev/null || true

echo
echo "─── مصرف منابع در طول آزمون (اوج هر کانتینر) ───"
# The peak is what matters: an average hides the moment that would have killed
# the container.
awk -F'|' '
  {
    name = $1
    gsub(/%/, "", $2)
    cpu = $2 + 0
    split($3, mem, " / ")
    m = mem[1]
    unit = m; sub(/^[0-9.]+/, "", unit)
    val = m + 0
    if (unit ~ /GiB/) val *= 1024
    if (unit ~ /KiB/) val /= 1024
    if (cpu > maxcpu[name]) maxcpu[name] = cpu
    if (val > maxmem[name]) maxmem[name] = val
    limit[name] = mem[2]
  }
  END {
    for (n in maxcpu)
      printf "  %-24s CPU %6.1f%%   حافظه %7.0f MiB  از %s\n", n, maxcpu[n], maxmem[n], limit[n]
  }
' "$SAMPLES" | sort

if [ -s "$DBPEAK" ]; then
  PEAK="$(sort -n "$DBPEAK" | tail -1)"
  echo
  echo "  بیشترین اتصال هم‌زمان دیتابیس: ${PEAK} (سقف استخر: ۱۰، سقف پستگرس: ۱۰۰)"
fi

echo
echo "یادآوری: بار این آزمون از داخل خود سرور آمد، پس شبکه‌ی اینترنت و TLS در"
echo "اعداد بالا نیست — تأخیر واقعی کاربر کمی بیشتر از این است."

exit "$RESULT"
