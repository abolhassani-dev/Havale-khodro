#!/usr/bin/env bash
#
# Load test the running deployment, and watch what it costs.
#
# The script inside the API container drives the traffic; this one watches the
# machine while it happens. Both halves matter: response times alone cannot
# tell you whether the system was comfortable or one request away from being
# killed by the memory limit.
#
# Traffic goes through nginx where nginx can be reached from inside — the real
# path: nginx, API, Prisma's pool, Postgres. With TLS switched on nginx answers
# internal HTTP with a redirect to the public address, so the script falls back
# to the API directly and says so in its first line. Either way the report
# names the path it measured.
#
#   ./deploy/loadtest.sh                       # asks for the account
#   ./deploy/loadtest.sh --users 100 --requests 2000
#   ./deploy/loadtest.sh --account نام‌کاربری   # asks only for the password
#
# The password is typed at a prompt and handed to the container on standard
# input. It is never an argument, so it appears neither in the shell history
# nor in `ps` output, which anybody with a login on the machine can read.
#
# Read-only unless you pass --write N. Never reveals a contact.
set -euo pipefail

cd "$(dirname "$0")/.."

# ── accounts ────────────────────────────────────────────────────────────────
# Collected here and passed on stdin; everything else goes through to the
# script inside the container untouched.
ACCOUNTS=()
FILE_SPECS=()
PASSTHRU=()

while [ $# -gt 0 ]; do
  case "$1" in
    --account)
      [ $# -ge 2 ] || { echo "پس از --account نام کاربری لازم است" >&2; exit 1; }
      ACCOUNTS+=("$2")
      shift 2
      ;;
    --accounts-file)
      # A file kept outside the repository, one «username:password» per line.
      # Credentials belong on the machine that runs the test, never in a file
      # that gets committed — this is how a demo password ended up in a public
      # repository once already.
      [ $# -ge 2 ] || { echo "پس از --accounts-file مسیر فایل لازم است" >&2; exit 1; }
      [ -r "$2" ] || { echo "فایل «$2» خوانده نشد" >&2; exit 1; }
      case "$(git -C . check-ignore -q "$2" 2>/dev/null; echo $?)" in
        0|128) : ;;  # ignored by git, or outside a repository — both fine
        *) echo "  ⚠ این فایل زیر نظر گیت است؛ آن را بیرون از مخزن بگذارید." >&2 ;;
      esac
      while IFS= read -r LINE || [ -n "$LINE" ]; do
        LINE="${LINE%%$'\r'}"
        case "$LINE" in ''|'#'*) continue ;; esac
        [[ "$LINE" == *:* ]] || { echo "سطر بدون «:» در فایل حساب‌ها" >&2; exit 1; }
        FILE_SPECS+=("$LINE")
      done < "$2"
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
آزمون بار روی همین سروری که سایت رویش بالاست.

  ./deploy/loadtest.sh [گزینه‌ها]

گزینه‌ها:
  --users N       کاربر هم‌زمان (پیش‌فرض ۵۰)
  --requests N    مجموع درخواست (پیش‌فرض ۱۰۰۰)
  --write N       N درخواست خرید هم ثبت و بعد پاک می‌کند (پیش‌فرض ۰)
  --account نام   حساب نماینده؛ رمز جداگانه پرسیده می‌شود.
                  می‌توانید چند بار بدهید تا بار روی چند نشست پخش شود.
  --accounts-file مسیر
                  فایلی بیرون از مخزن، هر سطر «نام‌کاربری:رمز».
                  برای اجراهای پشت‌سرهم، تا رمز را هر بار تایپ نکنید.

نکته: محافظ نرخ روی هر نشست ۱۲۰۰ درخواست در ۱۵ دقیقه است. برای آزمون
سنگین‌تر از یک حساب، چند حساب بدهید.
USAGE
      exit 0
      ;;
    *)
      PASSTHRU+=("$1")
      shift
      ;;
  esac
done

if [ ${#ACCOUNTS[@]} -eq 0 ] && [ ${#FILE_SPECS[@]} -eq 0 ]; then
  read -rp "نام کاربری نماینده برای آزمون: " ONE
  [ -n "$ONE" ] || { echo "نام کاربری لازم است" >&2; exit 1; }
  ACCOUNTS+=("$ONE")
fi

# One prompt per account. `read -s` keeps the password off the screen; the
# pairs live in this shell's memory only, and go to the container on stdin.
SPECS=(${FILE_SPECS[@]+"${FILE_SPECS[@]}"})
for NAME in ${ACCOUNTS[@]+"${ACCOUNTS[@]}"}; do
  if [[ "$NAME" == *:* ]]; then
    # Given as user:pass on the command line — accepted, but say why not to.
    echo "  ⚠ رمز را در خط فرمان ندهید؛ در تاریخچه‌ی شل و خروجی ps می‌ماند." >&2
    SPECS+=("$NAME")
    continue
  fi
  read -rsp "رمز «$NAME»: " PASS
  echo
  [ -n "$PASS" ] || { echo "رمز خالی بود" >&2; exit 1; }
  SPECS+=("$NAME:$PASS")
done
unset PASS

SAMPLES="$(mktemp)"
DBPEAK="$(mktemp)"
trap 'rm -f "$SAMPLES" "$DBPEAK"' EXIT

echo "→ نمونه‌برداری از منابع در پس‌زمینه شروع شد"
(
  while true; do
    docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null >> "$SAMPLES" || true
    # Connections actually in use, which is what a pool exhaustion looks like
    # from the database's side. Reads nothing from stdin — the accounts are on
    # their way to the other container.
    docker compose exec -T db psql -U "${POSTGRES_USER:-havale}" -d "${POSTGRES_DB:-havale}" \
      -tAc "select count(*) from pg_stat_activity where datname = current_database();" \
      </dev/null 2>/dev/null >> "$DBPEAK" || true
    sleep 2
  done
) </dev/null &
WATCHER=$!

echo "→ اجرای آزمون"
echo
set +e
printf '%s\n' "${SPECS[@]}" |
  docker compose exec -T api node scripts/loadtest.js \
    --accounts-stdin ${PASSTHRU[@]+"${PASSTHRU[@]}"}
RESULT=$?
set -e
unset SPECS

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
echo "یادآوری: بار از داخل خود سرور آمد. اگر سطر «هدف» بالا گفته nginx در مسیر"
echo "نبوده، تأخیر واقعی کاربر کمی بیشتر از این اعداد است — به‌اندازه‌ی nginx،"
echo "TLS و مسیر اینترنت."

exit "$RESULT"
