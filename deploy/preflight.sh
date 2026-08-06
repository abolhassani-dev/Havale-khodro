#!/usr/bin/env bash
#
# Is this server actually set up the way we said it should be?
#
# Everything in docs/deployment.md is a step somebody has to remember to do,
# and the ones that matter most are precisely the ones that fail silently:
# a backup cron that was never installed, an off-site copy that was never
# configured, a demo account still active on a live system, an encryption key
# left empty so the phone numbers are sitting in the database in clear text.
# None of those break a page. You find out about them on the day you needed
# them to have been right.
#
# So this reads the server and says, item by item, whether it was done —
# and where it was not, prints the exact command that does it.
#
#   /opt/feranocar/deploy/preflight.sh          # everything except the slow checks
#   /opt/feranocar/deploy/preflight.sh --full   # also the certbot renewal rehearsal
#
# It changes nothing. No restart, no file written, no alert sent — safe to run
# on a live system at any time, as often as you like.
#
# It never prints a secret. Where a value is a password or a key it checks that
# one is present and long enough, and prints only that much.
#
# Exit code: 0 when nothing failed, 1 when something did.
#
set -uo pipefail   # not -e: a failing check is the output, not a crash

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

BRANCH="${BRANCH:-claude/delegation-platform-phase-one-0xfqz7}"

pass=0; warn=0; fail=0; skipped=0
FAILED_ITEMS=()

# ── output ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=''; Y=''; R=''; D=''; B=''; N=''
fi

