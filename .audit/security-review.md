# Security Review — Havale-khodro (FeranoCar)

- **Commit:** `b581cf3779344cbef3a6f6fd9645122f10e8419d`
- **Date:** 2026-08-16
- **Scope:** کل کدبیس (backend، frontend، nginx/compose، اسکریپت‌های استقرار). هیچ فایلی تغییر نکرد.
- **Method:** بررسی موازی در چهار محور (auth/authz، injection/XSS، crypto/data-exposure، business-logic)، سپس تأیید دستی تک‌تک یافته‌ها روی کد. یافته‌های با اطمینان کمتر از ۸ حذف شدند.

نتیجه: **۴ یافته تأییدشده** — ۱ مورد High و ۳ مورد Medium. هیچ آسیب‌پذیری injection، XSS، یا رمزنگاری‌ای پیدا نشد.

---

# Vuln 1: Reveal Quota Bypass (TOCTOU): `backend/src/modules/havale/havale.service.js:347`

* **Severity:** High
* **Category:** `business_logic_authorization` / TOCTOU
* **Confidence:** 9/10

* **Description:**
  سقف روزانه/ماهانه‌ی «نمایش مشخصات تماس» — که هسته‌ی درآمدی محصول است — با الگوی check-then-act بررسی می‌شود و بین بررسی و نوشتن هیچ قفل یا تراکنشی وجود ندارد:

  ```js
  const usage = await this.revealUsage({ user, access });        // خواندن شمارش
  if (usage.dailyUsed >= usage.dailyLimit) throw ... DAILY_LIMIT;   // :349
  if (usage.monthlyUsed >= usage.monthlyLimit) throw ... ;          // :352
  await havaleRepository.createReveal({ havaleId: id, ... });       // :356
  ```

  تأیید شد که `createReveal` (در `havale.repository.js:118`) تراکنش دارد، ولی آن تراکنش فقط دو عملیات *نوشتن* را می‌پوشاند، نه شمارش و بررسی سقف را. تنها قید پایگاه داده `@@unique([havaleId, viewerId])` است که صرفاً از باز کردن دوباره‌ی *همان* آگهی جلوگیری می‌کند و هیچ سقفی روی *تعداد آگهی‌های متمایز* نمی‌گذارد.

* **Exploit Scenario:**
  یک نماینده با اشتراک فعال که سقف روزانه‌اش پر شده (یا می‌خواهد از آن عبور کند)، N درخواست همزمان `POST /api/v1/havales/{id}/reveal` روی N آگهی متفاوتِ باز نشده ارسال می‌کند. چون Node در هر `await` وظیفه‌ها را درهم می‌بافد، همه‌ی درخواست‌ها `revealUsage` را قبل از commit شدن اولین `createReveal` می‌خوانند و همگی شمارش قدیمی را می‌بینند؛ در نتیجه همه از شرط سقف رد می‌شوند و همه رکورد reveal می‌سازند. خروجی: N شماره تماس به قیمت یک واحد سهمیه. چون آگهی‌ها متمایزند، قید unique هرگز فعال نمی‌شود، و rate-limit سراسری (۱۲۰۰ در هر پنجره) مانع یک برست کوچک نیست. این هم کنترل درآمدی محصول را می‌شکند و هم امکان برداشت انبوه اطلاعات تماس (PII نمایندگی‌ها) فراتر از حق خریداری‌شده را می‌دهد.

* **Recommendation:**
  اعمال سقف را اتمیک کنید: یک ردیف مصرف per-viewer با قفل (`SELECT ... FOR UPDATE`) یا `UPDATE ... WHERE used < limit` شرطی، در همان تراکنشی که `contactReveal` را درج می‌کند. صرفاً جابه‌جا کردن ترتیب بررسی و نوشتن مشکل را حل نمی‌کند.

---

# Vuln 2: Support Tickets Readable by a Role Denied That Permission: `backend/src/modules/ticket/ticket.routes.js:26`

* **Severity:** Medium
* **Category:** `broken_access_control`
* **Confidence:** 9/10

