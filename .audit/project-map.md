---
repo: Havale-khodro
repo_version: b581cf3779344cbef3a6f6fd9645122f10e8419d
generated_at: 2026-08-17
---

# Project Map — Havale-khodro

## A. پروژه چیست

### A1 — هویت و هدف

- **بازار B2B «حواله خودرو» بین نمایندگی‌ها، با دو پنل: نمایندگی و مدیریت** · `verified`
  `backend/prisma/schema.prisma` · `// سامانه حواله خودرو — فاز ۱` و `// دو پنل: نمایندگی‌ها و مدیریت (ادمین)`

- **مدل کسب‌وکار روی «نمایش مشخصات تماس» سوار است: هر بار دیدن شماره‌ی فروشنده ثبت و از سقف روزانه کم می‌شود** · `verified`
  `backend/src/modules/havale/havale.dto.js` · `contact: null, contactRevealed: false`
  هویت نمایندگی (نام، کد، شهر) و شماره با هم باز می‌شوند، نه جدا — همان فایل، شرط `if (!subscriptionActive) return card;`.

- **ثبت‌نام عمومی وجود ندارد؛ حساب را ادمین می‌سازد** · `verified`
  `backend/src/modules/auth/auth.service.js` · `so there is deliberately no `register` here`

### A2 — پشته و فریم‌ورک‌ها

- **Backend: Node.js ≥ 20، Express `^4.19.2`، Prisma `^5.19.0`، PostgreSQL 16، Joi `^17.13.3`، bcryptjs، winston، swagger-jsdoc** · `verified`
  `backend/package.json` · `"engines": { "node": ">=20" }` و بلوک `dependencies`
  CommonJS است، نه ESM: `"type": "commonjs"`.

- **حفاظت‌های پیش‌فرضی که واقعاً وصل شده‌اند: `helmet()`، `cors` با allowlist، سقف حجم بدنه، rate limit سراسری** · `verified`
  `backend/src/app.js` · `app.use(helmet());` … `app.use(rateLimiter);`

- **Frontend: جاوااسکریپت خالص با ES modules، بدون build step و بدون هیچ dependency** · `verified`
  `frontend/README.md` · `## No build step` — و در `frontend/` هیچ `package.json` وجود ندارد.

- **زیرساخت: nginx `1.27-alpine`، `postgres:16-alpine`، `adminer:4`، certbot** · `verified`
  `docker-compose.yml` · `image: nginx:1.27-alpine`

### A3 — ساختار و اجزا

- **چهار جزء زنده: `backend/` (API)، `frontend/` (فایل استاتیک)، `deploy/` (nginx + اسکریپت‌های عملیاتی)، و PostgreSQL** · `verified`
  `docker-compose.yml` · `services:` با `web`, `api`, `db`, `adminer`, `certbot`
  `api` هیچ پورتی publish نمی‌کند و فقط از پشت nginx در دسترس است: `expose: - '3000'`.

- **کد واقعی backend در `src/modules/<feature>/` است؛ ۱۲ ماژول با الگوی routes → service → repository** · `verified`
  `backend/src/routes/index.js` · `router.use('/havales', havaleRoutes);`

- **بخش بزرگی از درخت پوشه‌ها خالی و فقط `README.md` است — باقی‌مانده‌ی scaffold** · `verified`
  `backend/src/controllers/README.md`, `backend/src/queues/README.md`, `frontend/src/components/README.md`
  یعنی نبودن کد در `controllers/`, `services/`, `jobs/`, `queues/`, `sockets/` نشانه‌ی چیز گم‌شده نیست.

- **`mockup/` یک نمونه‌ی استاتیک بدون دیتابیس است، نه بخشی از سامانه‌ی زنده** · `verified`
  `mockup/README.md` · `دیتابیسی در کار نیست؛ داده‌ها نمونه‌اند.`

- **`security/audit.js` و `security/pentest.js` ابزار بازرسی‌اند و در مسیر اجرای برنامه نیستند** · `verified`
  `backend/package.json` · `"audit:security": "node ../security/audit.js"`

## B. چه چیزی وارد و خارج می‌شود

### B1 — نقاط ورود

- **۷۹ endpoint زیر پیشوند `/api/v1`** · `verified`
  `backend/src/config/index.js` · `apiPrefix: process.env.API_PREFIX || '/api/v1'`
  شمارش از تعریف‌های `router.<method>` در `src/routes/*.js` و `src/modules/*/*.routes.js`.