section() { printf '\n%s▸ %s%s\n' "$B" "$1" "$N"; }
ok()   { pass=$((pass+1));    printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
skip() { skipped=$((skipped+1)); printf '  %s–%s %s%s%s\n' "$D" "$N" "$D" "$1" "$N"; }

# A finding is only useful with the command that clears it, so `fix` is not
# optional here — every warn and every fail carries one.
warn() {
  warn=$((warn+1))
  printf '  %s!%s %s\n' "$Y" "$N" "$1"
  [ -n "${2:-}" ] && printf '      %s↳ %s%s\n' "$D" "$2" "$N"
  return 0
}
bad() {
  fail=$((fail+1)); FAILED_ITEMS+=("$1")
  printf '  %s✗%s %s\n' "$R" "$N" "$1"
  [ -n "${2:-}" ] && printf '      %s↳ %s%s\n' "$D" "$2" "$N"
  return 0
}

# ── helpers ──────────────────────────────────────────────────────────────────

# Reads one key out of .env. Callers must not echo the result for secrets —
# use `set_and_long` for those, which reports a length and never a value.
env_get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'; }

# True when a secret is present and at least $2 characters. The length is the
# only thing about it that ever reaches the screen.
set_and_long() {
  local v; v="$(env_get "$1")"
  [ -n "$v" ] && [ "${#v}" -ge "${2:-16}" ]
}

have() { command -v "$1" >/dev/null 2>&1; }

svc_state() {
  docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null \
    | awk -v s="$1" '$1==s{print $2}'
}

printf '%s┌─────────────────────────────────────────────────────────┐%s\n' "$B" "$N"
printf '%s│  فرانوکار — بررسی وضعیت سرور                            │%s\n' "$B" "$N"
printf '%s└─────────────────────────────────────────────────────────┘%s\n' "$B" "$N"
printf '%s  %s · %s%s\n' "$D" "$ROOT" "$(date '+%Y-%m-%d %H:%M')" "$N"

if [ "$(id -u)" != "0" ]; then
  printf '\n%s! بدون root اجرا شده — بعضی بررسی‌ها (‎.env، ufw، کرون) ناقص می‌مانند.%s\n' "$Y" "$N"
  printf '%s  دوباره با: sudo %s/deploy/preflight.sh%s\n' "$D" "$ROOT" "$N"
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۱ — امن‌سازی پایه‌ی سرور (گام ۱ و ۱.۵)"
# ═════════════════════════════════════════════════════════════════════════════

tz="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)"
if [ "$tz" = "Asia/Tehran" ]; then
  ok "منطقه‌ی زمانی: Asia/Tehran"
else
  # Not cosmetic: the daily reveal quota resets on the server's idea of
  # midnight, so a wrong zone moves the reset into the middle of the workday.
  bad "منطقه‌ی زمانی «${tz:-نامشخص}» است، نه Asia/Tehran" \
      "timedatectl set-timezone Asia/Tehran"
fi

# SSH: key-only is the goal; password login plus fail2ban is the accepted
# interim; password login alone is the one real problem.
sshd_pw="$(sshd -T 2>/dev/null | awk '/^passwordauthentication /{print $2}')"
if [ "$sshd_pw" = "no" ]; then
  ok "ورود SSH با رمز بسته است (فقط کلید)"
elif [ -z "$sshd_pw" ]; then
  skip "وضعیت SSH خوانده نشد (sshd -T نیاز به root دارد)"
elif systemctl is-active --quiet fail2ban 2>/dev/null; then
  warn "ورود SSH با رمز باز است — fail2ban هست، ولی جای کلید را نمی‌گیرد" \
       "docs/deployment.md گام ۱ — بعد از تست کلید: PasswordAuthentication no"
else
  bad "ورود SSH با رمز باز است و fail2ban هم نصب نیست" \
      "apt install -y fail2ban && systemctl enable --now fail2ban  (و بعد گام ۱ سند)"
fi

if have ufw && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ok "فایروال ufw فعال است"
  rules="$(ufw status 2>/dev/null)"
  for p in 22 80 443; do
    echo "$rules" | grep -qE "(^|[^0-9])$p/tcp" || \
      warn "پورت $p در ufw باز نیست" "ufw allow $p/tcp"
  done
  if [ -f deploy/nginx/adminer.conf ]; then
    echo "$rules" | grep -qE "(^|[^0-9])8443/tcp" \
      && ok "پورت ۸۴۴۳ (پنل دیتابیس) در فایروال باز است" \
      || warn "پنل دیتابیس نصب است ولی پورت ۸۴۴۳ در ufw باز نیست" "ufw allow 8443/tcp"
  fi
  # The two that must never be reachable from outside. Postgres on the open
  # internet is scanned for constantly, and the API without nginx in front of
  # it is the same application with none of the TLS or the headers.
  for p in 5432 3000; do
    echo "$rules" | grep -qE "(^|[^0-9])$p/tcp +ALLOW" \
      && bad "پورت $p از بیرون باز است — نباید باشد" "ufw delete allow $p/tcp"
  done
else
  bad "فایروال ufw فعال نیست" \
      "apt install -y ufw && ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 8443/tcp && ufw --force enable"
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۲ — داکر (گام ۲)"
# ═════════════════════════════════════════════════════════════════════════════

if have docker; then
  ok "داکر نصب است ($(docker --version 2>/dev/null | cut -d, -f1))"
  # Without this, a reboot at 3am takes the site down until somebody notices.
  [ "$(systemctl is-enabled docker 2>/dev/null)" = "enabled" ] \
    && ok "داکر بعد از ریبوت خودکار بالا می‌آید" \
    || bad "داکر بعد از ریبوت بالا نمی‌آید" "systemctl enable docker"
  docker compose version >/dev/null 2>&1 \
    && ok "docker compose (نسخه ۲) در دسترس است" \
    || bad "docker compose v2 نصب نیست" "docs/deployment.md گام ۲"
else
  bad "داکر نصب نیست" "docs/deployment.md گام ۲"
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۳ — تنظیمات و رمزها (گام ۴)"
# ═════════════════════════════════════════════════════════════════════════════

if [ ! -f .env ]; then
  bad "فایل .env وجود ندارد — سیستم بدون آن بالا نمی‌آید" "cp .env.example .env  (و بعد گام ۴)"
else
  mode="$(stat -c '%a' .env 2>/dev/null)"
  [ "$mode" = "600" ] \
    && ok "دسترسی .env روی ۶۰۰ است (فقط root)" \
    || bad "دسترسی .env روی $mode است، نه ۶۰۰ — رمزها برای بقیه‌ی کاربران خواندنی‌اند" "chmod 600 .env"

  set_and_long POSTGRES_PASSWORD 16   && ok "POSTGRES_PASSWORD تنظیم شده"        || bad "POSTGRES_PASSWORD خالی یا کوتاه است" "sed -i \"s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=\$(openssl rand -base64 24)|\" .env"
  set_and_long SESSION_SECRET   32   && ok "SESSION_SECRET تنظیم شده"            || bad "SESSION_SECRET خالی یا کوتاه است — نشست‌ها قابل جعل می‌شوند" "sed -i \"s|^SESSION_SECRET=.*|SESSION_SECRET=\$(openssl rand -hex 32)|\" .env"
  set_and_long SEED_ADMIN_PASSWORD 12 && ok "SEED_ADMIN_PASSWORD تنظیم شده"      || warn "SEED_ADMIN_PASSWORD خالی است" "اگر مدیر کل ساخته شده، بی‌اهمیت است"

  # The whole point of encrypting the phone numbers is a stolen dump being
  # unreadable. An empty key is not an error anywhere — the code passes values
  # through untouched — so nothing complains and the column stays clear text.
  dek="$(env_get DATA_ENCRYPTION_KEY)"
  if [ -z "$dek" ]; then
    bad "DATA_ENCRYPTION_KEY خالی است — شماره‌های تماس رمز نمی‌شوند" \
        "sed -i \"s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=\$(openssl rand -hex 32)|\" .env && docker compose restart api"
  elif [ "${#dek}" -lt 32 ]; then
    warn "DATA_ENCRYPTION_KEY کوتاه است (${#dek} کاراکتر؛ انتظار ۶۴)" \
         "⚠️ عوض کردن کلید، شماره‌های موجود را ناخوانا می‌کند — اول بکاپ بگیرید"
  else
    ok "DATA_ENCRYPTION_KEY تنظیم شده (${#dek} کاراکتر)"
  fi

  [ "$(env_get NODE_ENV)" = "production" ] \
    && ok "NODE_ENV=production" \
    || bad "NODE_ENV برابر «$(env_get NODE_ENV)» است، نه production — پیام خطاها جزئیات داخلی را لو می‌دهند" "sed -i 's|^NODE_ENV=.*|NODE_ENV=production|' .env && docker compose up -d api"

  rl="$(env_get RATE_LIMIT_MAX)"
  if [ -z "$rl" ] || [ "$rl" -ge 600 ] 2>/dev/null; then
    ok "RATE_LIMIT_MAX=${rl:-پیش‌فرض} — برای کار عادی کافی است"
  else
    warn "RATE_LIMIT_MAX=$rl پایین است و کاربر واقعی را وسط کار قفل می‌کند" \
         "sed -i 's|^RATE_LIMIT_MAX=.*|RATE_LIMIT_MAX=1200|' .env && docker compose up -d api"
  fi

  case "$(env_get CORS_ORIGINS)" in
    *'*'*) bad "CORS_ORIGINS ستاره دارد — هر سایتی می‌تواند با کوکی کاربر به API بزند" "دامنه‌ها را صریح بنویسید" ;;
    "")    warn "CORS_ORIGINS خالی است" "CORS_ORIGINS=https://feranocar.com" ;;
    *)     ok "CORS_ORIGINS محدود است" ;;
  esac

  # The gate before the first real agency. These accounts have their password
  # written in a public repository.
  sd="$(env_get SEED_DEMO)"; ad="$(env_get ALLOW_DEMO_SEED)"
  if [ "$sd" = "true" ] || [ "$ad" = "true" ]; then
    bad "داده‌ی نمونه هنوز روشن است (SEED_DEMO=$sd، ALLOW_DEMO_SEED=$ad) — رمز این حساب‌ها در مخزن عمومی نوشته شده" \
        "sed -i 's|^SEED_DEMO=.*|SEED_DEMO=false|; s|^ALLOW_DEMO_SEED=.*|ALLOW_DEMO_SEED=false|' .env && docker compose up -d api"
  else
    ok "داده‌ی نمونه خاموش است"
  fi

  # `check-ignore` answers "is this ignored", and it exits non-zero for two
  # completely different reasons: the file is not ignored, or there is no
  # repository here at all. A tarball install has no .git, so the first
  # version of this check reported "‎.env is tracked by git" on a server where
  # git had never touched the directory — an alarming finding, entirely false.
  #
  # `ls-files --error-unmatch` asks the question we actually mean: is this file
  # tracked? Outside a repository the answer is simply no.
  if ! have git || [ ! -d "$ROOT/.git" ]; then
    skip "پروژه مخزن گیت نیست — ‎.env نمی‌تواند به مخزن برود"
  elif git -C "$ROOT" ls-files --error-unmatch .env >/dev/null 2>&1; then
    bad ".env توسط گیت ردیابی می‌شود — رمزها به مخزن می‌روند" "git rm --cached .env && echo .env >> .gitignore"
  else
    ok ".env در گیت ردیابی نمی‌شود"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۴ — سرویس‌ها (گام ۵)"
