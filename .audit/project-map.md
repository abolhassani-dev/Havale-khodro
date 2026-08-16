---
repo: Havale-khodro
repo_version: b581cf3779344cbef3a6f6fd9645122f10e8419d
generated_at: 2026-08-16
---

# Project Map — Havale-khodro (FeranoCar)

## A. پروژه چیست

### A1 — هویت و هدف

- **سامانه‌ی B2B «حواله خودرو»: بازارگاهی که نمایندگی‌های خودرو در آن آگهی عرضه/درخواست حواله ثبت می‌کنند و با مصرف سهمیه، مشخصات تماس طرف مقابل را می‌بینند. دو پنل دارد: نمایندگی و مدیریت** · `verified`
  `backend/prisma/schema.prisma` · `// سامانه حواله خودرو — فاز ۱` / `// دو پنل: نمایندگی‌ها و مدیریت (ادمین)`
- **ثبت‌نام عمومی وجود ندارد؛ حساب‌ها را ادمین در ازای اشتراک می‌سازد** · `verified`
  `backend/src/modules/auth/auth.service.js` · `There is no public registration in this system`
- **برند مستقر: FeranoCar روی دامنه‌ی feranocar.com و یک IP مشخص** · `verified`
  `.env.example` · `BRAND_DOMAIN=feranocar.com` و `deploy/nginx/app.conf` · `server_name feranocar.com www.feranocar.com 45.94.213.252 localhost;`

### A2 — پشته و فریم‌ورک‌ها

- **Backend: Node.js ≥20 / Express 4.19 (CommonJS)، اعتبارسنجی با Joi 17، لاگ با winston، تست با Jest + supertest** · `verified`
  `backend/package.json` · `"express": "^4.19.2"` / `"engines": { "node": ">=20" }`
- **ORM: Prisma 5.19 روی PostgreSQL 16 (کانتینر postgres:16-alpine)** · `verified`
  `backend/package.json` · `"@prisma/client": "^5.19.0"` و `docker-compose.yml` · `image: postgres:16-alpine`
- **حفاظت‌های پیش‌فرض فعال: helmet، CORS با origin مشخص + credentials، rate-limit سراسری، محدودیت حجم بدنه، کوکی امضاشده** · `verified`
  `backend/src/app.js` · `app.use(helmet());` … `app.use(rateLimiter);`
- **Frontend: جاوااسکریپت خام (ES modules) بدون فریم‌ورک، بدون build و بدون package.json؛ مستقیم به‌صورت فایل استاتیک از nginx سرو می‌شود** · `verified`
  `frontend/src/main.js` · `import { html, raw } from './ui/html.js';`
  فایل `frontend/package.json` وجود ندارد؛ escaping خروجی در `frontend/src/ui/html.js` انجام می‌شود.
- **استقرار: docker-compose با پنج سرویس — nginx 1.27، api (build از backend)، postgres، Adminer 4، certbot — با mem_limit و سقف لاگ برای همه** · `verified`
  `docker-compose.yml` · `image: nginx:1.27-alpine` / `image: adminer:4`

### A3 — ساختار و اجزا

- **backend ماژولار است: هر دامنه یک پوشه با الگوی routes → controller/service → repository؛ ماژول‌ها: auth, havale, catalog, subscription, subagent, report, ticket, sms, settings, admin, alert** · `verified`
  `backend/src/routes/index.js` · `router.use('/havales', havaleRoutes);`
- **frontend همان دو پنل را به‌صورت SPA دارد: `pages/agent/*` (dashboard, search, listings, account, profile) و `pages/admin/*`؛ یک API client مرکزی** · `verified`
  `frontend/src/api/client.js` · `The one place that talks to the API.`
- **اجزای غیرزنده: `mockup/` (پروتوتایپ استاتیک با اسکرین‌شات)، `docs/` (blueprint و مستندات)، `security/` (اسکریپت audit/pentest داخلی)، `.claude/skills/` (اسکفولد). هیچ‌کدام در مسیر اجرا نیستند** · `verified`
  `security/audit.js` · `Security audit.` — با `npm run audit:security` اجرا می‌شود، نه در runtime
- **اسکریپت‌های بهره‌برداری در `deploy/`: preflight (۱۵ چک ماژولار)، backup با سه رده نگهداری، watchdog کرانی، update.sh، enable-ssl.sh، alert-setup/notify** · `verified`
  `deploy/watchdog.sh` · `*/5 * * * * root /opt/feranocar/deploy/watchdog.sh`
