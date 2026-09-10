# فصل ۳ — نقشه‌ی پوشه‌ها

**در این فصل:** هر پوشه و فایل مهم مخزن، با یک خط توضیح. این فصل را کنار دست نگه
دارید. اگر فایلی این‌جا نیست، بالای خودِ فایل توضیح دارد — تقریباً همیشه.

---

## ۳.۱ ریشه

```
Havale-khodro/
├── README.md                 راه‌اندازی سریع + فهرست اسناد
├── CLAUDE.md                 قاعده‌ها و دستورهای دقیق برای دستیار هوش مصنوعی (و برای شما)
├── .env.example              همه‌ی متغیرهای محیطی با توضیح؛ نسخه‌ی واقعی `.env` هرگز کامیت نمی‌شود
├── docker-compose.yml        چهار سرویس: web (nginx)، api، db، adminer (+ certbot با profile)
├── backend/                  API
├── frontend/                 پنل (ریشه‌ی وب nginx است — هر فایلی این‌جا قابل دانلود است)
├── deploy/                   اسکریپت‌های سرور و پیکربندی nginx
├── docs/                     اسناد، راهنمای PDF، دِک معرفی، این دفترچه
├── security/                 audit.js — اسکن کد و تست زنده‌ی امنیتی
├── mockup/                   ماکاپ HTML تأییدشده‌ی فاز یک (تاریخی، سرو نمی‌شود)
└── .claude/skills/           اسکلت استاندارد پروژه که ابزار هوش مصنوعی از آن شروع کرد
```

---

## ۳.۲ بک‌اند — `backend/`

```
backend/
├── server.js                 بوت: کلاستر اختیاری، اتصال دیتابیس، listen
├── package.json              اسکریپت‌ها: dev, test, lint, seed, seed:demo, seed:cars, create:owner
├── Dockerfile, docker/entrypoint.sh   ایمیج چندمرحله‌ای، کاربر غیر-root، `prisma migrate deploy` در بوت
├── .env.example              نسخه‌ی بک‌اند برای اجرای محلی بدون Docker
├── prisma/
│   ├── schema.prisma         ۳۱ مدل، با توضیح فارسی بالای هر کدام — فصل ۷
│   └── migrations/           ۳۴ مایگریشن؛ هر تغییر schema یکی اضافه می‌کند
├── scripts/
│   ├── seed.js               پلن پیش‌فرض، کاتالوگ، مدیر اول (رمز را یک بار چاپ می‌کند)
│   ├── seed-demo.js          چهار نمایندگی نمونه + چند حواله (فقط با ALLOW_DEMO_SEED=true)
│   ├── seed-cars.js          ده آگهی نمونه‌ی بازار خودرو
│   ├── create-owner.js       ساخت حساب مالک — رمز از ترمینال خاموش، هرگز از آرگومان
│   ├── build-catalog.js      ساخت کاتالوگ ۱۸۶ برندی از داده‌ی خام
│   ├── dedupe-catalog.js     پاک‌سازی تکراری‌های کاتالوگ
│   ├── encrypt-existing.js   بک‌فیل رمزنگاری ستون‌ها وقتی کلید فعال شد
│   ├── repair-subagents.js   ترمیم داده‌ی زیرنمایندگی‌های قدیمی
│   └── loadtest.js           تست بار (حساب‌ها از فایل بیرون مخزن)
├── tests/
│   ├── setup.js              NODE_ENV=test، دیتابیس تست جدا، کلید رمزنگاری تستی
│   ├── helpers/factory.js    ساخت نمایندگی، اشتراک، ورود، آگهی، پاک‌سازی
│   ├── unit/                 بدون دیتابیس: textGuard, crypto, parser قیمت, classifier بدنه، …
│   ├── integration/          health
│   ├── e2e/                  با دیتابیس (RUN_E2E=1): هر ماژول یک فایل + hardening + textLeak
│   └── fixtures/             دو صفحه‌ی ذخیره‌شده‌ی منبع قیمت (قرارداد parser)
└── src/
    ├── app.js                ترتیب میان‌افزارها (فصل ۲.۲)
    ├── config/
    │   ├── index.js          تنها جایی که process.env خوانده می‌شود
    │   └── database.js       PrismaClient + رمزنگاری خودکار ستون‌های ENCRYPTED
    ├── constants/            roles (نقش و مجوز)، messages (متن‌های فارسی)، errorCodes، havale، moderation، brand
    ├── errors/AppError.js    خانواده‌ی خطاها: NotFound, Forbidden, Validation(422), Conflict, …
    ├── middlewares/          auth, access, validate, rateLimiter, sameOrigin, threatDetect, blockedIp,
    │                         slowRequest, requestId, errorHandler, notFound
    ├── responses/            شکل یکسان پاسخ
    ├── routes/               index.js (اتصال ماژول‌ها به /api/v1/…) + health
    ├── docs/swagger.js       /docs — فقط خارج از production
    ├── hooks/, validators/   الگوهای مشترک Joi
    ├── jobs/                 nightly.js, car-prices.js — از کرون هاست اجرا می‌شوند
    ├── utils/                logger, crypto, textGuard, time (تقویم تهران), token, uploads (+ بررسی امضای فایل),
    │                         serialize (قفل مشورتی), queryList, diff, persian, maskPhone, requestContext
    └── modules/              ← فصل ۵
        ├── auth/             ورود، نشست، تغییر رمز، راهنمای دیده‌شده، /session
        ├── user/             user.dto — تنها سریالایزر کاربر (نه توکن، نه هش)
        ├── listing/          هسته: reveal.service (سهمیه و ثبت)، reveal.dto، marketRegistry
        ├── havale/           بازار حواله (نمونه‌ی مرجع برای بازار جدید)
        ├── registration/     بازار ثبت‌نامی
        ├── car/              بازار خودرو: constants (۲۲ قطعه)، upload (عکس‌ها)، market
        ├── catalog/          شرکت/برند/مدل/رنگ، bodyClassifier، brandAccess (مجوز برند هر نمایندگی)
        ├── carprice/         قیمت روز: fetch, parser, service, routes (فهرست، ستاره، تاریخچه)
        ├── subscription/     پلن، اشتراک، resolveAccess، ظرفیت (seat)، فیش واریزی
        ├── subagent/         زیرنمایندگی‌ها
        ├── report/           گزارش تخلف و سه اخطار
        ├── notice/           صندوق اطلاعیه (بدون جدول — از گزارش‌ها ساخته می‌شود)
        ├── ticket/           پشتیبانی با پیوست
        ├── sms/              درایورها (log / پنل)، قالب‌ها، تاریخچه
        ├── settings/         تنظیمات زمان اجرا: SETTINGS یک شیء است؛ کلید جدید همان‌جا اعلام می‌شود
        ├── admin/            نمایندگی‌ها، آگهی‌ها، میز بازارها، کارمندان، مانیتورینگ، retention، dashboard
        ├── security/         لاگ امنیتی و بستن آدرس (پنل مالک)
        └── alert/            لاگ خطا و ارسال به ربات
```

