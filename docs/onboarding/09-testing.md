# فصل ۹ — تست

**در این فصل:** سه سوئیت، دستور دقیق هر کدام، چه چیزی را پوشش می‌دهند، و «قبل از
کامیت چه بزنم».

---

## ۹.۱ خلاصه

| سوئیت | کجا | چطور | چقدر |
|---|---|---|---|
| بک‌اند — واحد و یکپارچگی | `backend/tests/unit`, `integration` | `npm test` | ثانیه‌ها |
| بک‌اند — e2e | `backend/tests/e2e` | `RUN_E2E=1 npm test` | ~۷۵ ثانیه، ۵۵۷ تست |
| اسموک مرورگری | `frontend/tests/smoke.mjs` | `node tests/smoke.mjs` با API زنده | ~۲ دقیقه، ۶۲ مرحله |
| lint | `backend/` | `npm run lint` | ثانیه‌ها |
| اسکن امنیتی | `security/audit.js` | `node security/audit.js` | ثانیه‌ها |

**قبل از هر کامیت:** lint + `RUN_E2E=1 npm test`. **قبل از push به شاخه:** اسموک هم.

---

## ۹.۲ بک‌اند

```bash
cd backend
npm test                     # واحد + یکپارچگی؛ e2e رد می‌شود (describe.skip)
RUN_E2E=1 npm test           # همه — به havale_test نیاز دارد (فصل ۴)
RUN_E2E=1 npx jest tests/e2e/hardening.test.js    # یک فایل
npx jest -t 'locks the account'                   # یک تست به نام
```

- `tests/setup.js`: `NODE_ENV=test`، `DATABASE_URL` **هاردکد** به `havale_test`
  (تا هیچ‌وقت داده‌ی توسعه پاک نشود)، کلید رمزنگاری ثابت، rate limit خاموش.
- `tests/helpers/factory.js`: `createAgent()`, `signedInAgent()`,
  `giveSubscription()`, `offer()`, `purchaseRequest()`, `cleanup(ids)`. هر رکورد
  با پیشوند `test_` تا سوئیت فقط ساخته‌ی خودش را پاک کند.
- e2e با `supertest` مستقیم روی `app` (بدون پورت). آدرس مشتری با
  `X-Forwarded-For` قابل تنظیم است (`trust proxy 1`).

### فایل‌های e2e و موضوعشان

| فایل | چه چیزی را قفل می‌کند |
|---|---|
| `auth` | ورود، نشست، یک‌نشست، تغییر رمز، قفل، راهنمای دیده‌شده، `/session` |
| `havale`, `registration`, `car` | چرخه‌ی هر بازار، پنهان‌سازی، سهمیه، عکس‌ها |
| `textLeak` | **هر ستون متنی را از schema پیدا می‌کند** و مطمئن می‌شود بدون reveal سرو نمی‌شود |
| `moderation` | گزارش، سه اخطار، تعلیق، اطلاعیه، تیکت |
| `subscription` | resolveAccess، انقضا، ظرفیت، فیش |
| `brandAccess`, `catalog` | مجوز برند، کاتالوگ، نوع بدنه |
| `admin`, `owner` | پنل مدیریت، مجوزها، مالک نامرئی |
| `security`, `hardening` | لاگ نفوذ، و هر یافته‌ی بازبینی امنیتی (فصل ۱۰) |
| `activityLog`, `retention` | لاگ کارها، آرشیو و پاک‌سازی |
| `carPrices`, `sms` | قیمت روز (با fixture منبع)، پیامک |

---

## ۹.۳ اسموک مرورگری

با API (`:3000`) و dev-server (`:5173`) روشن:

```bash
cd frontend
AGENT_USER=zagros AGENT_PASS=Demo@12345 \
AGENT2_USER=alborz AGENT2_PASS=Demo@12345 \
ADMIN_USER=admin ADMIN_PASS='…' \
OWNER_USER=… OWNER_PASS='…' \
BASE_URL=http://127.0.0.1:5173/ \
CHROME_PATH=/usr/bin/chromium \        # اختیاری؛ وگرنه Chromium خودِ Playwright
node tests/smoke.mjs
```

چه می‌کند: با نماینده وارد می‌شود، هر صفحه را باز می‌کند، آگهی ثبت و ویرایش و حذف
می‌کند، «نمایش مشخصات» می‌زند و **کل سند را می‌گردد که شماره‌ای بیرون کارت
بازشده نباشد**، فیلدهای بی‌نام را می‌شمارد (باید صفر باشد)، راهنمای اول ورود را
با حساب دوم چک می‌کند، یک حمله‌ی واقعی (SQL payload، `/wp-login.php`) می‌فرستد و
در پنل مالک ثبتش را می‌بیند، پنل مدیریت را می‌گردد، و در پایان هر چه ساخته
پاک می‌کند. خطای کنسول = شکست (به جز ۴۰۱/۴۰۳/۴۰۴/۴۲۲ که عمداً تولید می‌شوند).

**اگر قدم پنهان‌سازی قرمز شد، مثل یک حادثه با آن رفتار کنید.**

نکته: حساب `AGENT2_USER` باید راهنما را **ندیده** باشد (اسموک همان را تست می‌کند)
یا مرحله‌اش را با حساب تازه اجرا کنید؛ بعد از یک اجرا، راهنمای آن حساب دیده‌شده
ثبت می‌شود و اجرای بعدی قدم «gate» را رد می‌کند و می‌گوید چرا.

---

## ۹.۴ اسکن امنیتی

```bash
node security/audit.js                                          # کد — ۰ بحرانی، ۰ مهم انتظار می‌رود (به جز TLS در مخزن)
node security/audit.js --live http://127.0.0.1:5173 --user zagros --pass 'Demo@12345'   # حمله‌ی واقعی
```

چه می‌گیرد: sinkهای XSS (با دنبال کردن تابع رندرکننده)، SQL خام، کوکی، نشت
توکن، خواندن شماره خارج از dto، رازها در مخزن، پورت‌های باز compose، سربرگ‌های
nginx، `npm audit`. در حالت live: تزریق، CSRF، reveal بدون پرداخت، مسیرهای
مدیریت با حساب نماینده، brute force. خروجی کامل در `security/last-report.json`.

---

## ۹.۵ نوشتن تست جدید

- قاعده‌ی محصول جدید → یک e2e که **از بیرون** (HTTP) آن را می‌زند، نه تست واحد
  سرویس. تست‌های واحد برای تابع‌های خالص (`textGuard`, parser, تقویم).
- نام تست جمله‌ی کامل انگلیسی است که رفتار را می‌گوید: `it('refuses a حواله id sent
  to the خودرو reveal route')`.
- یافته‌ی امنیتی بسته‌شده → یک `it` در `hardening.test.js` تا refactor بعدی دوباره
  بازش نکند.
- هر ماژول یک فایل؛ `cleanup(created)` در `afterAll`.
- fixture منبع بیرونی (مثل صفحه‌ی قیمت) در `tests/fixtures/` — قرارداد parser است؛
  اگر منبع فرمت عوض کرد، fixture را با نسخه‌ی جدید جایگزین کنید و parser را.

---

## ۹.۶ CI

هنوز CI خودکار وجود ندارد (تصمیم نگرفته‌شده؛ فصل ۱۲). تا آن روز، سبز بودن
سوئیت‌ها **مسئولیت کسی است که push می‌کند**.