- **اسکریپت‌های داده: seed اولیه، seed دمو (با گارد production)، ساخت حساب owner، تبدیل درجای داده‌ها به رمز (`encrypt-existing.js`)** · `verified`
  `backend/package.json` · `"create:owner": "node scripts/create-owner.js"`

## B. چه چیزی وارد و خارج می‌شود

### B1 — نقاط ورود

- **تنها درگاه بیرونی nginx است: پورت‌های 80/443 (سایت و API) و 8443 (پنل دیتابیس). سرویس api پورت publish نمی‌کند و فقط از داخل شبکه‌ی docker در دسترس است** · `verified`
  `docker-compose.yml` · `# No published port: the API is reachable through nginx and from nowhere else.`
- **nginx فقط `/api/` را به Node پراکسی می‌کند و بقیه را فایل استاتیک/SPA fallback جواب می‌دهد؛ درخواست با hostname ناشناس، connection close (444) می‌گیرد** · `verified`
  `deploy/nginx/app.conf` · `location /api/ {` / `return 444;`
- **public-anonymous — دو مسیر: `GET /api/v1/health` (شامل وضعیت دیتابیس) و `POST /api/v1/auth/login` (با rate-limit اختصاصی)** · `verified`
  `backend/src/modules/auth/auth.routes.js` · `router.post('/login', authLimiter, validate(schema.login), controller.login);`
- **public-authed (نقش AGENT) — حدود ۳۵ مسیر: آگهی‌ها (`/havales` شامل reveal مشخصات)، کاتالوگ خواندنی، اشتراک/صورتحساب/ظرفیت، زیرنمایندگی‌ها، گزارش تخلف، تیکت. همه پشت `authenticate` + `requirePasswordChanged`؛ عملیات نوشتنی و reveal پشت `requireActiveSubscription`** · `verified`
  `backend/src/modules/havale/havale.routes.js` · `router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT), attachAccess);`
- **admin — حدود ۴۰ مسیر زیر `/admin` (داشبورد، نمایندگی‌ها، اشتراک‌ها، seat orderها، مانیتورینگ، کاتالوگ، staff) به‌اضافه‌ی مسیرهای admin در report/ticket/settings/sms/errors؛ همه پشت `requireAdmin` یا `requirePermission(...)`** · `verified`
  `backend/src/modules/admin/admin.routes.js` · `router.use(authenticate, requirePasswordChanged, requireAdmin);`
- **Swagger UI (`/docs`, `/docs.json`) روی خود Express بدون احراز هویت mount می‌شود، اما چون nginx فقط `/api/` را پراکسی می‌کند و پورت api منتشر نیست، در استقرار فعلی از اینترنت قابل دسترس نیست — internal** · `inferred`
  `backend/src/docs/swagger.js` · `app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));`
  استنتاج به توپولوژی compose/nginx متکی است؛ اجرای backend خارج از این توپولوژی، docs را بی‌احراز هویت عمومی می‌کند.
- **پنل دیتابیس (Adminer) روی 8443: سه لایه — Basic Auth در nginx (فایل .htpasswd روی سرور)، لاگین خود Adminer با پسورد دیتابیس، و rate-limit ده درخواست در دقیقه** · `verified`
  `deploy/nginx/adminer.conf` · `auth_basic_user_file /etc/nginx/conf.d/.htpasswd;` / `rate=10r/m;`

### B2 — ذخیره‌سازی داده

- **یک PostgreSQL، تمام دسترسی از طریق Prisma (ORM)؛ تنها raw query مشاهده‌شده `SELECT 1` سلامت‌سنجی است** · `verified`
  `backend/src/routes/health.routes.js` · `await prisma.$queryRaw\`SELECT 1\`;`
- **۱۹ مدل: User, Plan, Subscription, Havale, ContactReveal, ViolationReport, Ticket(+Message), AuthSession, OtpChallenge, SeatOrder, ActivityLog, ErrorLog, Setting, SmsMessage و چهار جدول کاتالوگ خودرو** · `verified`
  `backend/prisma/schema.prisma` · `model User {`
- **رمزنگاری ستونی AES-256-GCM به‌صورت شفاف در لایه‌ی Prisma client اعمال می‌شود — فقط برای `User.phone` (با blind index HMAC در `phoneIndex`)، `User.coordinatorPhone` و `ContactReveal.phoneShown`** · `verified`
  `backend/src/config/database.js` · `const ENCRYPTED = {` / `User: { fields: ['phone', 'coordinatorPhone'], indexed: { phone: 'phoneIndex' } },`
