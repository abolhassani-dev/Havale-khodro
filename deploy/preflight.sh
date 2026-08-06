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
#   deploy/preflight.sh                  # everything except the slow checks
#   deploy/preflight.sh --full           # also the slow ones (cert renewal…)
#   deploy/preflight.sh --list           # what sections exist
#   deploy/preflight.sh --only tls,backup
#   deploy/preflight.sh --quiet          # only what needs attention
#
# It changes nothing. No restart, no file written, no alert sent — safe to run
# on a live system at any time, as often as you like.
#
# It never prints a secret. Where a value is a password or a key it checks that
# one is present and long enough, and prints only that much.
#
# Exit code: 0 when nothing failed, 1 when something did.
#
# ── Structure ────────────────────────────────────────────────────────────────
#
# This file is the runner: configuration, the helpers a check is written with,
# and the summary. The checks themselves live in preflight.d/, one file per
# section, loaded in filename order. Adding a check means adding a function to
# one of those files — or dropping in a new file — and never editing this one.
#
# That split is what makes it portable. The sections numbered 10–29 and 80–99
# ask about a Docker host and know nothing about this product; the ones in
# between are ours. A new project keeps the first set, replaces the second, and
# changes the configuration block below.
#
# See preflight.d/README.md.
#
set -uo pipefail   # not -e: a failing check is the output, not a crash

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

# ═════════════════════════════════════════════════════════════════════════════
# Configuration
#
# Everything a different project would need to change, in one place. Override
# any of it in deploy/preflight.conf (not committed) or from the environment.
# ═════════════════════════════════════════════════════════════════════════════

: "${PROJECT_NAME:=فرانوکار}"
: "${PROJECT_SLUG:=feranocar}"          # cron file names, backup dir, state dir
: "${BRANCH:=claude/delegation-platform-phase-one-0xfqz7}"

# Compose services that must be running. Space separated; a name in
# OPTIONAL_SERVICES is reported as a warning rather than a failure when absent.
: "${SERVICES:=db api web adminer}"
: "${OPTIONAL_SERVICES:=adminer}"
: "${DB_SERVICE:=db}"
: "${API_SERVICE:=api}"
: "${WEB_SERVICE:=web}"

: "${API_PREFIX:=/api/v1}"
: "${HEALTH_PATH:=${API_PREFIX}/health}"

# Firewall expectations.
: "${EXPECTED_PORTS:=22 80 443}"
: "${DB_PANEL_PORT:=8443}"
# Ports that must never be reachable from outside: the database itself, and the
# application without the reverse proxy in front of it.
: "${FORBIDDEN_PORTS:=5432 3000}"

: "${BACKUP_ROOT:=/var/backups/${PROJECT_SLUG}}"
: "${BACKUP_TIERS:=hourly daily weekly}"
: "${WATCHDOG_LOG:=/var/log/${PROJECT_SLUG}-watchdog.log}"
: "${BACKUP_LOG:=/var/log/${PROJECT_SLUG}-backup.log}"
: "${RESTORE_STAMP:=/var/lib/${PROJECT_SLUG}/last-restore-test}"

# Keys that must be present and long enough in .env: "NAME:minimum-length".
: "${REQUIRED_SECRETS:=POSTGRES_PASSWORD:16 SESSION_SECRET:32}"

: "${TIMEZONE:=Asia/Tehran}"
: "${DISK_WARN:=85}"
: "${DISK_FAIL:=90}"
: "${CERT_MIN_DAYS:=20}"
: "${BACKUP_MAX_AGE_H:=30}"
: "${RESTORE_TEST_MAX_DAYS:=45}"

[ -f "$ROOT/deploy/preflight.conf" ] && . "$ROOT/deploy/preflight.conf"

# ═════════════════════════════════════════════════════════════════════════════
# Command line
# ═════════════════════════════════════════════════════════════════════════════

