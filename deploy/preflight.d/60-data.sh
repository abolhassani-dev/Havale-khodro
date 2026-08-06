# shellcheck shell=bash disable=SC2154
# داده‌ها — چیزی که واقعاً در دیتابیس هست
#
# Entirely project-specific. A new project replaces this file.

section "۶۰ — داده‌ها"

if ! docker compose exec -T "$DB_SERVICE" true 2>/dev/null; then
  skip "دیتابیس در دسترس نبود — بررسی داده‌ها انجام نشد"
  return 0 2>/dev/null || true
fi

# ── contact encryption ───────────────────────────────────────────────────────
#
# `v1.` is the stored-form prefix (backend/src/utils/crypto.js).
total="$(db_query 'SELECT count(*) FROM "User";')"
encd="$(db_query $'SELECT count(*) FROM "User" WHERE phone LIKE \'v1.%\';')"

if [ -z "$total" ] || [ "${total:-0}" -eq 0 ] 2>/dev/null; then
  skip "کاربری در دیتابیس نیست"
elif [ "${encd:-0}" = "$total" ]; then
  ok "همه‌ی $total شماره‌ی تماس در دیتابیس رمز شده‌اند"
elif [ "${encd:-0}" = "0" ] && [ -z "$(env_get DATA_ENCRYPTION_KEY)" ]; then
  # Without a key nothing *can* be encrypted, so this is not a second problem —
  # it is the consequence of the one already reported in §۳۰. Counting it twice
  # makes the list of things to fix look longer than it is.
  skip "شماره‌ها رمز نشده‌اند چون کلید تنظیم نشده — همان مورد بخش ۳۰ ($total شماره)"
elif [ "${encd:-0}" = "0" ]; then
  bad "کلید هست ولی هیچ‌کدام از $total شماره رمز نشده‌اند" \
      "docker compose exec -T $API_SERVICE node scripts/encrypt-existing.js  (اول بکاپ)"
else
  warn "$encd از $total شماره رمز شده — رمزنگاری نیمه‌کاره مانده" \
       "docker compose exec -T $API_SERVICE node scripts/encrypt-existing.js"
fi

# ── demo accounts ────────────────────────────────────────────────────────────
#
# Matched on username. The first version matched agencyCode against
# 'alborz','pars',… — but those are the usernames; the agency codes are
# G-1001…G-1004. So it matched nothing, every time, and printed a green tick on
# a server where all four accounts were live. A check that cannot fail is worse
# than no check, because it is believed.
: "${DEMO_USERNAMES:=alborz pars zagros khalij}"
demo_list="$(printf "'%s'," $DEMO_USERNAMES | sed 's/,$//')"

demo_total="$(db_query "SELECT count(*) FROM \"User\" WHERE username IN ($demo_list);")"
live_demo="$(db_query "SELECT count(*) FROM \"User\" WHERE username IN ($demo_list) AND status = 'ACTIVE';")"

if [ "${demo_total:-0}" = "0" ]; then
  ok "حساب نمایشی روی این سرور ساخته نشده"
elif [ "${live_demo:-0}" -gt 0 ] 2>/dev/null; then
  # Whether this is a problem depends on whether the password is still the one
  # in the repository, which no query can tell us. So it says what is true and
  # names the condition, instead of asserting a breach.
  warn "$live_demo حساب نمایشی از $demo_total فعال است — اگر رمزشان هنوز Demo@12345 است، سامانه برای همه باز است" \
       "رمز را عوض کرده‌اید؟ ایرادی ندارد. وگرنه تعلیقشان کنید — قبل از ورود اولین نمایندگی واقعی، هر چهار حساب باید بروند"
else
  ok "هر $demo_total حساب نمایشی تعلیق شده"
fi

# ── an administrator must exist ──────────────────────────────────────────────
#
# Without one, nobody can approve an agency, answer a ticket, or suspend an
# account — and it is discovered on the day it is needed.
admins="$(db_query "SELECT count(*) FROM \"User\" WHERE role <> 'AGENT' AND status = 'ACTIVE';")"
[ "${admins:-0}" -gt 0 ] 2>/dev/null \
  && ok "$admins حساب مدیریتی فعال وجود دارد" \
  || bad "هیچ حساب مدیریتی فعالی وجود ندارد — کسی نمی‌تواند نمایندگی بسازد یا تیکت جواب دهد" \
         "docker compose exec -T $API_SERVICE npm run seed"

# ── the catalogue ────────────────────────────────────────────────────────────
#
# An empty catalogue means nobody can post a listing at all: the model is
# chosen from it, not typed.
models="$(db_query 'SELECT count(*) FROM "CarModel" WHERE "isActive" = true;')"
[ "${models:-0}" -gt 0 ] 2>/dev/null \
  && ok "$models مدل خودروی فعال در کاتالوگ" \
  || bad "کاتالوگ خودرو خالی است — هیچ حواله‌ای قابل ثبت نیست" \
         "docker compose exec -T $API_SERVICE npm run seed"
