---
repo: Havale-khodro
repo_version: b581cf3779344cbef3a6f6fd9645122f10e8419d
generated_at: 2026-08-16
---

# Project Map — Havale-khodro

## A. پروژه چیست

### A1 — هویت و هدف

- **بازارگاه B2B «حواله خودرو» برای نمایندگی‌ها: ثبت آگهی فروش/درخواست خرید حواله، و «نمایش مشخصات تماس» به‌عنوان کالای اصلی که با اشتراک و سقف روزانه/دوره‌ای فروخته می‌شود** · `verified`
  `backend/src/modules/havale/havale.dto.js` · `if (revealed && havale.owner)` — شماره فقط پس از ثبت reveal سریالایز می‌شود
  `backend/src/modules/havale/havale.service.js` · `if (usage.dailyUsed >= usage.dailyLimit)`
- **ثبت‌نام عمومی وجود ندارد؛ هر حساب نمایندگی را ادمین می‌سازد** · `verified`
  `backend/src/modules/auth/auth.service.js` · `so there is deliberately no \`register\` here`
  `backend/src/modules/admin/admin.routes.js` · `POST /admin/agents` با `requirePermission('agents')`
- **نام تجاری در رابط کاربری «فرانوکار / FeranoCar» است، در حالی که نام مخزن و پکیج `havale` است** · `verified`
  `frontend/index.html` · `<title>فرانوکار</title>` · `.env.example` · `BRAND_DOMAIN=feranocar.com`

### A2 — پشته و فریم‌ورک‌ها

- **Backend: Node ≥20 · Express 4.22.2 · Prisma 5.22.0 (client + CLI) · PostgreSQL 16 · Joi 17.13.4 · bcryptjs 2.4.3 · helmet 7.2.0 · express-rate-limit 7.5.1 · winston · CommonJS، بدون TypeScript** · `verified`
  `backend/package.json` · `"engines": { "node": ">=20" }` · نسخه‌های قفل‌شده از `backend/package-lock.json`
- **حفاظت‌های پیش‌فرض فریم‌ورک که واقعاً روشن‌اند: `helmet()`، CORS با allowlist از env، سقف حجم بدنه، rate limit سراسری، اعتبارسنجی Joi روی هر مسیر، و یک error handler که خطای ناشناخته را ۵۰۰ عمومی می‌کند** · `verified`
  `backend/src/app.js` · `app.use(helmet());` … `app.use(rateLimiter);`
  `backend/src/middlewares/errorHandler.js` · `stack traces tell an attacker about your internals`
- **Frontend: جاوااسکریپت خالص با ES Modules، بدون بیلد، بدون فریم‌ورک و بدون هیچ dependency؛ nginx فقط فایل استاتیک می‌دهد** · `verified`
  `frontend/README.md` · `Plain ES modules. Serve \`index.html\` from any static server`
  `frontend/index.html` · `<script type="module" src="/src/main.js"></script>`
  توجه: `frontend/` هیچ `package.json` ندارد؛ پس نسخه‌ای برای گزارش کردن وجود ندارد.
- **مستندات و کد در انتخاب پشته اختلاف دارند: سند طراحی «Next.js + TypeScript» را تصمیم نهایی ردیف ۱ اعلام می‌کند، اما پیاده‌سازی Express + JS خالص است** · `verified` (برای کد) / `unverified` (برای ادعای سند)
  `docs/blueprint.md` · `| ۱ | تکنولوژی | Next.js + TypeScript + PostgreSQL + Prisma |`
  `backend/package.json` · `"express": "^4.19.2"`

### A3 — ساختار و اجزا

- **چهار واحد قابل استقرار در یک `docker-compose.yml`: nginx (تنها چیزی که پورت ۸۰/۴۴۳/۸۴۴۳ را منتشر می‌کند)، api، postgres، و Adminer** · `verified`
  `docker-compose.yml` · `# No published port: the API is reachable through nginx and from nowhere` · `expose: - '3000'`
- **بک‌اند ماژولی است: هر feature یک پوشه با `*.routes / *.service / *.repository`؛ لایه‌بندی در همه‌ی ماژول‌ها یکسان رعایت شده** · `verified`
  `backend/src/modules/` · مثلاً `havale.routes.js` → `havale.service.js` → `havale.repository.js`