---

## ۳.۳ فرانت‌اند — `frontend/`

```
frontend/
├── index.html                تنها صفحه؛ <div id="root"> + <div id="layer"> (مودال/توست)
├── error.html                صفحه‌ی خطای مستقل nginx (بدون CSS/JS برنامه)
├── robots.txt
├── package.json              فقط Playwright برای اسموک؛ خودِ پنل وابستگی ندارد
├── assets/
│   ├── vazirmatn.woff2       فونت — محلی، نه CDN
│   ├── logo.svg, favicon.svg
│   ├── brands/               لوگوی برندها
│   ├── body/                 برگه‌ها و برش‌های نقشه‌ی بدنه (webp هر نما)
│   └── guide/                ۳۲ اسکرین‌شات راهنمای داخل پنل
├── scripts/                  crop-body-sheets.py, body-dots.py — ابزار ساخت نقشه‌ی بدنه (پایتون، فقط توسعه)
├── tests/
│   ├── dev-server.js         فایل‌های ثابت + پراکسی /api → :3000
│   └── smoke.mjs             ۶۲ مرحله‌ی مرورگری (Playwright)
└── src/
    ├── main.js               بوت، حلقه‌ی رندر، CLICK_KEYS، تنها شنونده‌ی کلیک، settleAutocomplete
    ├── router.js             هش‌روتر، route()، go()، نگهبان رمز و راهنما، badgeها
    ├── session.js            boot (/auth/session)، refreshAccess، watchSession
    ├── constants.js          برند و سقف‌های آینه‌شده از سرور
    ├── api/
    │   ├── client.js         تنها fetch؛ cookie، ۴۰۱/۴۰۳/۴۲۲، SESSION_KICKED
    │   └── index.js          همه‌ی endpointها به نام
    ├── state/store.js        getState/setState/subscribe، isAdmin/isAgent/can
    ├── content/guide.js      ۱۵ فصل راهنما + نگاشت صفحه→فصل (منبع PDF هم هست)
    ├── styles/               app.css، app-extra.css
    ├── ui/
    │   ├── html.js           html``, raw(), escape(), safeUrl()
    │   ├── shell.js          سایدبار، نوار بالا، لینک «راهنمای این بخش»
    │   ├── modal.js, feedback.js   مودال، توست، خطای فرم، pager، جعبه‌ی خالی/در حال بارگذاری
    │   ├── format.js, jalali.js    اعداد فارسی، پول، تاریخ شمسی (Intl)
    │   ├── moneyInput.js, dateInput.js, pickSelect.js, brandPicker.js, brandFilter.js,
    │   │   checkChips.js, filterBox.js, filePicker.js, cardMeta.js, icons.js
    │   └── bodyMap.js        نقشه‌ی سه‌نمایی بدنه با نقطه‌ها، ۵ گروه قطعه
    └── pages/
        ├── agent/            dashboard, search (حواله), listings (ثبت/من), registration, car,
        │                     carPrices, notices, account (اشتراک/شعبه/تیکت), profile, guide, soon
        └── admin/            index (نمایندگی‌ها، میزها، گزارش‌ها، تنظیمات، داشبورد)، catalog,
                              staff, securityLog, systemLog
```