# ═════════════════════════════════════════════════════════════════════════════

for s in db api web adminer; do
  st="$(svc_state "$s")"
  if [ "$st" = "running" ]; then
    ok "سرویس $s بالاست"
  elif [ "$s" = "adminer" ] && [ -z "$st" ]; then
    warn "سرویس adminer وجود ندارد (پنل دیتابیس نصب نشده)" "docs/deployment.md — بخش «مدیریت دیتابیس»"
  else
    bad "سرویس $s بالا نیست (وضعیت: ${st:-وجود ندارد})" "docker compose up -d $s && docker compose logs $s --tail 50"
  fi
done

# A container that is `running` but whose Postgres refuses connections is the
# outage that looks healthiest from outside.
if docker compose exec -T db pg_isready -q 2>/dev/null; then
  ok "دیتابیس به اتصال جواب می‌دهد"
else
  bad "دیتابیس به اتصال جواب نمی‌دهد" "docker compose logs db --tail 50"
fi

# Layer two of staying up: without this, a crashed container stays down.
#
# Counted, not just looped over. A loop with nothing in it finds no violations
# and prints a tick — the same shape of false pass that once made the masking
# audit report "no phone number leaked in 0 listings" as if it had checked.
missing_policy=""; n_containers=0
for cid in $(docker compose ps -q 2>/dev/null); do
  n_containers=$((n_containers+1))
  p="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$cid" 2>/dev/null)"
  [ "$p" = "unless-stopped" ] || [ "$p" = "always" ] || \
    missing_policy="$missing_policy $(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null)"
done
if [ "$n_containers" = "0" ]; then
  skip "کانتینری در حال اجرا نیست — سیاست ری‌استارت بررسی نشد"
elif [ -z "$missing_policy" ]; then
  ok "هر $n_containers کانتینر سیاست ری‌استارت دارند"
else
  bad "بدون سیاست ری‌استارت:$missing_policy" "docker compose up -d --force-recreate"
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۵ — کد روی سرور"
# ═════════════════════════════════════════════════════════════════════════════

