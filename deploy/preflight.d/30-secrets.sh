# shellcheck shell=bash disable=SC2154
# تنظیمات و رمزها — ‎.env
#
# Half portable: the file checks are generic, the key names are this project's.
# A new project changes REQUIRED_SECRETS and the block at the bottom.

section "۳۰ — تنظیمات و رمزها"

if [ ! -f "$ROOT/.env" ]; then
  bad "فایل .env وجود ندارد — سیستم بدون آن بالا نمی‌آید" "cp .env.example .env  (و بعد گام ۴)"
  return 0 2>/dev/null || true
fi

mode="$(stat -c '%a' "$ROOT/.env" 2>/dev/null)"
[ "$mode" = "600" ] \
  && ok "دسترسی .env روی ۶۰۰ است (فقط root)" \
  || bad "دسترسی .env روی $mode است، نه ۶۰۰ — رمزها برای بقیه‌ی کاربران خواندنی‌اند" "chmod 600 .env"

# A key written twice is a key whose value depends on which line the parser
# reads last — and every parser answers that differently. It looks correct in
# the file and behaves as the other value.
dupes="$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env" 2>/dev/null | sort | uniq -d | tr -d '=' | tr '\n' ' ')"
[ -z "$dupes" ] \
  && ok "هیچ کلیدی در .env تکراری نیست" \
  || bad "کلید تکراری در .env: $dupes — کدام مقدار خوانده شود به پارسر بستگی دارد" "grep -n '^\\(${dupes// /\\|}\\)=' .env"

# A file saved on Windows carries \r at the end of every line, and that \r ends
# up inside the value. A password with an invisible carriage return in it fails
# to authenticate and the file looks perfect.
if grep -qU $'\r' "$ROOT/.env" 2>/dev/null; then
  bad ".env پایان خط ویندوزی دارد — یک \\r نامرئی به آخر هر مقدار می‌چسبد" "sed -i 's/\\r$//' .env"
else
  ok "پایان خط‌های .env سالم است"
fi

# ── required secrets ─────────────────────────────────────────────────────────
for spec in $REQUIRED_SECRETS; do
  key="${spec%%:*}"; min="${spec##*:}"
  if secret_ok "$key" "$min"; then
    ok "$key تنظیم شده"
  else
    bad "$key خالی یا کوتاه‌تر از $min کاراکتر است" \
        "sed -i \"s|^$key=.*|$key=\$(openssl rand -base64 32)|\" .env && docker compose up -d"
  fi
done

# A secret left at whatever the example file shipped with is not a secret. This
# compares against .env.example rather than a hard-coded list, so it keeps
# working as the example changes.
if [ -f "$ROOT/.env.example" ]; then
  leftovers=""
  for spec in $REQUIRED_SECRETS; do
    key="${spec%%:*}"
    live="$(env_get "$key")"
    sample="$(grep -E "^$key=" "$ROOT/.env.example" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
    [ -n "$live" ] && [ -n "$sample" ] && [ "$live" = "$sample" ] && leftovers="$leftovers $key"
  done
  [ -z "$leftovers" ] \
    && ok "هیچ رازی روی مقدار نمونه نمانده" \
    || bad "این رازها هنوز همان مقدار .env.example هستند:$leftovers" "هر کدام را با openssl rand دوباره بسازید"
fi

# ── this project's settings ──────────────────────────────────────────────────

[ "$(env_get NODE_ENV)" = "production" ] \
  && ok "NODE_ENV=production" \
  || bad "NODE_ENV برابر «$(env_get NODE_ENV)» است، نه production — پیام خطاها جزئیات داخلی را لو می‌دهند" \
         "sed -i 's|^NODE_ENV=.*|NODE_ENV=production|' .env && docker compose up -d api"

rl="$(env_get RATE_LIMIT_MAX)"
if [ -z "$rl" ] || [ "$rl" -ge 600 ] 2>/dev/null; then
  ok "RATE_LIMIT_MAX=${rl:-پیش‌فرض} — برای کار عادی کافی است"
else
  warn "RATE_LIMIT_MAX=$rl پایین است و کاربر واقعی را وسط کار قفل می‌کند" \
       "sed -i 's|^RATE_LIMIT_MAX=.*|RATE_LIMIT_MAX=1200|' .env && docker compose up -d api"
fi

case "$(env_get CORS_ORIGINS)" in
  *'*'*) bad "CORS_ORIGINS ستاره دارد — هر سایتی می‌تواند با کوکی کاربر به API بزند" "دامنه‌ها را صریح بنویسید" ;;
  "")    warn "CORS_ORIGINS خالی است" "CORS_ORIGINS=https://$(env_get BRAND_DOMAIN)" ;;
  *)     ok "CORS_ORIGINS محدود است" ;;
esac

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

# These two only gate the manual `npm run seed:demo`; nothing on startup reads
# them, and the seeder skips accounts that already exist. So a `true` here does
# not by itself put anything at risk — what matters is whether the demo
# accounts are live, which the data section checks against the database.
sd="$(env_get SEED_DEMO)"; ad="$(env_get ALLOW_DEMO_SEED)"
if [ "$sd" = "true" ] || [ "$ad" = "true" ]; then
  warn "کلید داده‌ی نمونه روشن است (SEED_DEMO=$sd، ALLOW_DEMO_SEED=$ad)" \
       "خودکار اجرا نمی‌شود — فقط با npm run seed:demo. قبل از لایو: هر دو false"
else
  ok "داده‌ی نمونه خاموش است"
fi

# `check-ignore` answers "is this ignored", and exits non-zero for two entirely
# different reasons: the file is not ignored, or there is no repository at all.
# A tarball install has no .git, so asking that question there reported
# «.env is tracked by git» on a server git had never touched.
if ! have git || [ ! -d "$ROOT/.git" ]; then
  skip "پروژه مخزن گیت نیست — ‎.env نمی‌تواند به مخزن برود"
elif git -C "$ROOT" ls-files --error-unmatch .env >/dev/null 2>&1; then
  bad ".env توسط گیت ردیابی می‌شود — رمزها به مخزن می‌روند" "git rm --cached .env && echo .env >> .gitignore"
else
  ok ".env در گیت ردیابی نمی‌شود"
fi
