# فصل ۴ — راه‌اندازی محیط توسعه

**در این فصل:** از یک ماشین خالی تا پنل روی `http://localhost:5173` با داده‌ی نمونه،
و رفع اشکال‌های رایج. حدود ۲۰ دقیقه.

پیش‌نیاز: **Node 20+**، **PostgreSQL 16**، git. (Docker برای توسعه لازم نیست —
فقط برای سرور.)

---

## ۴.۱ پایگاه داده

دو دیتابیس: یکی برای توسعه، یکی که تست‌ها آزادانه پاکش می‌کنند.

```bash
sudo -u postgres psql -c "create role havale login password 'havale' superuser"
sudo -u postgres createdb -O havale havale_dev
sudo -u postgres createdb -O havale havale_test
```

> نام کاربری/رمز `havale` فقط برای ماشین توسعه است. تست‌ها آدرس دیتابیس تست را
> **هاردکد** دارند (`tests/setup.js`) تا هرگز روی داده‌ی واقعی اجرا نشوند.

---

## ۴.۲ بک‌اند

```bash
cd backend
cp .env.example .env
```

در `.env` این دو خط را تنظیم کنید (بقیه پیش‌فرض دارند):

```
DATABASE_URL=postgresql://havale:havale@127.0.0.1:5432/havale_dev?schema=public
SESSION_SECRET=یک-رشته‌ی-تصادفی-بلند
```

سپس:

```bash
npm ci
npx prisma migrate deploy                                   # جدول‌ها
DATABASE_URL='postgresql://havale:havale@127.0.0.1:5432/havale_test' npx prisma migrate deploy   # دیتابیس تست
npm run seed                                                # پلن، کاتالوگ، مدیر اول — رمز را یک بار چاپ می‌کند؛ نگهش دارید
SEED_DEMO=true ALLOW_DEMO_SEED=true node scripts/seed-demo.js   # ۴ نمایندگی نمونه + حواله‌ها
node scripts/seed-cars.js                                   # ۱۰ آگهی نمونه‌ی خودرو
npm run dev                                                 # API روی :3000 (nodemon)
```

حساب‌های نمونه: `zagros`, `alborz`, `khalij`, `pars` — همه با رمز `Demo@12345`.
مدیر: `admin` با رمزی که `seed` چاپ کرد (ورود اول تغییر رمز می‌خواهد).

---

## ۴.۳ فرانت‌اند

```bash
cd ../frontend
npm ci          # فقط Playwright برای اسموک‌تست
npm run dev     # فایل‌های ثابت + پراکسی /api → :3000، روی :5173
```

> `dev-server.js` باید **از داخل پوشه‌ی `frontend`** اجرا شود؛ مسیر ریشه‌اش
> نسبی است.

مرورگر: `http://localhost:5173`. با `zagros` وارد شوید. بار اول راهنمای سامانه
می‌آید؛ «راهنما را دیدم» را بزنید.

---

## ۴.۴ حساب مالک (اختیاری)

برای دیدن بخش مالک (لاگ فنی، لاگ امنیتی، کارمندان):

```bash
cd backend && node scripts/create-owner.js     # نام و رمز را در ترمینال می‌پرسد؛ هیچ‌جا چاپ نمی‌شود
```

نام کاربری‌ای که برای ماشین خودتان انتخاب می‌کنید مهم نیست — ولی نام حساب مالک
**روی سرور** هیچ‌جا نوشته نمی‌شود (فصل ۱۰).

---

## ۴.۵ بررسی این‌که همه‌چیز درست است

```bash
cd backend
npm run lint                      # باید تمیز باشد
RUN_E2E=1 npm test                # ۵۵۷ تست، حدود ۷۵ ثانیه
cd ../frontend                    # با API و dev-server روشن:
AGENT_USER=zagros AGENT_PASS=Demo@12345 AGENT2_USER=alborz AGENT2_PASS=Demo@12345 \
ADMIN_USER=admin ADMIN_PASS='رمز-مدیر' OWNER_USER=… OWNER_PASS='…' \
BASE_URL=http://127.0.0.1:5173/ node tests/smoke.mjs     # ۶۲ مرحله
```

اگر Chromium سیستمی دارید و نمی‌خواهید Playwright دانلود کند:
`CHROME_PATH=/usr/bin/chromium`. جزئیات در فصل ۹.

---

## ۴.۶ اشکال‌های رایج

| نشانه | علت | راه‌حل |
|---|---|---|
| `Missing required environment variables: DATABASE_URL` | `.env.example` عمداً `DATABASE_URL` ندارد (compose آن را می‌سازد) | خط را دستی اضافه کنید (۴.۲) |
| `EADDRINUSE :3000` | API قبلی هنوز زنده است | `pkill -f "node server.js"` |
| API بالا می‌آید ولی `connect ECONNREFUSED 5432` | پستگرس خاموش | `pg_ctlcluster 16 main start` (یا `systemctl start postgresql`) |
| dev-server ۴۰۴ برای همه‌چیز | از پوشه‌ی اشتباه اجرا شده | `cd frontend && npm run dev` |
| تست‌های e2e: «column does not exist» | دیتابیس تست مایگریشن جدید را نگرفته | دستور `migrate deploy` با `DATABASE_URL` تست (۴.۲) |
| حساب نمونه وارد می‌شود ولی منوی برند خالی است | `seed-demo` بدون دسترسی برند اجرا شده | دوباره `seed-demo` بزنید؛ idempotent است |
| نماینده‌ی نمونه همیشه به `#guide` می‌رود | راهنما هنوز تأیید نشده — رفتار درست است | دکمه‌ی «راهنما را دیدم» |
| اسموک در قدم ورود گیر می‌کند | حساب نمونه هنوز راهنما را ندیده و اسموک آن قدم را با حساب دیگری می‌خواهد | با `alborz` یک بار وارد شوید و راهنما را تأیید کنید، یا `AGENT2_USER` را عوض کنید |
| `prisma migrate reset` داده را پاک کرد | همین کار را می‌کند | مراحل seed در ۴.۲ را تکرار کنید |

---

## ۴.۷ ابزارهای کمکی

| کار | دستور |
|---|---|
| مستندات API (Swagger) | `http://localhost:3000/docs` — فقط در development |
| دیدن دیتابیس | `psql postgresql://havale:havale@127.0.0.1:5432/havale_dev` یا `npx prisma studio` |
| اسکن امنیتی کد | `node security/audit.js` از ریشه‌ی مخزن |
| ساخت دوباره‌ی PDF راهنما | `docs/guide/README.md` |