if [ -d .git ] && have git; then
  local_sha="$(git rev-parse HEAD 2>/dev/null)"
  remote_sha="$(git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1)"
  cur_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ "$cur_branch" != "$BRANCH" ]; then
    bad "شاخه‌ی سرور «$cur_branch» است، نه $BRANCH" "./deploy/update.sh"
  elif [ -z "$remote_sha" ]; then
    skip "شاخه‌ی راه دور خوانده نشد (شبکه؟) — نسخه‌ی سرور: ${local_sha:0:7}"
  elif [ "$local_sha" = "$remote_sha" ]; then
    ok "کد سرور آخرین نسخه است (${local_sha:0:7})"
  else
    bad "کد سرور عقب است (${local_sha:0:7} در برابر ${remote_sha:0:7})" "./deploy/update.sh"
  fi
else
  skip "نصب از روی tarball — نسخه از گیت قابل تشخیص نیست"
fi

[ -f frontend/index.html ] \
  && ok "frontend/index.html سر جایش است" \
  || bad "frontend/index.html نیست — nginx به ۴۰۳ می‌خورد" "./deploy/update.sh"

# ═════════════════════════════════════════════════════════════════════════════
section "۶ — دامنه، SSL و هدرها (گام ۶ تا ۸)"
# ═════════════════════════════════════════════════════════════════════════════

DOMAIN="$(env_get BRAND_DOMAIN)"; DOMAIN="${DOMAIN:-feranocar.com}"
SSL_ON=0
BASE="http://localhost"

if [ -f deploy/nginx/ssl.conf ]; then
  SSL_ON=1
  ok "پیکربندی SSL نصب است"
  # This one line is the difference between "the certificate exists" and
  # "the site uses it". update.sh used to revert it on every run.
  if grep -qE 'default[[:space:]]+1' deploy/nginx/00-mode.conf 2>/dev/null; then
    ok "ریدایرکت HTTP → HTTPS روشن است"
  else
    bad "گواهی هست ولی ریدایرکت خاموش است — سایت روی HTTP ساده سرو می‌شود" \
        "printf 'map \$host \$force_https {\\n    default 1;\\n}\\n' > deploy/nginx/00-mode.conf && docker compose exec -T web nginx -s reload"
  fi
else
  warn "SSL فعال نیست — رمزها و کوکی‌ها بدون رمزنگاری رد و بدل می‌شوند" "./deploy/enable-ssl.sh"
fi

if [ "$SSL_ON" = "1" ]; then
  BASE="https://$DOMAIN"
  CURL_OPTS=(--resolve "$DOMAIN:443:127.0.0.1" --max-time 15)

  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$DOMAIN/" --resolve "$DOMAIN:80:127.0.0.1" 2>/dev/null)"
  [ "$code" = "301" ] || [ "$code" = "308" ] \
    && ok "HTTP با $code به HTTPS می‌رود" \
    || bad "HTTP پاسخ $code داد، نه ۳۰۱" "docker compose logs web --tail 30"

  # No -k: this validates the chain and the hostname, which is also the only
  # honest way to know the certificate is the right one and not expired.
  code="$(curl -s -o /dev/null -w '%{http_code}' "${CURL_OPTS[@]}" "$BASE/" 2>/dev/null)"
  if [ "$code" = "200" ]; then
    ok "HTTPS پاسخ ۲۰۰ می‌دهد و گواهی معتبر است"
  else
    bad "HTTPS پاسخ ${code:-هیچ} داد" "docker compose logs web --tail 30"
  fi

  enddate="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null \
             | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$enddate" ]; then
    days=$(( ($(date -d "$enddate" +%s 2>/dev/null || echo 0) - $(date +%s)) / 86400 ))
    if   [ "$days" -lt 0 ];  then bad  "گواهی منقضی شده است" "docker compose run --rm --entrypoint certbot certbot renew --force-renewal"
    elif [ "$days" -lt 20 ]; then bad  "گواهی $days روز دیگر منقضی می‌شود — تمدید خودکار باید تا حالا کار کرده باشد" "tail -50 /var/log/feranocar-certbot.log"
    else                          ok   "گواهی $days روز اعتبار دارد"
    fi
  fi

  # Renewal is unattended, so its failure is silent until the site breaks.
  [ -f /etc/cron.d/feranocar-certbot ] \
    && ok "کرون تمدید خودکار گواهی نصب است" \
    || bad "کرون تمدید گواهی نصب نیست — گواهی سه ماه دیگر منقضی می‌شود و کسی خبردار نمی‌شود" "./deploy/enable-ssl.sh"

  hdrs="$(curl -sI "${CURL_OPTS[@]}" "$BASE/" 2>/dev/null)"
else
  CURL_OPTS=(--max-time 15)
  hdrs="$(curl -sI --max-time 10 "$BASE/" 2>/dev/null)"
fi

# If nothing answered, nothing below is testable. Reporting "no CSP header",
# "no HSTS header", "X-Powered-By absent ✓" against an empty response is worse
# than useless: it buries the one real finding (the site is down) under a dozen
# invented ones, and one of them is a *pass* the server never earned.
if [ -z "$hdrs" ]; then
  bad "وب‌سرور به درخواست جواب نداد — بررسی هدرها انجام نشد" "docker compose logs web --tail 30"
  WEB_UP=0