- **فقط سه مسیر `public-anonymous` هستند: `GET /health`، `POST /auth/login`، `POST /auth/logout`** · `verified`
  `backend/src/modules/auth/auth.routes.js` · `router.post('/login', authLimiter, validate(schema.login), controller.login);`

- **بقیه‌ی ماژول‌ها با `router.use(authenticate, requirePasswordChanged, …)` در بالای فایل بسته شده‌اند** · `verified`
  `backend/src/modules/catalog/catalog.routes.js` · `router.use(authenticate, requirePasswordChanged);`

- **`/havales` و `/sub-agents` فقط برای نقش AGENT** (`public-authed`، محدود به نمایندگی) · `verified`
  `backend/src/modules/havale/havale.routes.js` · `router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT), attachAccess);`

- **`/admin/*` سه لایه دارد: ادمین بودن، سپس permission مخصوص هر بخش** (`admin`) · `verified`
  `backend/src/modules/admin/admin.routes.js` · `router.use(authenticate, requirePasswordChanged, requireAdmin);` و در هر مسیر `requirePermission('agents')`

- **استثنا — `/admin/staff` فقط مالک: کل زیرروتر با `requirePermission('staff')` بسته است و `staff` تنها به OWNER داده شده** · `verified`
  `backend/src/modules/admin/staff.routes.js` · `router.use(requirePermission('staff'));`

- **استثنا — Swagger روی `/docs` و `/docs.json` هیچ authentication ندارد، ولی nginx فقط `/api/` را proxy می‌کند** · `verified`
  `backend/src/docs/swagger.js` · `app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));`
  در `deploy/nginx/app.conf` مسیر `/` به `try_files … /index.html` می‌رود، پس از اینترنت به SPA می‌رسد نه به Swagger. از داخل شبکه‌ی داکر باز است.

- **پنل دیتابیس (Adminer) روی پورت `8443` پشت HTTP Basic و rate limit** (`admin`) · `verified`
  `deploy/nginx/adminer.conf` · `auth_basic_user_file /etc/nginx/conf.d/.htpasswd;`

### B2 — ذخیره‌سازی داده

- **یک PostgreSQL، تمام دسترسی از راه Prisma ORM؛ ۱۹ مدل و ۱۴ enum** · `verified`
  `backend/prisma/schema.prisma` · `provider = "postgresql"`

- **استثنا — تنها raw query کل پروژه، health check است** · `verified`
  `backend/src/routes/health.routes.js` · `await prisma.$queryRaw`SELECT 1`;`
  یعنی سطح حمله‌ی SQL injection عملاً به همین یک خط ثابت محدود است.

- **۹ migration در تاریخچه، آخری per-user permissions** · `verified`
  `backend/prisma/migrations/20260806145018_per_user_permissions/migration.sql`

### B3 — سرویس‌های بیرونی

- **پیامک از راه Kavenegar، با معماری driver؛ تا وقتی کلید تنظیم نشود غیرفعال است** · `verified`
  `backend/src/modules/sms/drivers/kavenegar.driver.js` · `https://api.kavenegar.com/v1/${config.sms.apiKey}/sms/send.json`
  کلید خاموش پیش‌فرض است: `enabled: process.env.SMS_ENABLED === 'true'` در `backend/src/config/index.js`.

- **هشدارها به Telegram Bot API، عمداً fire-and-forget** · `verified`
  `backend/src/modules/alert/telegram.js` · `hostname: 'api.telegram.org'`
  نبودن token یعنی خاموش، و برنامه هرگز به آن وابسته نیست: `An alerting channel that can throw, block, or fail a request is a second outage waiting to happen`.

- **Let's Encrypt برای گواهی، از راه سرویس `certbot` با `network_mode: host`** · `verified`
  `docker-compose.yml` · `profiles: ['certs']`

- **هیچ CDN یا فونت بیرونی: Vazirmatn از همان origin سرو می‌شود** · `verified`
  `frontend/index.html` · `<link rel="preload" href="/assets/vazirmatn.woff2"`

### B4 — داده‌های حساس

