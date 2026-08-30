# فرانوکار — FeranoCar

سامانه‌ی B2B حواله خودرو برای نمایندگی‌های ایران. نمایندگی‌ها آگهی می‌گذارند،
آگهی‌های هم را می‌بینند، و برای دیدن شماره‌ی تماس صاحب آگهی از سهمیه‌ی روزانه‌شان
خرج می‌کنند — که ثبت می‌شود و پاک نمی‌شود.

روی `https://feranocar.com`، روی یک سرور ایران (۳ هسته / ۲.۹ گیگابایت رم).

---

## اگر تازه به این پروژه رسیده‌اید

**[`docs/handover.md`](docs/handover.md) را بخوانید.** یک صفحه است و می‌گوید
پروژه کجاست، چه چیزی ساخته شده، چه چیزی نه، و کدام قاعده‌ها را نباید شکست.
بقیه‌ی این فایل فقط نقشه‌ی راه است.

---

## اجرای محلی، از صفر

پیش‌نیاز: Node 20+، PostgreSQL 16.

```bash
# ── دیتابیس ───────────────────────────────────────────────────────────────
sudo -u postgres psql -c "create role havale login password 'havale' superuser"
sudo -u postgres createdb -O havale havale_dev
sudo -u postgres createdb -O havale havale_test

# ── بک‌اند ────────────────────────────────────────────────────────────────
cd backend
cp .env.example .env          # DATABASE_URL و SESSION_SECRET را پر کنید
npm ci
npx prisma migrate deploy
DATABASE_URL="postgresql://havale:havale@127.0.0.1:5432/havale_test?schema=public" \
  npx prisma migrate deploy   # دیتابیس تست هم باید مهاجرت بخورد
npm run seed                  # مدیر اول — رمزش را یک بار چاپ می‌کند
SEED_DEMO=true node scripts/seed-demo.js   # نمایندگی‌های نمونه (فقط محلی)
npm run dev                   # API روی :3000

# ── فرانت‌اند ─────────────────────────────────────────────────────────────
cd ../frontend
npm ci                        # فقط برای تست مرورگری؛ خودِ پنل وابستگی ندارد
npm run dev                   # فایل‌های ثابت + پراکسی /api روی :5173
```

بعد `http://localhost:5173`.

> نکته‌ای که یک بار وقت گرفت: `seed-demo.js` باید دسترسی برند بدهد وگرنه
> حساب‌های نمونه می‌توانند وارد شوند و هیچ آگهی‌ای ثبت نکنند — منوی برند در فرم
> خالی می‌آید و هیچ خطایی هم نمی‌دهد. الان می‌دهد؛ اگر دوباره ندید، همان‌جا را
> نگاه کنید.

## تست

```bash
cd backend
npm test                      # واحد + یکپارچگی. e2e رد می‌شود
RUN_E2E=1 npm test            # همه‌چیز — به دیتابیس تست نیاز دارد

cd ../frontend
AGENT_USER=alborz AGENT_PASS=Demo@12345 \
AGENT2_USER=zagros AGENT2_PASS=Demo@12345 \
ADMIN_USER=admin ADMIN_PASS=<رمز مدیر> \
OWNER_USER=<حساب مالک> OWNER_PASS=<رمزش> \
BASE_URL=http://localhost:5173/ npm run smoke
```

اسموک یک مرورگر واقعی را روی API واقعی می‌راند. `AGENT2_*` اختیاری است ولی
بدونش، بررسی‌های پنهان‌سازی شماره روی هیچ چیزی اجرا می‌شوند و بی‌صدا سبز
می‌مانند — بدهیدش.

`OWNER_*` هم اختیاری است و صفحه‌های مالک را باز می‌کند. حساب مالک با
`node scripts/create-owner.js` ساخته می‌شود.

## استقرار

```bash
./deploy/update.sh            # روی سرور، داخل پوشه‌ی پروژه
```

خودش اول بکاپ کامل می‌گیرد، بعد کد را می‌آورد، می‌سازد و بالا می‌آورد. جزئیات و
اولین نصب: [`docs/deployment.md`](docs/deployment.md).

## نقشه

```
backend/          API — Express + Prisma + PostgreSQL
  src/modules/    هر بازار و هر بخش، یک ماژول مستقل
  src/jobs/       کار شبانه (آرشیو و پاک‌سازی لاگ)
  prisma/         schema و مهاجرت‌ها
frontend/         پنل — ES module خام، بدون build
  src/pages/      صفحه‌ها، به تفکیک نماینده و مدیر
  src/ui/         html.js (escape پیش‌فرض)، format.js (شمسی)، اجزای مشترک
deploy/           اسکریپت‌های سرور — update، backup، nightly، تشخیص کندی
docs/             ⬅ از handover.md شروع کنید
mockup/           طرح تأییدشده‌ی اولیه. مرجع تاریخی، نه کد زنده
security/         ارزیابی امنیتی
```

## اسناد

| فایل | چیست |
|---|---|
| [`docs/handover.md`](docs/handover.md) | **وضعیت پروژه و قاعده‌های معماری. اول این** |
| [`docs/blueprint.md`](docs/blueprint.md) | نیازمندی‌های اولیه‌ی محصول |
| [`docs/deployment.md`](docs/deployment.md) | نصب سرور از صفر، TLS، بکاپ |
| [`docs/monitoring-design.md`](docs/monitoring-design.md) | طراحی لاگ‌گیری و لاگ امنیتی |
| [`docs/launch-checklist.md`](docs/launch-checklist.md) | کارهای پیش از اولین نمایندگی واقعی |
| [`backend/README.md`](backend/README.md) | جزئیات API |
| [`frontend/README.md`](frontend/README.md) | قاعده‌های پنل |
