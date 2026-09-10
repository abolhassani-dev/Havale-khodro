# CLAUDE.md — رفتار و دستورهای این مخزن

این فایل برای دستیار هوش مصنوعی (و هر کسی که تازه وارد شده) نوشته شده. کوتاه است؛
جزئیات در اسنادی است که نشانی می‌دهد. **اول [`docs/handover.md`](docs/handover.md)
را بخوان** — وضعیت امروز، تصمیم‌ها و قاعده‌های معماری آن‌جاست. دفترچه‌ی کامل
توسعه‌دهنده: [`docs/onboarding/`](docs/onboarding/README.md).

## محصول در یک خط

فرانوکار (feranocar.com): بازار بسته‌ی B2B که نمایندگی‌های خودرو در ایران در آن
حواله، ظرفیت ثبت‌نامی و خودرو معامله می‌کنند؛ شماره‌ی تماس تا «نمایش مشخصات»
(خرج سهمیه‌ی اشتراک) پنهان است.

## قاعده‌های سخت — بدون استثنا

- **هیچ رمز، کلید یا رازی** در چت، کامیت، کد یا سند. مقادیر `.env` هرگز paste نمی‌شوند.
- **نام کاربری حساب مالک (`OWNER`) هیچ‌جا نوشته نمی‌شود** — کد، seed، تست، سند، گفتگو.
- **مالک خودش دیپلوی می‌کند** (`./deploy/update.sh` روی سرور، دو بار). ما دسترسی تولید نداریم؛
  خروجی را از او می‌گیریم.
- توسعه، کامیت و push فقط روی شاخه‌ی `claude/delegation-platform-phase-one-0xfqz7`.
- رابط و اسناد **فارسی**؛ توضیحات کد **انگلیسی** و درباره‌ی «چرا».
- به تعویق افتاده به تصمیم مالک — دوباره پیشنهاد نده: `DATA_ENCRYPTION_KEY`، بکاپ خارج از سرور.
- `SEED_DEMO`/`ALLOW_DEMO_SEED` پیش از اولین نمایندگی واقعی `false`؛ نام منبع قیمت روز در رابط نمی‌آید؛
  فعلاً هیچ متنی درباره‌ی پیامک در راهنما.
- هر کامیت سبز: lint + `RUN_E2E=1 npm test` (بک‌اند) و پیش از push، اسموک مرورگری.
- تغییر قاعده‌ی محصول یا معماری → `docs/handover.md` در **همان کامیت**.

## قاعده‌های معماری (خلاصه — کامل در handover §۳)

1. هسته هیچ بازاری را import نمی‌کند؛ بازار خودش را در `marketRegistry` ثبت می‌کند.
2. شماره‌ی تماس فقط در `*.dto.js` خوانده می‌شود (`security/audit.js` چک می‌کند).
3. `ui/html.js` پیش‌فرض escape می‌کند؛ `raw()` فقط برای ثابت‌ها؛ `safeUrl()` برای لینک سرور.
4. حالت فرم در DOM، حالت صفحه در store؛ هر `data-*` کلیک در `CLICK_KEYS` (`main.js`).
5. خطای اعتبارسنجی ۴۲۲؛ «مال کسی دیگر» ۴۰۴.
6. کار زمان‌بندی‌شده = فایل در `src/jobs/` + کرون هاست؛ هیچ `setInterval`.
7. تنظیمات زمان اجرا در شیء `SETTINGS`؛ ثابت‌های محصول در `constants/`.
8. هر سهمیه/سقف زیر `serialized(key, tx => …)` (قفل مشورتی).
9. `location` تازه‌ی nginx با `add_header` → `include security-headers.inc`؛ بدنه‌ی سایت در `site.inc`.
10. بستن آدرس هرگز خودکار نیست؛ مالک هیچ لاگی نمی‌نویسد.

## دستورهای دقیق (محیط این مخزن)

```bash
# پستگرس (گاهی می‌میرد)
pg_ctlcluster 16 main start
# بک‌اند
cd backend && (setsid nohup node server.js >/tmp/api.log 2>&1 </dev/null &)      # :3000
pkill -f "node serve[r].js"                                                        # توقف
ESLINT_USE_FLAT_CONFIG=false npx eslint src tests scripts                          # lint
RUN_E2E=1 npx jest --runInBand                                                     # ۵۵۷ تست، ~۷۵ ثانیه
DATABASE_URL='postgresql://havale:havale@127.0.0.1:5432/havale_test' npx prisma migrate deploy   # بعد از هر مایگریشن
# فرانت (حتماً از پوشه‌ی frontend)
cd frontend && (setsid nohup node tests/dev-server.js >/tmp/web.log 2>&1 </dev/null &)   # :5173
AGENT_USER=zagros AGENT_PASS=Demo@12345 AGENT2_USER=alborz AGENT2_PASS=Demo@12345 \
ADMIN_USER=admin ADMIN_PASS='…' OWNER_USER=… OWNER_PASS='…' \
CHROME_PATH=/opt/pw-browsers/chromium BASE_URL=http://127.0.0.1:5173/ node tests/smoke.mjs   # ۶۲ مرحله
# امنیت
node security/audit.js                                  # کد؛ انتظار: ۰ بحرانی، ۰ مهم (جز TLS در مخزن)
node security/audit.js --live http://127.0.0.1:5173 --user zagros --pass 'Demo@12345'
# داده‌ی نمونه‌ی محلی
cd backend && npm run seed && SEED_DEMO=true ALLOW_DEMO_SEED=true node scripts/seed-demo.js && node scripts/seed-cars.js
# اسناد تولیدی
node docs/guide/render.mjs   # راهنمای PDF از frontend/src/content/guide.js
node docs/pitch/render.mjs   # دِک معرفی
```

نکته‌های محیطی: `frontend/` ریشه‌ی وب nginx است — فایل غیرسایتی آن‌جا نگذار؛
`update.sh` خودش را وسط کار بازنویسی می‌کند (دو بار اجرا)؛ Docker Hub از ایران
بسته است (میرور در `daemon.json`)؛ اسموک با حسابی که راهنما را ندیده، قدم gate را
تست می‌کند.

## کجا چه هست

| نیاز | مسیر |
|---|---|
| وضعیت، تصمیم‌ها، قاعده‌ها | `docs/handover.md` |
| دفترچه‌ی توسعه‌دهنده | `docs/onboarding/` |
| بازبینی امنیتی و موارد باز | `docs/security-audit.md` |
| ساخت سرور / دستورهای روزمره | `docs/deployment.md`, `deploy/README.md` |
| پیش از لانچ | `docs/launch-checklist.md` |
| راهنمای نمایندگی (PDF) و دِک | `docs/guide/`, `docs/pitch/` |
| فایل‌های تاریخی / اسکلت / ابزار کم‌کاربرد | `archive/` — اجرا و سرو نمی‌شود؛ چیزی به آن اضافه نکن مگر بازنشسته شده باشد |