- **استثنا: رمزنگاری فقط وقتی `DATA_ENCRYPTION_KEY` تنظیم شده فعال است و طبق کامنت کد، به خواست مالک خاموش شده؛ بدون کلید، شماره‌ها متن ساده ذخیره می‌شوند** · `verified`
  `backend/src/utils/crypto.js` · `Encryption at rest was added and then switched off again at the owner's request`
- **استثنا: `SmsMessage.to` و `body` (که شماره و متن پیامک را دارند) در فهرست ستون‌های رمزشده نیستند و متن ساده می‌مانند** · `verified`
  `backend/src/config/database.js` · `ContactReveal: { fields: ['phoneShown'], indexed: {} },` — مدل SmsMessage در `ENCRYPTED` غایب است
- **خطاهای برنامه علاوه بر فایل لاگ، در جدول `ErrorLog` با fingerprint تجمیع می‌شوند تا از پنل قابل دیدن باشند** · `verified`
  `backend/prisma/schema.prisma` · `model ErrorLog {`

### B3 — سرویس‌های بیرونی

- **پیامک: درایور Kavenegar (`api.kavenegar.com`) نوشته شده ولی غیرفعال تا وقتی `SMS_API_KEY`/`SMS_SENDER` تنظیم شود؛ پیش‌فرض درایور `log` است و پیام‌ها فقط ساخته و در DB ذخیره می‌شوند (وضعیت SKIPPED)** · `verified`
  `backend/src/modules/sms/drivers/kavenegar.driver.js` · `const url = \`https://api.kavenegar.com/v1/...\``
- **هشدار در سطح برنامه: Bot API با hostname هاردکد `api.telegram.org`، fire-and-forget و با cooldown per-kind؛ بدون token/chatId کلاً خاموش** · `verified`
  `backend/src/modules/alert/telegram.js` · `hostname: 'api.telegram.org',`
- **استثنا: اسکریپت‌های هشدار میزبان (`notify.sh`, `alert-setup.sh`) از `ALERT_API_BASE` قابل‌تنظیم استفاده می‌کنند که پیش‌فرضش «بله» (`https://tapi.bale.ai`) است — یعنی دو مسیر هشدار موازی با مقصد متفاوت: برنامه به Telegram هاردکد، اسکریپت‌های host به Bale** · `verified`
  `.env.example` · `ALERT_API_BASE=https://tapi.bale.ai` — و `grep ALERT_API_BASE` فقط در `deploy/notify.sh` و `deploy/alert-setup.sh` match می‌دهد، نه در backend
- **Let's Encrypt (ACME) برای TLS از طریق سرویس certbot با network_mode: host؛ پیامک هشدار اضطراری (`ALERT_SMS_TO`) پیش‌فرض خاموش** · `verified`
  `docker-compose.yml` · `image: certbot/certbot:latest`

### B4 — داده‌های حساس

- **حساس‌ترین دارایی محصول، شماره تماس نمایندگی‌هاست: دیدنش سهمیه‌ی روزانه/ماهانه مصرف می‌کند و هر بار دیدن، با IP و مقدارِ همان لحظه (`phoneShown`) به‌عنوان مدرک در `ContactReveal` ثبت می‌شود** · `verified`
  `backend/prisma/schema.prisma` · `// شماره و کدی که *همان لحظه* نشان داده شد.`
- **passwordHash با bcrypt (۱۰ راند پیش‌فرض)؛ توکن نشست فقط به‌صورت hash در DB نگه داشته می‌شود** · `verified`
  `backend/src/modules/auth/auth.service.js` · `tokenHash: hashToken(token),`
- **IP و userAgent کاربران در AuthSession، OtpChallenge، ActivityLog و ContactReveal ذخیره می‌شود** · `verified`
  `backend/prisma/schema.prisma` · `ip        String?` (AuthSession)
- **حساب‌های دمو با پسورد نوشته‌شده در مخزن؛ فقط با دو فلگ همزمان (`SEED_DEMO` و `ALLOW_DEMO_SEED`) در production اجرا می‌شود** · `verified`
  `.env.example` · `NEVER true once real agencies are on the system: these accounts have a password written in the repository.`

## C. چه کسی چه کاری می‌تواند بکند

### C1 — احراز هویت

- **نام کاربری/رمز عبور + نشست سمت سرور: توکن تصادفی در کوکی httpOnly، رکورد نشست در DB (قابل ابطال)؛ JWT عمداً استفاده نشده** · `verified`
  `backend/src/config/index.js` · `A self-contained JWT cannot be taken back once issued.`
- **نماینده فقط یک نشست زنده دارد (ورود جدید بقیه را KICKED می‌کند)؛ ادمین‌ها معافند. TTL نشست ۱۲ ساعت** · `verified`
  `backend/src/modules/auth/auth.service.js` · `if (user.role === ROLES.AGENT) {` … `revokeOtherSessions`