---

## ۳.۴ دیپلوی — `deploy/`

فهرست کامل با «کِی» در [`deploy/README.md`](../../deploy/README.md).

```
deploy/
├── update.sh            دیپلوی در محل (دو بار اجرا شود)؛ کرون‌ها، logrotate و فایل‌های TLS را تازه می‌کند
├── preflight.sh + preflight.d/   ۱۴ بررسیِ «سرور همان است که باید؟»
├── enable-ssl.sh        گواهی و سوئیچ به HTTPS (یک بار)
├── backup.sh, verify-backup.sh   آرشیو کامل و تست بازگردانی
├── nightly.sh, car-prices.sh     پوشش کرون برای دو job
├── watchdog.sh, notify.sh, alert-setup.sh, alert-probe.sh   دیده‌بان و هشدار
├── panel-check.sh, perf-check.sh, loadtest.sh   کندی و بار
├── fetch-brand-logos.sh, brand-logo-aliases.txt
└── nginx/
    ├── app.conf             سرور HTTP (listen 80 + include site.inc)
    ├── site.inc             بدنه‌ی سایت — مشترک بین HTTP و HTTPS
    ├── security-headers.inc CSP و بقیه‌ی سربرگ‌ها
    ├── 00-mode.conf         سوئیچ HTTPS (روی سرور بازنویسی می‌شود)
    ├── 01-redirect.conf     نقشه‌ی «این درخواست باید به HTTPS برود؟»
    ├── adminer.conf         پنل دیتابیس روی ۸۴۴۳
    └── write-ssl.sh         تولید ssl.conf و adminer.conf برای TLS
```

---

## ۳.۵ اسناد — `docs/`

| مسیر | چیست |
|---|---|
| `handover.md` | مرجع تصمیم‌ها و وضعیت امروز |
| `onboarding/` | این دفترچه |
| `deployment.md` | ساخت سرور از صفر |
| `launch-checklist.md` | قبل از اولین نمایندگی واقعی |
| `security-audit.md` | بازبینی امنیتی شهریور ۱۴۰۵ |
| `monitoring-design.md` | طراحی لاگ‌ها (ساخته شده) |
| `car-catalog.md` | چرا فهرست بسته، ساختار کاتالوگ |
| `guide/` | راهنمای PDF نمایندگی‌ها + اسکریپت ساختش |
| `pitch/` | دِک معرفی محصول (PDF) |
| `screens/` | اسکرین‌شات صفحه‌ها (خارج از ریشه‌ی وب) |
| `blueprint.md`, `staging.md`, `tech-plan.*` | تاریخی — نیازمندی اولیه و برنامه‌ی فنی فاز یک؛ جاهایی با کد امروز فرق دارد |

---

## ۳.۶ فایل‌هایی که هرگز کامیت نمی‌شوند

`.env`, `backend/.env`, `deploy/nginx/.htpasswd`, `deploy/nginx/ssl.conf`,
`security/last-report.json`, `scratchpad/`, هر `*.log`. فهرست کامل در `.gitignore`.