* **Description:**
  روتر تیکت فقط `router.use(authenticate, requirePasswordChanged);` دارد و مسیرهای خواندن، پاسخ دادن و تغییر وضعیت هیچ `requirePermission('tickets')` ندارند — فقط `PUT /:id/priority` (خط ۱۴۲) آن را دارد. تصمیم مجوز به سرویس می‌افتد که با *کلاسِ نقش* بررسی می‌کند نه با permission:

  ```js
  userId: isAdmin(user.role) ? undefined : user.id,   // ticket.service.js:39
  isStaff: isAdmin(user.role),                        // :62
  if (!isAdmin(user.role) && ticket.userId !== user.id) throw new NotFoundError('تیکت');  // :90
  ```

  اما `FINANCE` در `ADMIN_ROLES` هست (`roles.js:36`) در حالی که در جدول مجوزها `tickets: false` دارد (`roles.js:84`). پس `isAdmin('FINANCE') === true`. به همین ترتیب، override سطح حساب (`permissions: { tickets: false }`) هم نادیده گرفته می‌شود، چون `isAdmin` اصلاً به `userCan` مراجعه نمی‌کند.

* **Exploit Scenario:**
  یک حساب `FINANCE` (طبق طرح فقط مالی) وارد می‌شود و `GET /api/v1/tickets` را صدا می‌زند و **کل صف تیکت همه‌ی نمایندگی‌ها** را می‌گیرد؛ `GET /api/v1/tickets/:id` کل مکالمه‌ی هر نمایندگی را می‌دهد (از جمله اعتراض به اخطارهای تخلف که می‌تواند حاوی اطلاعات تماس و اختلافات تجاری باشد)؛ و `POST /api/v1/tickets/:id/messages` پاسخی با پرچم `isStaff: true` ثبت می‌کند — یعنی جعل هویت پشتیبانی روی هر تیکت. مجوز `tickets` برای خواندن و پاسخ عملاً بی‌اثر است.

* **Recommendation:**
  روی مسیرهای staff-facing تیکت `requirePermission('tickets')` بگذارید، و در سرویس به‌جای `isAdmin(user.role)` از `userCan(user, 'tickets')` برای تصمیم «staff یا صاحب تیکت» استفاده کنید.

---

# Vuln 3: Owner-Only Error Log Reachable with the `settings` Permission: `backend/src/modules/alert/alert.routes.js:32`

* **Severity:** Medium
* **Category:** `broken_access_control` / `information_disclosure`
* **Confidence:** 8/10

* **Description:**
  کل روتر `/errors` با این خط محافظت می‌شود:

  ```js
  router.use(authenticate, requirePasswordChanged, requirePermission('settings'));
  ```

  ولی مدل مجوزها `errorLog` و `systemAlerts` را صراحتاً owner-only تعریف کرده: در `roles.js:61` برای OWNER `true` و برای `SUPER_ADMIN`/`SUPPORT`/`FINANCE` صراحتاً `false` (خطوط ۷۶، ۸۲، ۸۸)، و در گروه `ownerOnly: true` (خطوط ۱۴۲–۱۵۰) قرار دارند. با grep روی کل مخزن تأیید شد که **رشته‌های `errorLog` و `systemAlerts` هرگز به `requirePermission` پاس داده نمی‌شوند** — این دو مجوز هیچ‌جا اعمال نمی‌شوند. در مقابل، `settings` را `SUPER_ADMIN` دارد (`roles.js:75`).

* **Exploit Scenario:**
  یک `SUPER_ADMIN` — که طبق مدل `errorLog: false` دارد — `GET /api/v1/errors` و `GET /api/v1/errors/:id` را صدا می‌زند و لاگ کامل خطاها با stack trace را می‌خواند. خودِ کامنت همان فایل می‌گوید این داده «مسیرهای داخلی را نام می‌برد و پیامش می‌تواند ورودی کاربر را نقل کند». همان حساب می‌تواند با `POST /api/v1/errors/test-alert` کانال هشدار (`systemAlerts`) را هم به کار بیندازد. محدودسازی owner-only که در مدل نوشته شده، در عمل قابل اعمال نیست.

* **Recommendation:**
  گیت این روتر را به `requirePermission('errorLog')` تغییر دهید و مسیر test-alert را به `requirePermission('systemAlerts')` ببرید. ضمناً یک تست که تضمین کند هر کلید تعریف‌شده در `PERMISSION_KEYS` دست‌کم یک‌جا اعمال می‌شود، از تکرار این دسته اشتباه جلوگیری می‌کند.

---