- **بخش بزرگی از درخت پوشه‌ها داربستِ خالی است — پوشه‌هایی که فقط `README.md` دارند (`src/queues`, `src/jobs`, `src/sockets`, `src/events`, `src/cache`, و اکثر پوشه‌های `frontend/src`)** · `verified`
  `backend/src/queues/README.md` · پوشه بدون هیچ فایل کد
  اهمیتش این است که «صف»، «job زمان‌بندی‌شده» و «websocket» در این سیستم وجود ندارند، نه اینکه جایی دیگر باشند.
- **`mockup/` یک نمونه‌ی اولیه‌ی استاتیک و جداست و در استقرار سرو نمی‌شود؛ nginx فقط `frontend/` را mount می‌کند** · `verified`
  `docker-compose.yml` · `- ./frontend:/usr/share/nginx/html:ro`
- **بخش‌های «خودرو»، «ثبت‌نامی» و «قطعات» در منوی نماینده وجود دارند اما ساخته نشده‌اند — صفحه‌ی ثابت «به‌زودی» و هیچ endpointای پشتشان نیست** · `verified`
  `frontend/src/ui/shell.js` · `soon: true,` · `frontend/src/pages/agent/soon.js` · `Static by design — no route loader, no request.`
- **ماژول‌های بک‌اندی که رابط کاربری ندارند اما فعال و mount شده‌اند: `errors` (لاگ خطا) و `sms`** · `verified`
  `backend/src/modules/alert/alert.routes.js` · `Nothing in the agency or admin panels calls this`
- **`security/audit.js` و `security/pentest.js` ابزار داخلی بازرسی‌اند و هیچ‌کدام بخشی از سرویس در حال اجرا نیستند** · `verified`
  `backend/package.json` · `"audit:security": "node ../security/audit.js"` — فقط از طریق npm script اجرا می‌شود
- **`deploy/` مجموعه‌ی اسکریپت‌های عملیاتی است: preflight، بکاپ، watchdog، صدور TLS و به‌روزرسانی** · `verified`
  `deploy/preflight.sh` · `deploy/backup.sh` · `deploy/watchdog.sh`
- **هیچ CI/CD در مخزن نیست** · `verified`
  دایرکتوری `.github` وجود ندارد؛ تست‌ها فقط با `npm test` دستی اجرا می‌شوند (`backend/package.json` · `"test": "jest --runInBand"`).

## B. چه چیزی وارد و خارج می‌شود

### B1 — نقاط ورود

- **۷۹ مسیر HTTP زیر `/api/v1` تعریف شده است** · `verified`
  شمارش `router.get|post|put|patch|delete(` در `backend/src/modules` و `backend/src/routes`
- **`GET /api/v1/health` — `public-anonymous`؛ تنها مسیر API که هیچ میان‌افزار احراز هویتی ندارد و nginx هم آن را جداگانه و بدون ریدایرکت HTTPS منتشر می‌کند** · `verified`
  `backend/src/routes/index.js` · `router.use('/health', healthRoutes);` (بدون `authenticate`)
  `deploy/nginx/app.conf` · `location = /api/v1/health {`
- **`POST /api/v1/auth/login` — `public-anonymous`، پشت `authLimiter` (۱۰ تلاش ناموفق در ۱۵ دقیقه، کلید = IP + username)** · `verified`
  `backend/src/modules/auth/auth.routes.js` · `router.post('/login', authLimiter, validate(schema.login), controller.login);`
- **استثنا: `POST /api/v1/auth/logout` تنها مسیر غیر-health است که `authenticate` ندارد؛ توکن را مستقیم از کوکی می‌خواند** · `verified`
  `backend/src/modules/auth/auth.routes.js` · `router.post('/logout', controller.logout);`
- **کل `/havales` (۱۱ مسیر) و کل `/sub-agents` (۴ مسیر) — `public-authed`، محدود به نقش AGENT، با گارد یک‌جا در بالای روتر** · `verified`
  `backend/src/modules/havale/havale.routes.js` · `router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT), attachAccess);`