else
  WEB_UP=1
  check_header() {
    echo "$hdrs" | grep -qi "^$1:" \
      && ok "هدر $1" \
      || bad "هدر $1 فرستاده نمی‌شود" "deploy/nginx/app.conf — بعد از اصلاح: docker compose exec -T web nginx -s reload"
  }
  check_header "X-Content-Type-Options"
  check_header "X-Frame-Options"
  check_header "Content-Security-Policy"
  check_header "Referrer-Policy"
  [ "$SSL_ON" = "1" ] && check_header "Strict-Transport-Security"

  echo "$hdrs" | grep -qi '^X-Powered-By:' \
    && bad "هدر X-Powered-By فرستاده می‌شود — فریم‌ورک را لو می‌دهد" "app.disable('x-powered-by')" \
    || ok "X-Powered-By فرستاده نمی‌شود"

  echo "$hdrs" | grep -qiE '^Server: *nginx/[0-9]' \
    && warn "نسخه‌ی دقیق nginx در هدر Server است" "server_tokens off; در app.conf" \
    || ok "نسخه‌ی وب‌سرور پنهان است"
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۷ — رفتار واقعی برنامه"
# ═════════════════════════════════════════════════════════════════════════════
#
# These test the code that is *running*, not the file on disk. A server whose
# update never took shows up here even when every file looks right.

api() { curl -s -o /dev/null -w '%{http_code}' "${CURL_OPTS[@]}" "$@" 2>/dev/null; }

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost/api/v1/health 2>/dev/null)"
if [ "$code" = "200" ]; then
  ok "API سالم است"
else
  bad "API پاسخ ${code:-هیچ} داد" "docker compose logs api --tail 50"
  WEB_UP=0
fi

# Same rule as above: an unreachable API cannot be asked how it handles a
# malformed body. Skipping says "not checked"; failing would say "broken", and
# only one of those is true.
if [ "${WEB_UP:-0}" != "1" ]; then
  skip "برنامه بالا نیست — بررسی رفتار انجام نشد"
else

code="$(api -X POST -H 'Content-Type: application/json' -d '{bad' "$BASE/api/v1/auth/login")"
[ "$code" = "400" ] \
  && ok "درخواست خراب → ۴۰۰ (نه ۵۰۰)" \
  || bad "درخواست خراب پاسخ $code داد، انتظار ۴۰۰ — یعنی آخرین کد روی سرور نیست" "./deploy/update.sh"

# Through a file, not a shell variable: two megabytes on a command line is
# close enough to ARG_MAX that this check would fail for the wrong reason.
BIGFILE="$(mktemp)"
{ printf '{"a":"'; head -c 2000000 /dev/zero | tr '\0' 'a'; printf '"}'; } > "$BIGFILE"
code="$(curl -s -o /dev/null -w '%{http_code}' "${CURL_OPTS[@]}" -X POST \
        -H 'Content-Type: application/json' --data-binary "@$BIGFILE" \
        "$BASE/api/v1/auth/login" 2>/dev/null)"
rm -f "$BIGFILE"
[ "$code" = "413" ] \
  && ok "درخواست حجیم → ۴۱۳" \
  || bad "درخواست حجیم پاسخ $code داد، انتظار ۴۱۳" "./deploy/update.sh"

# `havales`, plural — the singular is not a route at all and answers 404, so
# the first version of this check called a perfectly healthy server broken.
for p in havales admin/users settings; do
  code="$(api "$BASE/api/v1/$p")"
  [ "$code" = "401" ] \
    && ok "مسیر محافظت‌شده /$p بدون ورود → ۴۰۱" \
    || bad "مسیر /$p بدون ورود پاسخ $code داد، انتظار ۴۰۱" "بررسی میان‌افزار احراز هویت"
done

code="$(api "$BASE/api/v1/does-not-exist")"
[ "$code" = "404" ] \
  && ok "مسیر ناموجود → ۴۰۴" \
  || bad "مسیر ناموجود پاسخ $code داد" "docker compose logs api --tail 30"

methods_ok=1
for m in TRACE TRACK; do
  code="$(api -X "$m" "$BASE/")"
  if [ "$code" = "200" ]; then
    methods_ok=0
    bad "متد $m فعال است" "در app.conf متدهای غیرمجاز را ببندید"
  fi
done
[ "$methods_ok" = "1" ] && ok "متدهای TRACE/TRACK فعال نیستند"
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۸ — داده‌ها"
# ═════════════════════════════════════════════════════════════════════════════

# env_get exits 0 even when the key is absent, so `||` would never fire —
# the defaults have to be applied to the value, not to the exit status.
DBUSER="$(env_get POSTGRES_USER)"; DBUSER="${DBUSER:-havale}"
DBNAME="$(env_get POSTGRES_DB)";   DBNAME="${DBNAME:-havale}"
PSQL=(docker compose exec -T db psql -U "$DBUSER" -d "$DBNAME" -tAc)