- **شماره‌ی تماس نمایندگی و مسئول هماهنگی، هسته‌ی ارزش سامانه‌اند و ستون‌های `phone` / `coordinatorPhone` برای رمزنگاری طراحی شده‌اند** · `verified`
  `backend/prisma/schema.prisma` · `/// رمزنگاری‌شده در پایگاه داده (AES-256-GCM)`
  جست‌وجو روی `phoneIndex` انجام می‌شود که HMAC کلیددار همان شماره است.

- **استثنای مهم — رمزنگاری به‌صورت پیش‌فرض خاموش است و بدون `DATA_ENCRYPTION_KEY` مقادیر دست‌نخورده ذخیره می‌شوند** · `verified`
  `backend/src/utils/crypto.js` · `const ENABLED = Boolean(process.env.DATA_ENCRYPTION_KEY);`
  خود فایل می‌گوید عمدی است: `Encryption at rest was added and then switched off again at the owner's request`. اینکه در production کلید ست شده یا نه، از مخزن قابل تشخیص نیست.

- **رمز عبور با bcrypt، توکن نشست فقط به‌صورت hash در دیتابیس** · `verified`
  `backend/prisma/schema.prisma` · `model AuthSession { id String @id @default(cuid()) tokenHash String @unique`

- **`ContactReveal` عمداً اسنپ‌شات شماره و کد نمایش‌داده‌شده را نگه می‌دارد** · `verified`
  `backend/prisma/schema.prisma` · `phoneShown String?`
  یعنی حتی با رمزنگاری روشن، این جدول یک نسخه‌ی دوم از داده‌های تماس است.

- **`ActivityLog` و `ErrorLog` شامل IP، مسیر، stack trace و شناسه‌ی کاربر** · `verified`
  `backend/prisma/schema.prisma` · `model ErrorLog {` با `stack String?`

- **مرز خروجی داده در DTO ساخته شده، نه در هر handler** · `verified`
  `backend/src/modules/user/user.dto.js` · `function toMaskedAgency(user)` که فقط `{ id, agencyName, contactHidden: true }` برمی‌گرداند.

## C. چه کسی چه کاری می‌تواند بکند

### C1 — احراز هویت

- **نشست سمت سرور با کوکی، نه JWT — تا بتوان آن را پس گرفت** · `verified`
  `backend/src/config/index.js` · `A self-contained JWT cannot be taken back once issued.`
  عمر پیش‌فرض ۱۲ ساعت (`SESSION_TTL_HOURS`).

- **کوکی `httpOnly` + `sameSite: 'strict'`، و `secure` از روی خودِ اتصال خوانده می‌شود نه از `NODE_ENV`** · `verified`
  `backend/src/modules/auth/auth.controller.js` · `const secure = Boolean(req.secure);`

- **هر نماینده فقط یک نشست زنده دارد؛ ادمین‌ها عمداً مستثنا هستند** · `verified`
  `backend/src/modules/auth/auth.service.js` · `if (user.role === ROLES.AGENT) { await authRepository.revokeOtherSessions(...`

- **دفاع دولایه در برابر حدس رمز: قفل ۵ خطا در ۱۵ دقیقه در service، و rate limit جداگانه‌ی ورود روی کلید `ip|username`** · `verified`
  `backend/src/middlewares/rateLimiter.js` · `keyGenerator: (req) => `${req.ip}|${String(req.body?.username || '').toLowerCase().slice(0, 40)}``

- **تغییر اجباری رمز در اولین ورود، به‌صورت middleware و نه توصیه** · `verified`
  `backend/src/middlewares/auth.js` · `function requirePasswordChanged(req, _res, next)`

- **دو عاملی پیامکی طراحی شده ولی وصل نیست: مدل `OtpChallenge` در schema هست و در هیچ کجای `src/` استفاده نمی‌شود** · `verified`
  `backend/prisma/schema.prisma` · `model OtpChallenge {`
  جست‌وجوی `otpChallenge` در `backend/src/` و `backend/scripts/` هیچ نتیجه‌ای ندارد؛ فقط یک قالب پیامک به نام `OTP` در `backend/src/modules/sms/sms.templates.js` باقی مانده.

### C2 — نقش‌ها و مجوزدهی

- **شش نقش: `OWNER`, `DEVELOPER`, `SUPER_ADMIN`, `SUPPORT`, `FINANCE`, `AGENT`** · `verified`
  `backend/src/constants/roles.js` · `const ROLES = {`

- **سیاست دسترسی به‌صورت داده در یک جدول متمرکز، با ۱۵ کلید permission** · `verified`
  `backend/src/constants/roles.js` · `const PERMISSIONS = {`