- **کل `/admin/*` (شامل `/admin/catalog` و `/admin/staff`) — `admin`: احراز هویت + نقش ادمین در روتر والد، و سپس یک `requirePermission(...)` نام‌دار روی تک‌تک مسیرها** · `verified`
  `backend/src/modules/admin/admin.routes.js` · `router.use(authenticate, requirePasswordChanged, requireAdmin);`
- **`/settings`، `/sms` و `/errors` — `admin`، همگی پشت `requirePermission('settings')`** · `verified`
  `backend/src/modules/settings/settings.routes.js` · `router.use(authenticate, requirePasswordChanged, requirePermission('settings'));`
- **`/tickets`، `/reports` و `/subscriptions` مسیرهای مختلط دارند: بخشی نماینده‌ای و بخشی مدیریتی، در همان روتر و با گارد جداگانه روی هر مسیر** · `verified`
  `backend/src/modules/report/report.routes.js` · `requireRole(ROLES.AGENT)` در کنار `requirePermission('reports')`
- **استثنا: `GET /subscriptions/plans` تنها مسیر subscription است که نه `agentOnly` دارد نه permission — هر کاربر واردشده‌ای می‌بیندش** · `verified`
  `backend/src/modules/subscription/subscription.routes.js` · `router.get(\n  '/plans',` بدون گارد میانی
- **`/docs` و `/docs.json` (Swagger UI) بدون هیچ احراز هویتی روی اپلیکیشن mount می‌شوند، اما در استقرار compose از بیرون قابل دسترسی نیستند چون nginx فقط `/api/`، `/assets/`، `/src/` و `/` را proxy/سرو می‌کند و پورت ۳۰۰۰ منتشر نشده است** · `inferred`
  `backend/src/docs/swagger.js` · `app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));`
  `deploy/nginx/app.conf` · `location /api/ {` — هیچ location برای `/docs` وجود ندارد
  استنتاج است چون به پیکربندی واقعی سرور و اینکه پورت ۳۰۰۰ در فایروال میزبان بسته باشد وابسته است.
- **Adminer روی پورت ۸۴۴۳ منتشر می‌شود، پشت HTTP Basic و rate limit نginx؛ محدودسازی IP نوشته اما کامنت شده است** · `verified`
  `deploy/nginx/adminer.conf` · `auth_basic "Database";` · `# allow 5.112.0.0/16;`

### B2 — ذخیره‌سازی داده

- **تنها ذخیره‌گاه، PostgreSQL 16 است و همه‌ی دسترسی‌ها از Prisma می‌گذرد؛ تنها کوئری خام کل پروژه `SELECT 1` در health check است** · `verified`
  `backend/prisma/schema.prisma` · `provider = "postgresql"`
  `backend/src/routes/health.routes.js` · `await prisma.$queryRaw\`SELECT 1\`;` — تنها نتیجه‌ی جست‌وجوی `queryRaw|executeRaw` در کل `backend/`
- **۱۹ مدل، با هسته‌ی User / Havale / ContactReveal / Subscription / AuthSession و کاتالوگ خودرو (CarCompany → CarBrand → CarModel → CarColor)** · `verified`
  `backend/prisma/schema.prisma` · `model ContactReveal {` … `model CarColor {`
- **رمزنگاری ستون‌های تماس در لایه‌ی Prisma middleware انجام می‌شود نه در سرویس‌ها؛ `phone` علاوه بر رمز، یک blind index (HMAC) برای جست‌وجو دارد** · `verified`
  `backend/src/config/database.js` · `const ENCRYPTED = { User: { fields: ['phone', 'coordinatorPhone'], indexed: { phone: 'phoneIndex' } },`
- **مهم: این رمزنگاری به‌صورت پیش‌فرض خاموش است — بدون `DATA_ENCRYPTION_KEY` مقادیر دست‌نخورده ذخیره می‌شوند و blind index همان مقدار خام است** · `verified`
  `backend/src/utils/crypto.js` · `const ENABLED = Boolean(process.env.DATA_ENCRYPTION_KEY);`
  `.env.example` · `DATA_ENCRYPTION_KEY=` (خالی)
- **مهاجرت‌ها هنگام بالا آمدن کانتینر به‌صورت خودکار اعمال می‌شوند، و در صورت `SEED_ON_START=true` اولین ادمین هم ساخته می‌شود** · `verified`
  `backend/docker/entrypoint.sh` · `npx prisma migrate deploy`