# Vuln 4: Third-Strike Suspension Ignores Per-Account Permission Revocation: `backend/src/modules/report/report.service.js:128`

* **Severity:** Medium
* **Category:** `broken_access_control` / privilege-override bypass
* **Confidence:** 8/10

* **Description:**
  در هر دو مسیر `confirm` (خط ۱۲۸) و `markAbusive` (خط ۱۶۱):

  ```js
  const maySuspend = can(actor.role, 'thirdStrike');
  ```

  `can(role, ...)` فقط جدول پیش‌فرضِ نقش را می‌خواند (`roles.js:93`)، در حالی که سازوکار override سطح حساب فقط از طریق `userCan(user, ...)` (`roles.js:179`) دیده می‌شود. همان فایل `roles.js` صریحاً درباره‌ی همین اشتباه هشدار داده است: «Checking the role alone would have made the per-account boxes decorative.» گیت روت یک لایه بالاتر مسیر درست (`requirePermission` → `userCan`) را استفاده می‌کند، پس دو بررسی با هم ناسازگارند.

* **Exploit Scenario:**
  مالک یک `SUPER_ADMIN` می‌سازد و اختیارِ برگشت‌ناپذیرِ تعلیق نهایی را با override سطح حساب می‌گیرد (`permissions: { thirdStrike: false }`). آن ادمین همچنان `reports` را دارد، پس به `POST /api/v1/reports/:id/review` می‌رسد. داخل `confirm`، مقدار `maySuspend` از جدولِ نقش خوانده می‌شود و `true` برمی‌گردد — override نادیده گرفته می‌شود — و `reportRepository.suspendAccount()` بلافاصله اجرا می‌شود. یعنی اختیاری که مالک عمداً گرفته بود همچنان اعمال می‌شود و صف تأیید مدیر کل (`needsSuperApproval`) دور زده می‌شود. جهت معکوس (دادن `thirdStrike` به `SUPPORT` با override) هم بی‌صدا کار نمی‌کند، که همان باگ است از سمت دیگر.
  پیش‌شرط: مالک از قابلیت override استفاده کرده باشد — که یک قابلیت شیپ‌شده با migration و UI اختصاصی است.

* **Recommendation:**
  در هر دو نقطه `can(actor.role, 'thirdStrike')` را با `userCan(actor, 'thirdStrike')` جایگزین کنید. برای جلوگیری از تکرار، بهتر است `can()` از ماژول خارج نشود یا با lint ممنوع شود تا تنها مسیر بررسی، `userCan` باشد.

---

## بررسی‌شده و پاک (بدون یافته)

این محورها با خواندن کد بررسی شدند و مشکل قابل بهره‌برداری نداشتند:

- **XSS:** تابع `escape` در `frontend/src/ui/html.js:19` هر پنج کاراکتر خطرناک را پوشش می‌دهد و تمپلیت `html` به‌صورت پیش‌فرض escape می‌کند. هر ۳۰+ فراخوانی `raw()` بازبینی شد: همه یا پرچم‌های بولی اتریبیوت‌اند، یا مارک‌آپ ثابت، یا نام تگ غیرقابل‌کنترل توسط کاربر. داده‌های کاربر (نام نمایندگی، متن تیکت، توضیحات) همه از مسیر escape شده عبور می‌کنند. `feedback.js` عمداً `textContent` استفاده می‌کند.
- **SQL Injection:** تنها raw query موجود `` prisma.$queryRaw`SELECT 1` `` است. هیچ `$queryRawUnsafe`/`$executeRawUnsafe` وجود ندارد. لایه‌ی blind-index در `config/database.js` فقط روی آبجکت‌های آرگومان Prisma کار می‌کند، نه رشته‌ی SQL.
- **Command Injection / Path Traversal:** هیچ `child_process`، `exec`، `eval` یا عملیات فایل با ورودی کاربر در `backend/src` نیست.
- **Crypto:** `generateToken` از `crypto.randomBytes(32)` و `generateOtp` از `crypto.randomInt` استفاده می‌کنند. AES-256-GCM با IV تصادفی تازه در هر بار، و `decrypt` در صورت شکست احراز اصالت `null` برمی‌گرداند. توکن نشست فقط به‌صورت SHA-256 ذخیره می‌شود.
- **Session & Cookie:** `httpOnly`، `sameSite: 'strict'`، و `secure` مشتق‌شده از `req.secure` (`auth.controller.js:43`). قفل ۱۵ دقیقه‌ای، مقایسه‌ی زمان‌ثابت با `DUMMY_HASH`، ابطال نشست‌ها هنگام تغییر رمز و ورود مجدد. CSRF با SameSite پوشش داده شده.
- **IDOR:** در ماژول‌های `havale`، `subagent`، `ticket` (سمت نماینده)، `subscription` و `report`، اسکوپ مالکیت (`ownerId`/`parentId`/`userId`) داخل خودِ کوئری اعمال می‌شود، نه به‌عنوان بررسی بعدی.
- **Mass Assignment:** `validate.js` با `stripUnknown: true` اجرا می‌شود و هیچ اسکیمایی `.unknown(true)` ندارد؛ `role: 'AGENT'` در ساخت نماینده و زیرنماینده هاردکد است.
- **Privilege Escalation از طریق staff:** `staff.service.js` در هر تابع `assertOwner` را دوباره اعمال می‌کند و `OWNER` در `assignableRoles` نیست.
- **Data Exposure در DTO:** `toPublicUser` یک allow-list صریح است؛ `passwordHash` و `phoneIndex` هرگز map نمی‌شوند. مسیر افشای تماس فقط وقتی `subscriptionActive && revealed` باشد داده می‌دهد.
- **Container:** کانتینر API با کاربر غیر root اجرا می‌شود و seed دمو در production بدون `ALLOW_DEMO_SEED` صریحاً امتناع می‌کند.