- **ضد brute-force: قفل ۱۵ دقیقه‌ای بعد از ۵ شکست، پاسخ زمان-ثابت با DUMMY_HASH، پیام واحد برای «کاربر نیست/رمز غلط»، و rate-limit اختصاصی روی login** · `verified`
  `backend/src/modules/auth/auth.service.js` · `const DUMMY_HASH =`
- **تغییر اجباری رمز در اولین ورود، در middleware سراسری enforce می‌شود و همه‌ی مسیرها جز change-password را می‌بندد؛ تغییر رمز بقیه‌ی نشست‌ها را می‌کشد** · `verified`
  `backend/src/middlewares/auth.js` · `function requirePasswordChanged(req, _res, next) {`
- **استثنا: زیرساخت OTP دومرحله‌ای (مدل `OtpChallenge`، قالب پیامک، تنظیم `auth.requireOtp`) ساخته شده ولی جریان login آن را چک نمی‌کند — تنظیم پیش‌فرض خاموش است و در `auth.service.login` هیچ ارجاعی به OTP نیست** · `verified`
  `backend/src/modules/settings/settings.service.js` · `'auth.requireOtp': {` — grep روی `otpChallenge` در `backend/src` هیچ call site برنمی‌گرداند

### C2 — نقش‌ها و مجوزدهی

- **شش نقش: OWNER و DEVELOPER (مخفی)، SUPER_ADMIN، SUPPORT، FINANCE، AGENT. کل سیاست به‌صورت جدول permission در یک فایل است و middleware `requirePermission` روی *کاربر* چک می‌کند نه نقش — چون هر حساب می‌تواند override در ستون `permissions` (Json) داشته باشد** · `verified`
  `backend/src/constants/roles.js` · `const PERMISSIONS = {` / `function userCan(user, permission) {`
- **OWNER/DEVELOPER از دید بقیه‌ی سیستم وجود ندارند (در فهرست‌ها و activity log فیلتر می‌شوند — enforce در لایه‌ی داده)؛ DEVELOPER عمداً هیچ permissionای ندارد** · `verified`
  `backend/src/constants/roles.js` · `const HIDDEN_ROLES = [ROLES.OWNER, ROLES.DEVELOPER];`
  ادعای «فیلترشدن در لایه‌ی داده» بر اساس کامنت همین فایل است؛ خودِ repositoryهای فیلترکننده سطربه‌سطر بازبینی نشدند — آن بخش `inferred`.
- **فقط OWNER می‌تواند حساب staff بسازد یا نقش بدهد (`staff` permission + `assignableRoles`)؛ مسیرهای `/admin/staff` پشت `requirePermission('staff')`** · `verified`
  `backend/src/constants/roles.js` · `if (actorRole !== ROLES.OWNER) return [];`
- **تفکیک ادمین‌ها: SUPPORT فقط تیکت/گزارش/ویرایش تماس، FINANCE فقط اشتراک و ظرفیت؛ errorLog و systemAlerts و staff مخصوص OWNER** · `verified`
  `backend/src/constants/roles.js` · `SUPPORT: {` … `subscriptions: false,`
- **حق‌های نماینده به اشتراک گره خورده: مسیرهای نوشتنی (ثبت/تمدید آگهی، reveal، گزارش تخلف) پشت `requireActiveSubscription`؛ اشتراک منقضی فهرست را می‌بیند ولی مشخصات تماس را نه** · `verified`
  `backend/src/middlewares/access.js` · `function requireActiveSubscription(req, _res, next) {`
- **قواعد مالکیت مقصود (نمونه: گزارش آگهی خودی ممنوع، ویرایش پروفایل فقط با تیکت و تأیید ادمین، تعلیق سوم فقط با تأیید مدیر کل) در schema و annotationها بیان شده؛ enforce سرویس‌به‌سرویس به‌طور کامل بازبینی نشد** · `inferred`
  `backend/prisma/schema.prisma` · `needsSuperApproval Boolean   @default(false)`

### C3 — مرزهای اعتماد

- **اینترنت → nginx: مرز اصلی. nginx هدرهای امنیتی (CSP بدون unsafe-inline برای script، X-Frame-Options DENY) ست می‌کند و dotfileها را deny می‌کند** · `verified`
  `deploy/nginx/app.conf` · `add_header Content-Security-Policy "default-src 'self'; script-src 'self';`