### B3 — سرویس‌های بیرونی

- **پیامک: درایور Kavenegar با فراخوانی HTTPS بیرونی، و درایور `log` که فقط می‌نویسد. پیش‌فرض `log` است و SMS به‌صورت پیش‌فرض خاموش** · `verified`
  `backend/src/modules/sms/drivers/kavenegar.driver.js` · `const url = \`https://api.kavenegar.com/v1/${config.sms.apiKey}/sms/send.json\`;`
  `backend/src/config/index.js` · `driver: process.env.SMS_DRIVER || 'log',`
- **هشدار تلگرام برای خطاها: fire-and-forget، بدون کتابخانه، و اگر token/chatId نباشد کاملاً غیرفعال** · `verified`
  `backend/src/modules/alert/telegram.js` · `hostname: 'api.telegram.org',`
- **`.env.example` یک کلید `ALERT_API_BASE=https://tapi.bale.ai` دارد که در کد بک‌اند خوانده نمی‌شود؛ `telegram.js` هاست را ثابت نوشته است** · `verified`
  `.env.example` · `ALERT_API_BASE=https://tapi.bale.ai` · `backend/src/config/index.js` هیچ ارجاعی به آن ندارد
  احتمالاً برای اسکریپت‌های `deploy/notify.sh` است؛ آن مسیر را دنبال نکردم.
- **صدور گواهی TLS از Let's Encrypt با certbot، به‌صورت یک سرویس compose با profile جدا** · `verified`
  `docker-compose.yml` · `profiles: ['certs']`
- **هیچ درگاه پرداختی وجود ندارد؛ پرداخت طبق طراحی دستی و با تأیید ادمین است** · `verified`
  `backend/src/modules/subscription/subscription.routes.js` · `POST /subscriptions/grant` با `requirePermission('subscriptions')`
- **فونت محلی سرو می‌شود و هیچ CDN یا اسکریپت شخص ثالثی در فرانت‌اند نیست** · `verified`
  `frontend/index.html` · `The font is served from this origin, not from a CDN.`

### B4 — داده‌های حساس

- **شماره‌ی موبایل نمایندگی و شماره‌ی «مسئول هماهنگی» — همان چیزی که محصول می‌فروشد. تنها نقطه‌ی مجاز سریالایز شدنشان یک فایل است** · `verified`
  `backend/src/modules/havale/havale.dto.js` · `card.contact = {` … `coordinatorPhone: havale.owner.coordinatorPhone,`
- **`ContactReveal.phoneShown` یک اسنپ‌شات از شماره در لحظه‌ی مشاهده نگه می‌دارد و خودش هم جزو ستون‌های رمزشونده است** · `verified`
  `backend/src/config/database.js` · `ContactReveal: { fields: ['phoneShown'], indexed: {} },`
- **رمز عبور فقط به‌صورت bcrypt hash ذخیره می‌شود؛ توکن نشست فقط به‌صورت SHA-256 hash** · `verified`
  `backend/prisma/schema.prisma` · `passwordHash String` · `tokenHash String @unique`
  `backend/README.md` · `only its SHA-256 hash is stored`
- **رمز اولیه‌ی حساب نمایندگی یک‌بار در پاسخِ ساخت حساب برگردانده می‌شود، آگاهانه** · `verified`
  `backend/src/modules/admin/admin.routes.js` · `return created(res, { ...agent, initialPassword: req.body.password }, MESSAGES.USER.CREATED);`
- **`ErrorLog` استک‌تریس و مسیر و شناسه‌ی کاربر را در پایگاه داده نگه می‌دارد؛ `SmsMessage` شماره‌ی مقصد و متن نهایی را ذخیره می‌کند و هیچ‌کدام رمز نمی‌شوند** · `verified`
  `backend/prisma/schema.prisma` · `stack String?` · `to String` (در `model SmsMessage`)
- **IP کاربران در سه جا ثبت می‌شود: نشست، ActivityLog و ContactReveal** · `verified`
  `backend/prisma/schema.prisma` · `ip String?` در `AuthSession`، `ActivityLog` و `ContactReveal`

## C. چه کسی چه کاری می‌تواند بکند

### C1 — احراز هویت