- **مجوز از کاربر پرسیده می‌شود نه از نقش: `permissions Json?` روی هر حساب می‌تواند پیش‌فرض نقش را بازنویسی کند** · `verified`
  `backend/src/constants/roles.js` · `function userCan(user, permission)` که اول `overrides` را می‌بیند.

- **`DEVELOPER` عمداً هیچ دسترسی‌ای ندارد — می‌تواند وارد شود و هیچ کاری نکند** · `verified`
  `backend/src/constants/roles.js` · `DEVELOPER: {},`

- **`OWNER` و `DEVELOPER` نقش‌های «نامرئی»‌اند و پنهان‌سازی در لایه‌ی داده اعمال می‌شود، نه صفحه‌به‌صفحه** · `verified`
  `backend/src/modules/auth/auth.repository.js` · `if (userId && (await isHiddenActor(userId))) {`
  استثنای عمدی: ردیف `LOGIN_FAILED` همچنان نوشته می‌شود (بدون actor) تا قفل ضدحدس برای همین حساب‌ها هم کار کند.

- **`staff` تنها permission‌ای است که هیچ نقشی جز OWNER ندارد، و `assignableRoles` هم صدور نقش OWNER را ممکن نمی‌کند** · `verified`
  `backend/src/constants/roles.js` · `function assignableRoles(actorRole) { if (actorRole !== ROLES.OWNER) return [];`

- **اشتراک یک محور مجوزدهی مستقل از نقش است: خواندن باز است، ولی ثبت/ویرایش/تمدید/نمایش تماس اشتراک فعال می‌خواهد** · `verified`
  `backend/src/middlewares/access.js` · `function requireActiveSubscription(req, _res, next)`

- **قواعد «مالکیت» (چه کسی صاحب کدام رکورد است) در سطح service اعمال می‌شود و از روی routeها قابل خواندن نیست** · `inferred`
  `backend/src/modules/admin/staff.service.js` · `Every function here takes the acting user rather than trusting the route`
  برای تأیید کامل باید تک‌تک serviceها خوانده شود؛ در این نقشه فقط الگو ثبت شده است.

### C3 — مرزهای اعتماد

- **مرز اصلی: nginx تنها چیزی است که از اینترنت دیده می‌شود؛ API و دیتابیس و Adminer فقط داخل شبکه‌ی `appnet`اند** · `verified`
  `docker-compose.yml` · `# No published port: the API is reachable through nginx and from nowhere else.`

- **مرز دوم و گران‌ترین: سریال‌سازی حواله. اطلاعات تماس فقط بعد از ثبت reveal به پاسخ اضافه می‌شود** · `verified`
  `backend/src/modules/havale/havale.dto.js` · `There is deliberately no "include everything" branch to reach for by accident.`

- **frontend عمداً هیچ تصمیم امنیتی نمی‌گیرد؛ فقط دکمه‌ها را پنهان می‌کند** · `verified`
  `frontend/README.md` · `Nothing here decides what a user is allowed to do.`

- **ورودی کاربر در frontend به‌صورت پیش‌فرض escape می‌شود و رفتار از راه `data-` وصل می‌شود، نه `onclick`** · `verified`
  `frontend/README.md` · `**1. `ui/html.js` escapes by default.**`

- **`trust proxy` روشن است، پس IP و `req.secure` از هدرهای proxy خوانده می‌شوند** · `verified`
  `backend/src/app.js` · `app.set('trust proxy', 1);`

## D. چه چیزی بیرون از دید است

### D1 — محیط و کنترل‌های بیرونی

- **هدرهای امنیتی سطح nginx: CSP بدون `unsafe-inline` برای script، `X-Frame-Options: DENY`، `nosniff`, `Referrer-Policy`** · `verified`
  `deploy/nginx/app.conf` · `add_header Content-Security-Policy "default-src 'self'; script-src 'self';`

- **در حالت پیش‌فرض مخزن، سامانه روی HTTP بالا می‌آید و redirect به HTTPS خاموش است** · `verified`
  `deploy/nginx/00-mode.conf` · `map $host $force_https { default 0; }`
  بلوک‌های `listen 443 ssl` در `app.conf` نیستند؛ آن‌ها را `deploy/enable-ssl.sh` تولید می‌کند. اینکه روی سرور واقعی اجرا شده یا نه از مخزن معلوم نیست.