- **nginx → API: برنامه `trust proxy 1` دارد و IP واقعی را از `X-Forwarded-For` می‌خواند — یعنی صحت IP در rate-limit و لاگ‌ها به سالم‌بودن این لایه متکی است** · `verified`
  `backend/src/app.js` · `app.set('trust proxy', 1);`
- **ورودی کاربر → DB: همه‌ی بدنه‌ها/کوئری‌ها با Joi در لایه‌ی route اعتبارسنجی می‌شوند و دسترسی داده از طریق Prisma است** · `verified`
  `backend/src/modules/report/report.routes.js` · `validate({ body: Joi.object({`
- **مرز agent/admin در سطح mount نقطه‌ی route enforce می‌شود (`requireRole(AGENT)` در مقابل `requireAdmin`)؛ مرز مالی-محتوایی بین خود ادمین‌ها با permission** · `verified`
  `backend/src/modules/subagent/subagent.routes.js` · `router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT));`
- **Adminer یک مسیر جانبی مستقیم به کل دیتابیس است که از احراز هویت برنامه عبور نمی‌کند — حفاظتش Basic Auth + پسورد DB است و روی HTTP ساده می‌ماند تا وقتی گواهی TLS نصب و config سوییچ شود** · `verified`
  `deploy/nginx/adminer.conf` · `# After the SSL certificate exists (deployment step 7), switch this port to HTTPS`

## D. چه چیزی بیرون از دید است

### D1 — محیط و کنترل‌های بیرونی

- **TLS پیش‌فرض خاموش است و بعد از صدور گواهی با `enable-ssl.sh` روشن می‌شود (`$force_https` در `00-mode.conf`)؛ اینکه روی سرور واقعی روشن شده یا نه از مخزن قابل تشخیص نیست** · `unverified`
  `deploy/nginx/app.conf` · `if ($force_https) { return 301 https://$host$request_uri; }`
- **WAF، فایروال میزبان، یا کنترل شبکه‌ای بیرون از nginx** · `unknown`
  در مخزن چیزی جز nginx و compose نیست؛ تأییدش دسترسی به سرور می‌خواهد.
- **rate-limit در سطح برنامه (سراسری ~۸۰/دقیقه به‌ازای IP + limiter اختصاصی login + limit_req پنل دیتابیس) وجود دارد؛ رفتار واقعی زیر بار و پشت CDN/پراکسی احتمالی** · `unverified`
  `backend/src/config/index.js` · `max: Number(process.env.RATE_LIMIT_MAX) || 1200,`
- **بکاپ (سه رده + انتقال off-site اختیاری)، watchdog هر ۵ دقیقه، و preflight استقرار به‌صورت اسکریپت آماده‌اند؛ اینکه cron واقعاً نصب و فعال است بیرون از مخزن است** · `unverified`
  `deploy/backup.sh` · `deploy/backup.sh hourly     # kept 48 hours`
- **مقادیر واقعی secretها (SESSION_SECRET، پسورد DB، DATA_ENCRYPTION_KEY، توکن بات) فقط در `.env` سرور وجود دارند؛ `.env.example` کامل ولی خالی است** · `verified`
  `.env.example` · `# Required.  openssl rand -hex 32`

### D2 — پوشش و محدودیت‌ها

- بررسی‌شده به‌صورت کامل: `app.js`، `server.js`، `config/`، هر چهار middleware، ماژول auth، `constants/roles.js`، `schema.prisma`، لایه‌ی رمزنگاری (`crypto.js`, `database.js`)، `settings.service`، درایورهای sms، `telegram.js`، هر سه فایل nginx، `docker-compose.yml`، `.env.example`، و فهرست کامل تعریف routeها (grep روی همه‌ی `*.routes.js`).
- بررسی‌شده به‌صورت سرخط/نمونه: بدنه‌ی service/repositoryهای havale، report، subscription، subagent، ticket، admin (منطق مالکیت و سقف‌ها سطربه‌سطر خوانده نشد)؛ صفحات frontend؛ بدنه‌ی اسکریپت‌های deploy (فقط سرآیندها).
- بررسی‌نشده: `docs/blueprint.pdf` و سایر مستندات (فقط به‌عنوان سرنخ در کامنت‌ها دیده شدند)، `mockup/`، تصاویر، محتوای تست‌ها (۸ سوییت e2e و ۴ unit وجود دارند ولی اجرا نشدند — محیط DB تست فراهم نبود و خارج از محدوده‌ی این نقشه بود).
- شمارش «حدود ۳۵ / حدود ۴۰ مسیر» از خروجی grep تعریف routeهاست، نه شمارش دستی تک‌به‌تک؛ عدد دقیق با Swagger زنده قابل استخراج است.