- **نشست سمت سرور (ردیف در جدول `AuthSession`)، نه JWT — تا بتوان آن را لغو کرد. کوکی `httpOnly` + `SameSite=strict` و توکن هرگز در بدنه‌ی پاسخ نمی‌آید** · `verified`
  `backend/src/modules/auth/auth.controller.js` · `httpOnly: true,` … `sameSite: 'strict',`
  `backend/src/config/index.js` · `ttlMs: Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000,`
- **فلگ `secure` کوکی از `req.secure` گرفته می‌شود نه از `NODE_ENV`؛ یعنی روی HTTP ساده کوکی بدون Secure صادر می‌شود و فقط یک‌بار در لاگ هشدار می‌دهد** · `verified`
  `backend/src/modules/auth/auth.controller.js` · `const secure = Boolean(req.secure);`
- **یک نشست فعال برای هر نماینده (ورود جدید بقیه را می‌بندد)، ولی حساب‌های ادمین از این قاعده مستثنا هستند** · `verified`
  `backend/src/modules/auth/auth.service.js` · `if (user.role === ROLES.AGENT) {` → `revokeOtherSessions`
- **قفل شدن پس از ۵ تلاش ناموفق در ۱۵ دقیقه، با مقایسه‌ی hash ساختگی برای یکسان‌ماندن زمان پاسخ** · `verified`
  `backend/src/modules/auth/auth.service.js` · `const LOCKOUT_THRESHOLD = 5;` · `const DUMMY_HASH =`
- **تغییر اجباری رمز در اولین ورود، به‌صورت میان‌افزار روی همه‌ی مسیرها اعمال می‌شود نه فقط در UI** · `verified`
  `backend/src/middlewares/auth.js` · `if (req.user && req.user.mustChangePassword)`
- **احراز هویت دومرحله‌ای پیاده نشده است: مدل `OtpChallenge` در schema هست ولی هیچ کدی در `backend/src` یا `backend/scripts` به آن ارجاع نمی‌دهد** · `verified`
  `backend/prisma/schema.prisma` · `model OtpChallenge {` — جست‌وجوی `OtpChallenge|otpChallenge` در کد هیچ نتیجه‌ای ندارد

### C2 — نقش‌ها و مجوزدهی

- **شش نقش: OWNER، DEVELOPER، SUPER_ADMIN، SUPPORT، FINANCE، AGENT** · `verified`
  `backend/src/constants/roles.js` · `const ROLES = {` … `AGENT: 'AGENT',`
- **مجوزدهی بر پایه‌ی ۱۵ کلید نام‌دار است، نه مقایسه‌ی رشته‌ی نقش؛ و بررسی روی «کاربر» انجام می‌شود تا override‌های per-account معنا داشته باشند** · `verified`
  `backend/src/constants/roles.js` · `function userCan(user, permission) {` · `if (permission in overrides) return Boolean(overrides[permission]);`
  `backend/prisma/schema.prisma` · `permissions Json?`
- **OWNER و DEVELOPER نقش‌های «پنهان»اند و پنهان‌سازی در لایه‌ی داده اعمال می‌شود، نه صفحه‌به‌صفحه** · `verified`
  `backend/src/constants/roles.js` · `const HIDDEN_ROLES = [ROLES.OWNER, ROLES.DEVELOPER];` · `Enforced at the data layer`
- **`staff`, `systemAlerts`, `errorLog` فقط مال OWNER است؛ SUPER_ADMIN صریحاً `staff: false` دارد تا نتواند خودش را ارتقا دهد** · `verified`
  `backend/src/constants/roles.js` · `SUPER_ADMIN: { … staff: false, systemAlerts: false, errorLog: false, }`
- **استثنا: نقش DEVELOPER عمداً هیچ مجوزی ندارد — می‌تواند وارد شود و هیچ کاری نکند** · `verified`
  `backend/src/constants/roles.js` · `DEVELOPER: {},`
- **OWNER در فهرست نقش‌های قابل واگذاری نیست، و این در خود schema اعتبارسنجی اعمال می‌شود نه در هندلر** · `verified`
  `backend/src/constants/roles.js` · `function assignableRoles(actorRole) {` · `backend/src/modules/admin/staff.routes.js` · `const roleValues = assignableRoles(ROLES.OWNER);`