if docker compose exec -T db true 2>/dev/null; then
  # Are the phone numbers actually encrypted, or is the key set but the
  # backfill never ran? `v1.` is the stored-form prefix.
  total="$("${PSQL[@]}" 'SELECT count(*) FROM "User";' 2>/dev/null | tr -d '[:space:]')"
  encd="$("${PSQL[@]}" $'SELECT count(*) FROM "User" WHERE phone LIKE \'v1.%\';' 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$total" ] && [ "$total" -gt 0 ] 2>/dev/null; then
    if [ "${encd:-0}" = "$total" ]; then
      ok "همه‌ی $total شماره‌ی تماس در دیتابیس رمز شده‌اند"
    elif [ "${encd:-0}" = "0" ] && [ -z "$(env_get DATA_ENCRYPTION_KEY)" ]; then
      # Without a key nothing *can* be encrypted, so this is not a second
      # problem — it is the consequence of the one already reported in §۳.
      # Counting it twice makes the list of things to fix look longer than it
      # is, and splits one action into two.
      skip "شماره‌ها رمز نشده‌اند چون کلید تنظیم نشده — همان مورد بخش ۳ ($total شماره)"
    elif [ "${encd:-0}" = "0" ]; then
      bad "کلید هست ولی هیچ‌کدام از $total شماره رمز نشده‌اند" \
          "docker compose exec -T api node scripts/encrypt-existing.js  (اول بکاپ)"
    else
      warn "$encd از $total شماره رمز شده — رمزنگاری نیمه‌کاره مانده" \
           "docker compose exec -T api node scripts/encrypt-existing.js"
    fi
  else
    skip "کاربری در دیتابیس نیست"
  fi

  # The demo accounts, whose password is in a public repository.
  live_demo="$("${PSQL[@]}" $'SELECT count(*) FROM "User" WHERE "agencyCode" IN (\'alborz\',\'pars\',\'zagros\',\'khalij\') AND status = \'ACTIVE\';' 2>/dev/null | tr -d '[:space:]')"
  if [ "${live_demo:-0}" -gt 0 ] 2>/dev/null; then
    bad "$live_demo حساب نمایشی هنوز فعال است — رمزشان در مخزن عمومی نوشته شده" \
        "از پنل مدیریت، حساب‌های alborz/pars/zagros/khalij را تعلیق کنید"
  else
    ok "حساب‌های نمایشی فعال نیستند"
  fi
else
  skip "دیتابیس در دسترس نبود — بررسی داده‌ها انجام نشد"
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۹ — بکاپ (گام ۹)"
# ═════════════════════════════════════════════════════════════════════════════

BR="${BACKUP_ROOT:-/var/backups/feranocar}"

[ -x /usr/local/bin/feranocar-backup ] \
  && ok "دستور feranocar-backup نصب است" \
  || warn "میان‌بر /usr/local/bin/feranocar-backup نصب نیست" "ln -s $ROOT/deploy/backup.sh /usr/local/bin/feranocar-backup"

if [ -f /etc/cron.d/feranocar-backup ]; then
  # Which tiers are *actually* scheduled, read out of the file rather than
  # assumed. The first version grepped for the literal string "backup.sh
  # <tier>", which misses a cron line that calls the /usr/local/bin shortcut
  # instead — so a working schedule was reported as three missing tiers.
  cron_body="$(grep -vE '^[[:space:]]*#' /etc/cron.d/feranocar-backup 2>/dev/null)"
  scheduled=""
  for tier in hourly daily weekly; do
    echo "$cron_body" | grep -qE "(backup\.sh|feranocar-backup)[[:space:]]+$tier([[:space:]]|$|>)" \
      && scheduled="$scheduled $tier"
  done
  scheduled="${scheduled# }"

  if [ "$scheduled" = "hourly daily weekly" ]; then
    ok "کرون بکاپ نصب است و هر سه لایه زمان‌بندی شده‌اند"
  elif [ -n "$scheduled" ]; then
    warn "کرون بکاپ فقط این لایه‌ها را دارد: $scheduled" "docs/deployment.md گام ۹ (خط ۴۴۹) — هر سه خط"
  else
    # A cron file that runs something else entirely. Show what, rather than
    # asserting three separate missing tiers and leaving the reader to guess.
    warn "کرون بکاپ نصب است ولی هیچ‌کدام از لایه‌های hourly/daily/weekly را اجرا نمی‌کند" \
         "خط فعلی: $(echo "$cron_body" | grep -v '^[[:space:]]*$' | head -1)"
  fi
else
  bad "کرون بکاپ نصب نیست — هیچ بکاپ خودکاری گرفته نمی‌شود" "docs/deployment.md گام ۹ (خط ۴۴۹)"
fi