FULL=0
QUIET=0
ONLY=""
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --full)  FULL=1 ;;
    --quiet) QUIET=1 ;;
    --list)  LIST=1 ;;
    --only)  ONLY="$2"; shift ;;
    --only=*) ONLY="${1#--only=}" ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $1  (try --help)" >&2; exit 2 ;;
  esac
  shift
done

export FULL QUIET

# ═════════════════════════════════════════════════════════════════════════════
# Reporting
# ═════════════════════════════════════════════════════════════════════════════

pass=0; warn=0; fail=0; skipped=0
FAILED_ITEMS=()
WARNED_ITEMS=()
CURRENT_SECTION=""
SECTION_PRINTED=0

if [ -t 1 ]; then
  G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=''; Y=''; R=''; D=''; B=''; N=''
fi

# In --quiet the heading is held back until something in the section has
# something to say, so a clean run prints almost nothing and a cron job that
# mails its output only mails when it matters.
section() {
  CURRENT_SECTION="$1"
  SECTION_PRINTED=0
  [ "$QUIET" = "1" ] && return 0
  printf '\n%s▸ %s%s\n' "$B" "$1" "$N"
  SECTION_PRINTED=1
}

_head() {
  [ "$SECTION_PRINTED" = "1" ] && return 0
  printf '\n%s▸ %s%s\n' "$B" "$CURRENT_SECTION" "$N"
  SECTION_PRINTED=1
}

ok() {
  pass=$((pass + 1))
  [ "$QUIET" = "1" ] && return 0
  _head
  printf '  %s✓%s %s\n' "$G" "$N" "$1"
  return 0
}

skip() {
  skipped=$((skipped + 1))
  [ "$QUIET" = "1" ] && return 0
  _head
  printf '  %s–%s %s%s%s\n' "$D" "$N" "$D" "$1" "$N"
  return 0
}

# A finding is only useful with the command that clears it, so the second
# argument is not optional in practice — every warn and every fail carries one.
warn() {
  warn=$((warn + 1)); WARNED_ITEMS+=("$1")
  _head
  printf '  %s!%s %s\n' "$Y" "$N" "$1"
  [ -n "${2:-}" ] && printf '      %s↳ %s%s\n' "$D" "$2" "$N"
  return 0
}

bad() {
  fail=$((fail + 1)); FAILED_ITEMS+=("$1")
  _head
  printf '  %s✗%s %s\n' "$R" "$N" "$1"
  [ -n "${2:-}" ] && printf '      %s↳ %s%s\n' "$D" "$2" "$N"
  return 0
}

# `note` is for context a reader needs to interpret the lines around it, and is
# counted as nothing. Use sparingly: an unscored line is a line that cannot
# fail, and a report made mostly of those stops being a report.
note() {
  [ "$QUIET" = "1" ] && return 0
  _head
  printf '    %s%s%s\n' "$D" "$1" "$N"
  return 0
}

# ═════════════════════════════════════════════════════════════════════════════
# Helpers the checks are written with
# ═════════════════════════════════════════════════════════════════════════════

have() { command -v "$1" >/dev/null 2>&1; }

# Reads one key out of .env. Callers must not echo the result for secrets —
# use `secret_ok` for those, which reports a length and never a value.
env_get() {
  [ -f "$ROOT/.env" ] || return 0
  grep -E "^$1=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'
}

# True when a secret is present and at least $2 characters. The length is the
# only thing about it that ever reaches the screen.
secret_ok() {
  local v; v="$(env_get "$1")"
  [ -n "$v" ] && [ "${#v}" -ge "${2:-16}" ]
}

svc_state() {
  docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null \
    | awk -v s="$1" '$1==s{print $2}'
}

compose_ids() { docker compose ps -q 2>/dev/null; }

# psql inside the database container. Prints nothing and returns non-zero when
# the container is not there, so callers can decide whether that is a finding.
db_query() {
  local user db
  user="$(env_get POSTGRES_USER)"; user="${user:-havale}"
  db="$(env_get POSTGRES_DB)";     db="${db:-havale}"
  docker compose exec -T "$DB_SERVICE" psql -U "$user" -d "$db" -tAc "$1" 2>/dev/null \
    | tr -d '[:space:]'
}