- **rate limiting در دو جا: اپلیکیشن (سراسری + ورود) و nginx (فقط پنل دیتابیس)** · `verified`
  `deploy/nginx/adminer.conf` · `limit_req_zone $binary_remote_addr zone=dbpanel:1m rate=10r/m;`
  محدودکننده‌ی اپلیکیشن یک کف سخت ۶۰۰ دارد که مقدار `.env` را بازنویسی می‌کند: `max: Math.max(Number(config.security.rateLimit.max) || 0, 600)`.

- **مهاجرت‌های دیتابیس هنگام بالا آمدن کانتینر اجرا می‌شوند** · `verified`
  `backend/docker/entrypoint.sh` · `npx prisma migrate deploy`
  seed اختیاری با `SEED_ON_START` و `SEED_DEMO` کنترل می‌شود.

- **کنترل‌های عملیاتی خارج از اپلیکیشن: watchdog، backup، verify-backup، preflight با ۱۴ بررسی** · `verified`
  `deploy/preflight.d/30-secrets.sh`, `deploy/watchdog.sh`, `deploy/verify-backup.sh`

- **WAF، CDN، فایروال میزبان و محدودسازی دسترسی به پورت `8443`** · `unknown`
  در `deploy/nginx/`, `docker-compose.yml` و `docs/deployment.md` دنبالش گشتم؛ چیزی جز nginx و Basic Auth پیدا نشد. ممکن است در سطح ارائه‌دهنده‌ی سرور وجود داشته باشد که بیرون از این مخزن است.

- **مقادیر واقعی `.env` روی production — از جمله اینکه `DATA_ENCRYPTION_KEY`, `CORS_ORIGINS` و `SESSION_SECRET` چه هستند** · `unknown`
  فقط `.env.example` و `backend/.env.example` در مخزن‌اند و `.env` در `.gitignore`. پیش‌فرض کد برای CORS `'*'` است (`backend/src/config/index.js` · `corsOrigins: (process.env.CORS_ORIGINS || '*')`), ولی مقدار مؤثر از محیط می‌آید.

### D2 — پوشش و محدودیت‌ها

**چه چیزی خوانده شد:** کل درخت `backend/src/` در سطح ساختار، و به‌صورت کامل: `app.js`, `config/index.js`, `constants/roles.js`, هر سه middleware مربوط به دسترسی، `auth.service.js`, `utils/crypto.js`, `user.dto.js`, `prisma/schema.prisma`, تمام فایل‌های `*.routes.js` (برای شمارش endpoint و استخراج guardها)، `docker-compose.yml`, هر سه فایل nginx، و `frontend/` در سطح entry point و README.

**چه چیزی خوانده نشد:**

- بدنه‌ی اکثر `*.service.js` و `*.repository.js` — یعنی قواعد دقیق مالکیت، محاسبه‌ی سقف reveal، و منطق اشتراک/ظرفیت در این نقشه فقط در سطح «کجاست» ثبت شده، نه «چه می‌کند».
- `frontend/src/pages/**` و `frontend/src/ui/**` به‌جز READMEها.
- `security/audit.js` و `security/pentest.js` (ابزار بازرسی؛ عمداً کنار گذاشته شد، چون این نقشه Security Review نیست).
- `mockup/` (نمونه‌ی استاتیک، خارج از سامانه‌ی زنده) و `deploy/preflight.d/*` به‌صورت تک‌به‌تک.
- `docs/blueprint.pdf` و `docs/tech-plan.pdf` — قابل استناد به‌عنوان کد نیستند و در این نقشه فقط جایی که کد به آن‌ها ارجاع می‌دهد ذکر شده‌اند.

**آنچه با خواندن کد اصولاً قابل تعیین نیست:** پیکربندی واقعی production، اینکه آیا `enable-ssl.sh` روی سرور اجرا شده، اینکه رمزنگاری داده روشن است یا نه، و اینکه کدام نقطه‌ی ورود واقعاً از اینترنت قابل دسترسی است.

**تناقض کد و مستندات:** `README.md` ریشه پروژه را «Backend and frontend for havale» و خروجی استاندارد scaffold معرفی می‌کند، در حالی که کد یک سامانه‌ی کامل با شش نقش، پنل مدیریت و زیرساخت استقرار است. مستندات ریشه عقب‌تر از کد است.