- **قواعد مالکیت که در کد دیده می‌شوند: تیکت فقط برای صاحبش یا ادمین، زیرنمایندگی فقط یک سطح و فقط برای reseller با ظرفیت خریداری‌شده** · `verified`
  `backend/src/modules/ticket/ticket.service.js` · `if (!isAdmin(user.role) && ticket.userId !== user.id) throw new NotFoundError('تیکت');`
  `backend/src/modules/subagent/subagent.service.js` · `if (user.parentId) throw new ForbiddenError(MESSAGES.SEAT.ONE_LEVEL_ONLY);`
- **قواعد *مورد نظر* مالکیت و مجوزدهی به‌طور کامل قابل تأیید نیست** · `unknown`
  سند مرجع، جدول دسترسی بند ۱۱.۱۲ در `docs/blueprint.pdf` است که کد مکرراً به آن ارجاع می‌دهد؛ من فقط `docs/blueprint.md` را خواندم و PDF را باز نکردم. تطبیق کامل «کد در برابر جدول» نیاز به خواندن آن سند دارد.

### C3 — مرزهای اعتماد

- **مرز اصلی محصول: تابع `toHavaleCard` — پیش از آن داده‌ی کامل مالک آگهی است، پس از آن فقط چیزی که این بیننده حق دیدنش را دارد. اشتراک منقضی حتی چیزی را که قبلاً باز کرده دیگر نمی‌بیند** · `verified`
  `backend/src/modules/havale/havale.dto.js` · `if (!subscriptionActive) return card;`
- **مرز اشتراک: `attachAccess` وضعیت را روی request می‌گذارد و `requireActiveSubscription` مسیرهای «اقدام» را می‌بندد، در حالی که مسیرهای «مشاهده» باز می‌مانند** · `verified`
  `backend/src/middlewares/access.js` · `if (!req.access.active) {`
- **مرز اعتماد به پروکسی: اپ `trust proxy = 1` دارد، پس `req.ip` و `req.secure` مستقیماً از هدرهای nginx می‌آیند — هم rate limit و هم فلگ Secure کوکی به درستی این پیکربندی وابسته‌اند** · `verified`
  `backend/src/app.js` · `app.set('trust proxy', 1);`
- **مرز ورودی: هر مسیر ورودی خود را با Joi اعتبارسنجی می‌کند و در `/settings` و `/admin/staff` حتی کلیدهای مجاز هم whitelist شده‌اند** · `verified`
  `backend/src/modules/settings/settings.routes.js` · `.valid(...Object.keys(settingsService.SETTINGS))`
  `backend/src/modules/admin/staff.routes.js` · `).unknown(false);`
- **مرز خروجی به مرورگر: فرانت‌اند هیچ توکنی در localStorage نگه نمی‌دارد و همه‌ی درخواست‌ها فقط با کوکی می‌روند** · `verified`
  `frontend/src/api/client.js` · `credentials: 'include',` · `there is no token in localStorage`
- **مرز داده در برابر دامپ پایگاه داده (رمزنگاری at-rest) در حالت پیش‌فرض وجود ندارد — به تنظیم `DATA_ENCRYPTION_KEY` در محیط واقعی وابسته است** · `verified` (برای کد) / `unknown` (برای محیط واقعی)
  `backend/src/utils/crypto.js` · `const ENABLED = Boolean(process.env.DATA_ENCRYPTION_KEY);`

## D. چه چیزی بیرون از دید است

### D1 — محیط و کنترل‌های بیرونی

- **nginx در مخزن پیکربندی شده و این‌ها را بر عهده دارد: TLS، ریدایرکت HTTPS، هدرهای امنیتی شامل CSP سخت‌گیرانه، سرو استاتیک، و proxy فقط برای `/api/`** · `verified`
  `deploy/nginx/app.conf` · `add_header Content-Security-Policy "default-src 'self'; script-src 'self'; …frame-ancestors 'none'…" always;`