## بررسی‌شده و گزارش‌نشده (زیر آستانه)

- **TOCTOU در ظرفیت زیرنمایندگی** (`subagent.service.js:75`): الگوی check-then-act مشابه یافته‌ی ۱ است، ولی در عمل تا حد زیادی توسط یک قید تصادفی خنثی می‌شود: `nextAgencyCode` از `lastChildSequence` مشتق می‌شود و `agencyCode` در schema یکتاست، پس درخواست‌های همزمان معمولاً کد یکسان می‌سازند و همه جز یکی با نقض قید unique رد می‌شوند. بهره‌برداری نیازمند یک پنجره‌ی درهم‌بافتگی باریک است (خواندن ظرفیت قبل از commit رقیب، ولی خواندن شماره‌ی دنباله بعد از آن). اطمینان ~۶/۱۰ — پایین‌تر از آستانه، ولی ارزش اصلاح همراه با یافته‌ی ۱ را دارد.
- **جداسازی کلید HMAC و AES** (`utils/crypto.js:141`): یک کلید هم برای AES-256-GCM و هم برای HMAC blind-index استفاده می‌شود. حمله‌ی شناخته‌شده‌ی cross-protocol برای این ترکیب وجود ندارد؛ سخت‌سازی است نه آسیب‌پذیری.
- **salt ثابت در scrypt** (`utils/crypto.js:67,73`): فقط وقتی اهمیت دارد که اپراتور به‌جای کلید ۳۲ بایتی تصادفی، یک عبارت عبور کم‌آنتروپی بدهد.
- **درایور log پیامک** (`sms/drivers/log.driver.js:15`): متن پیام (شامل کد OTP) و شماره را در لاگ می‌نویسد. چون SMS پیش‌فرض خاموش است و OTP هنوز به هیچ جریانی وصل نیست، فعلاً بهره‌برداری‌پذیر نیست — ولی قبل از فعال‌سازی پیامک باید بسته شود.

## محدودیت‌ها

- بررسی صرفاً ایستا و مبتنی بر خواندن کد بود؛ هیچ اکسپلویتی روی نمونه‌ی در حال اجرا آزمایش نشد (محیط اجرا در دسترس نبود).
- پیکربندی واقعی production — روشن بودن TLS، مقادیر `.env`، فایروال میزبان، و اینکه `DATA_ENCRYPTION_KEY` واقعاً تنظیم شده یا نه — از داخل مخزن قابل تأیید نیست.
- اسکریپت‌های `deploy/*.sh` فقط از نظر منطق کلی خوانده شدند؛ آن‌ها با ورودی غیرقابل‌اعتماد کار نمی‌کنند و طبق دامنه‌ی این بررسی، تزریق فرمان در آن‌ها مسیر حمله‌ی مشخصی ندارد.