# Age of a file in whole hours, or empty when it does not exist.
age_hours() {
  [ -f "$1" ] || return 0
  echo $(( ($(date +%s) - $(date -r "$1" +%s)) / 3600 ))
}

age_days() {
  [ -e "$1" ] || return 0
  echo $(( ($(date +%s) - $(date -r "$1" +%s)) / 86400 ))
}

# The base URL to probe, and the curl options that reach it. Set once by the
# TLS section and used by everything after it, so a check never has to work out
# for itself whether the site is on HTTP or HTTPS.
BASE="http://localhost"
CURL_OPTS=(--max-time 15)
SSL_ON=0
WEB_UP=1

http_code() { curl -s -o /dev/null -w '%{http_code}' "${CURL_OPTS[@]}" "$@" 2>/dev/null; }

# ═════════════════════════════════════════════════════════════════════════════
# Run
# ═════════════════════════════════════════════════════════════════════════════

MODULES=("$ROOT"/deploy/preflight.d/[0-9][0-9]-*.sh)

if [ "$LIST" = "1" ]; then
  printf '%sSections%s\n' "$B" "$N"
  for m in "${MODULES[@]}"; do
    [ -f "$m" ] || continue
    name="$(basename "$m" .sh)"
    title="$(sed -n '2s/^# \{0,1\}//p' "$m")"
    printf '  %-22s %s\n' "${name#*-}" "$title"
  done
  printf '\n%sRun one with:%s deploy/preflight.sh --only <name>[,<name>…]\n' "$D" "$N"
  exit 0
fi

wanted() {
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; esac
  return 1
}

# No box. Padding a right-hand border with printf counts bytes, not display
# columns, and every Persian character is several bytes — so the border landed
# in a different place on every line and the header looked broken.
#
# In --quiet the header is skipped entirely: that mode exists so a cron entry
# can run this and only mail when something is wrong, and a header is output.
if [ "$QUIET" != "1" ]; then
  printf '\n%s▌ %s — بررسی وضعیت سرور%s\n' "$B" "$PROJECT_NAME" "$N"
  printf '%s  %s · %s%s\n' "$D" "$ROOT" "$(date '+%Y-%m-%d %H:%M')" "$N"
  printf '%s─────────────────────────────────────────────────────────%s\n' "$D" "$N"

  if [ "$(id -u)" != "0" ]; then
    printf '\n%s! بدون root اجرا شده — بعضی بررسی‌ها (‎.env، ufw، کرون) ناقص می‌مانند.%s\n' "$Y" "$N"
    printf '%s  دوباره با: sudo %s/deploy/preflight.sh%s\n' "$D" "$ROOT" "$N"
  fi
fi

ran=0
for module in "${MODULES[@]}"; do
  [ -f "$module" ] || continue
  name="$(basename "$module" .sh)"; name="${name#*-}"
  wanted "$name" || continue
  ran=$((ran + 1))
  # shellcheck disable=SC1090
  . "$module"
done

if [ "$ran" = "0" ]; then
  echo "✗ هیچ بخشی با «$ONLY» مطابقت نداشت. فهرست: deploy/preflight.sh --list" >&2
  exit 2
fi

# ═════════════════════════════════════════════════════════════════════════════
# Summary
# ═════════════════════════════════════════════════════════════════════════════

# Silence is the whole point of --quiet: nothing wrong, nothing printed, so a
# cron entry that mails its output stays quiet until there is news.
if [ "$QUIET" = "1" ] && [ "$fail" = "0" ] && [ "$warn" = "0" ]; then
  exit 0
fi

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
[ "$FULL" = "1" ] || printf '%s  بررسی‌های کند (تمرین تمدید گواهی و…): %s --full%s\n' "$D" "$0" "$N"
exit 0