# A cron entry that exists but never produced a file is the failure mode that
# looks exactly like success until the day you need to restore.
newest="$(ls -1t "$BR"/*/*.tar.gz "$BR"/*/*.sql.gz "$BR"/*.tar.gz "$BR"/*.sql.gz 2>/dev/null | head -1)"
if [ -n "$newest" ]; then
  age_h=$(( ($(date +%s) - $(date -r "$newest" +%s)) / 3600 ))
  size="$(du -h "$newest" 2>/dev/null | cut -f1)"
  if [ "$age_h" -le 30 ]; then
    ok "آخرین بکاپ $age_h ساعت پیش گرفته شده ($size)"
  else
    bad "آخرین بکاپ $age_h ساعت پیش است — کرون هست ولی کار نمی‌کند" "tail -30 /var/log/feranocar-backup.log"
  fi

  # Reporting "hourly is empty / daily is empty / weekly is empty" right after
  # "a backup was taken an hour ago" is three warnings that contradict the line
  # above them, and it tells the reader nothing about where the file actually
  # went. So: say where the backups are, then say what is missing.
  tiers_found=""; tiers_missing=""
  for tier in hourly daily weekly; do
    n="$(ls -1 "$BR/$tier"/* 2>/dev/null | wc -l)"
    if [ "$n" -gt 0 ]; then tiers_found="$tiers_found $tier($n)"; else tiers_missing="$tiers_missing $tier"; fi
  done
  flat="$(ls -1 "$BR"/*.tar.gz "$BR"/*.sql.gz 2>/dev/null | wc -l)"

  if [ -z "$tiers_missing" ]; then
    ok "هر سه لایه پر است:$tiers_found"
  elif [ -n "$tiers_found" ]; then
    warn "لایه‌های پر:$tiers_found — هنوز خالی:$tiers_missing" "اگر تازه نصب شده، طبیعی است؛ فردا دوباره ببینید"
  elif [ "$flat" -gt 0 ]; then
    # This is the real shape of the problem when it happens: an older
    # single-file backup is running fine, and the tiered one was never wired
    # up. "Three empty tiers" describes it badly; this describes it.
    warn "بکاپ‌ها تک‌لایه در $BR ذخیره می‌شوند ($flat فایل)، نه سه‌لایه" \
         "کرون سه‌لایه‌ی گام ۹ را نصب کنید تا نسخه‌ی ساعتی/روزانه/هفتگی جدا نگه داشته شود"
  else
    warn "هیچ لایه‌ای پر نیست" "$ROOT/deploy/backup.sh daily"
  fi
else
  bad "هیچ فایل بکاپی در $BR نیست" "$ROOT/deploy/backup.sh daily"
fi

# Backups that only exist on the server they back up are not backups.
rc="$(env_get BACKUP_RCLONE_REMOTE)"; sc="$(env_get BACKUP_SCP_TARGET)"
if [ -n "$rc" ]; then
  have rclone && ok "انتقال به بیرون از سرور با rclone تنظیم شده" \
              || bad "BACKUP_RCLONE_REMOTE تنظیم شده ولی rclone نصب نیست" "curl https://rclone.org/install.sh | bash"
elif [ -n "$sc" ]; then
  ok "انتقال به بیرون از سرور با scp تنظیم شده"
else
  bad "بکاپ فقط روی همین سرور می‌ماند — اگر سرور از دست برود، بکاپ هم می‌رود" \
      "یکی از این دو را در .env بگذارید: BACKUP_RCLONE_REMOTE=... یا BACKUP_SCP_TARGET=..."
fi

[ -x deploy/verify-backup.sh ] \
  && ok "اسکریپت تست بازگردانی موجود است (ماهی یک بار: ./deploy/verify-backup.sh)" \
  || warn "deploy/verify-backup.sh اجرایی نیست" "chmod +x deploy/verify-backup.sh"

# ═════════════════════════════════════════════════════════════════════════════
section "۱۰ — دیده‌بان و هشدار تلگرام"
# ═════════════════════════════════════════════════════════════════════════════

[ -x deploy/watchdog.sh ] && ok "اسکریپت دیده‌بان موجود است" || bad "deploy/watchdog.sh نیست یا اجرایی نیست" "chmod +x deploy/watchdog.sh"

if [ -f /etc/cron.d/feranocar-watchdog ]; then
  ok "کرون دیده‌بان نصب است"
  # Installed ≠ running. The log's mtime is the only proof cron actually fires.
  wlog=/var/log/feranocar-watchdog.log
  if [ -f "$wlog" ]; then
    age_m=$(( ($(date +%s) - $(date -r "$wlog" +%s)) / 60 ))
    [ "$age_m" -le 15 ] \
      && ok "دیده‌بان $age_m دقیقه پیش اجرا شده" \
      || bad "دیده‌بان $age_m دقیقه است اجرا نشده — کرون نصب است ولی کار نمی‌کند" "systemctl status cron && cat /etc/cron.d/feranocar-watchdog"
  else
    warn "لاگ دیده‌بان هنوز ساخته نشده" "تا ۵ دقیقه صبر کنید، بعد: cat $wlog"
  fi
else
  bad "کرون دیده‌بان نصب نیست — خرابی‌ها را کاربر قبل از شما می‌فهمد" \
      "printf '*/5 * * * * root $ROOT/deploy/watchdog.sh >> /var/log/feranocar-watchdog.log 2>&1\\n' > /etc/cron.d/feranocar-watchdog && chmod 644 /etc/cron.d/feranocar-watchdog"
fi

tg_token="$(env_get TELEGRAM_BOT_TOKEN)"; tg_chat="$(env_get TELEGRAM_CHAT_ID)"
if [ -z "$tg_token" ] || [ -z "$tg_chat" ]; then
  warn "هشدار تلگرام تنظیم نشده — خرابی‌ها فقط در لاگ می‌مانند" "docs/deployment.md خط ۵۴۷"
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

# ═════════════════════════════════════════════════════════════════════════════
section "۱۱ — پنل دیتابیس (Adminer)"
# ═════════════════════════════════════════════════════════════════════════════