- **rate limit در دو لایه: nginx فقط برای پنل دیتابیس، و express-rate-limit برای API با کف اجباری ۶۰۰ درخواست در پنجره** · `verified`
  `backend/src/middlewares/rateLimiter.js` · `max: Math.max(Number(config.security.rateLimit.max) || 0, 600),`
  `deploy/nginx/adminer.conf` · `limit_req_zone $binary_remote_addr zone=dbpanel:1m rate=10r/m;`
  خود فایل می‌گوید دفاع در برابر سیل ترافیک را به لایه‌ی بالاتر واگذار کرده: `Flood defence belongs to nginx and the CDN in front of it`.
- **وجود WAF، CDN، فایروال میزبان یا service mesh** · `unknown`
  در `deploy/`، `docker-compose.yml` و پیکربندی nginx چیزی ندیدم. `deploy/preflight.d/` بررسی‌هایی برای host و شبکه دارد که نخواندمشان؛ نبودِ شواهد در مخزن به معنای نبودِ این کنترل‌ها روی سرور نیست.
- **مقادیر واقعی محیط production (کلید رمزنگاری، مبدأهای CORS، اینکه TLS واقعاً فعال است یا نه، رمز POSTGRES، محدودسازی IP برای Adminer)** · `unknown`
  فقط `.env.example` در مخزن است؛ `.env` واقعی طبق `.gitignore` کامیت نمی‌شود. `CORS_ORIGINS` در نبود مقدار به `*` می‌افتد (`backend/src/config/index.js` · `(process.env.CORS_ORIGINS || '*')`) و اینکه در سرور واقعی چه چیزی ست شده قابل تأیید نیست.
- **در دسترس بودن واقعی نقاط ورود از اینترنت** · `unknown`
  توپولوژی compose نشان می‌دهد فقط nginx پورت منتشر می‌کند، اما فایروال میزبان و اینکه پورت ۸۴۴۳ (Adminer) از بیرون باز است یا نه از روی کد قابل تعیین نیست.

### D2 — پوشش و محدودیت‌ها

- **چه چیزی را کامل خواندم:** ساختار کل مخزن؛ همه‌ی فایل‌های `*.routes.js` بک‌اند؛ میان‌افزارهای auth/access/rateLimiter/errorHandler؛ `app.js`, `server.js`, `config/index.js`, `config/database.js`, `utils/crypto.js`, `constants/roles.js`, `havale.dto.js`؛ کل `prisma/schema.prisma`؛ `docker-compose.yml`؛ `backend/docker/entrypoint.sh`؛ `.env.example`؛ فایل‌های هسته‌ی فرانت‌اند (`index.html`, `api/client.js`, `session.js`, `router.js`, `main.js`, `ui/shell.js`).
- **چه چیزی را فقط جزئی دیدم:** لایه‌ی سرویس و repository اکثر ماژول‌ها (`havale.service.js` ~۴۰۰ خط، `subscription.service.js`، `report.service.js`، `staff.service.js`، `monitoring.service.js`) — فقط با grep هدفمند برای قواعد دسترسی و مالکیت. منطق کسب‌وکار درون این‌ها (محاسبه‌ی دقیق سقف‌ها، انقضای آگهی، چرخه‌ی strike/تعلیق) نگاشت نشده است.
- **چه چیزی را اصلاً نخواندم و چرا:** صفحات فرانت‌اند (~۳۱۰۰ خط در `pages/`) — چون قواعد واقعی سمت سرور اعمال می‌شوند و UI فقط بازتاب آن است؛ `mockup/` — نمونه‌ی اولیه‌ی مرده؛ `security/audit.js` و `security/pentest.js` — ابزار جانبی؛ اسکریپت‌های `deploy/preflight.d/*` و `backup/watchdog`؛ فایل‌های تست (~۳۱۰۰ خط) که فقط تعدادشان را شمردم؛ `docs/blueprint.pdf` و بقیه‌ی PDF/HTMLهای سند.
- **بزرگ‌ترین شکاف نقشه:** جدول دسترسی بند ۱۱.۱۲ که کد بارها به آن ارجاع می‌دهد، در `docs/blueprint.pdf` است و خوانده نشده؛ بنابراین نمی‌توانم بگویم مجوزدهیِ پیاده‌شده با مجوزدهیِ *مورد نظر* یکی است — فقط می‌توانم بگویم چه چیزی پیاده شده.
- **این نقشه فقط از روی متن کد ساخته شده است؛ هیچ چیزی اجرا، تست یا در محیط واقعی بررسی نشده.** · `verified`