if [ ! -f deploy/nginx/adminer.conf ]; then
  skip "پنل دیتابیس نصب نشده"
else
  if [ -f deploy/nginx/.htpasswd ]; then
    m="$(stat -c '%a' deploy/nginx/.htpasswd)"
    # 600 makes nginx's worker (user `nginx`, not root) unable to read it: the
    # prompt appears, and the *correct* password then returns 500.
    [ "$m" = "644" ] \
      && ok "رمز پنل ساخته شده و دسترسی‌اش درست است" \
      || bad "دسترسی .htpasswd روی $m است — رمز درست هم خطای ۵۰۰ می‌دهد" "chmod 644 deploy/nginx/.htpasswd"
  else
    bad "رمز پنل دیتابیس ساخته نشده — nginx بالا نمی‌آید" "docs/deployment.md — بخش «مدیریت دیتابیس»، مرحله ۱"
  fi

  if [ "$SSL_ON" = "1" ]; then
    grep -q 'listen 8443 ssl' deploy/nginx/adminer.conf \
      && ok "پنل دیتابیس روی HTTPS است" \
      || bad "پنل دیتابیس روی HTTP ساده است — رمز دیتابیس بدون رمزنگاری رد می‌شود" "./deploy/enable-ssl.sh"
  fi

  # 401 is the pass. 200 would mean the panel is open to the internet.
  if [ "${WEB_UP:-0}" != "1" ]; then
    skip "وب‌سرور بالا نیست — پاسخ پنل دیتابیس بررسی نشد"
  else
    code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "https://127.0.0.1:8443/" 2>/dev/null)"
    [ "$code" = "000" ] && code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:8443/" 2>/dev/null)"
    case "$code" in
      401) ok "پنل دیتابیس رمز می‌خواهد (۴۰۱)" ;;
      200) bad "پنل دیتابیس بدون رمز باز است" "docs/deployment.md — .htpasswd را بسازید" ;;
      *)   warn "پنل دیتابیس پاسخ ${code} داد" "docker compose logs web --tail 30" ;;
    esac
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
section "۱۲ — منابع سرور"
# ═════════════════════════════════════════════════════════════════════════════

usage="$(df -P "$ROOT" | awk 'NR==2{print $5}' | tr -d '%')"
if   [ "${usage:-0}" -ge 90 ]; then bad  "دیسک ${usage}% پر است — Postgres با پر شدن دیسک می‌ایستد" "docker image prune -f && ls -lt $BR/*/"
elif [ "${usage:-0}" -ge 85 ]; then warn "دیسک ${usage}% پر است" "docker system df"
else                                ok   "دیسک ${usage}% پر است"
fi

mem_free="$(free | awk '/^Mem:/{printf "%d", $7*100/$2}')"
if   [ "${mem_free:-100}" -le 8 ];  then bad  "فقط ${mem_free}% حافظه آزاد است — کرنل معمولاً Postgres را می‌کشد" "docker stats --no-stream"
elif [ "${mem_free:-100}" -le 15 ]; then warn "${mem_free}% حافظه آزاد است" "docker stats --no-stream"
else                                     ok   "${mem_free}% حافظه آزاد است"
fi

# ═════════════════════════════════════════════════════════════════════════════
if [ "$FULL" = "1" ] && [ "$SSL_ON" = "1" ]; then
section "۱۳ — تمرین تمدید گواهی (‎--full)"
  if docker compose run --rm --entrypoint certbot certbot renew --dry-run 2>&1 | grep -q 'simulated renewals succeeded'; then
    ok "تمدید خودکار گواهی واقعاً کار می‌کند"
  else
    bad "تمرین تمدید گواهی شکست خورد — گواهی سررسید که شد تمدید نمی‌شود" \
        "docker compose run --rm --entrypoint certbot certbot renew --dry-run   (خروجی کامل را ببینید)"
  fi
fi

# ── summary ──────────────────────────────────────────────────────────────────
printf '\n%s─────────────────────────────────────────────────────────%s\n' "$B" "$N"
printf '  %s✓ %d درست%s   %s! %d هشدار%s   %s✗ %d ایراد%s   %s– %d بررسی‌نشده%s\n' \
  "$G" "$pass" "$N" "$Y" "$warn" "$N" "$R" "$fail" "$N" "$D" "$skipped" "$N"

if [ "$fail" -gt 0 ]; then
  printf '\n%s  کارهایی که مانده:%s\n' "$R$B" "$N"
  for i in "${FAILED_ITEMS[@]}"; do printf '    • %s\n' "$i"; done
  printf '\n%s  هر مورد بالا دستور رفعش را کنارش دارد.%s\n' "$D" "$N"
  exit 1
fi

if [ "$warn" -gt 0 ]; then
  printf '\n%s  ایراد جدی نیست. هشدارها را وقت کردید ببینید.%s\n' "$Y" "$N"
else
  printf '\n%s  همه‌چیز طبق سند انجام شده.%s\n' "$G" "$N"
fi
[ "$FULL" = "1" ] || printf '%s  برای تست تمدید گواهی هم: %s --full%s\n' "$D" "$0" "$N"
exit 0
