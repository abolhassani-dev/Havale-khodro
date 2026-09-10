# فصل ۵ — بک‌اند

**در این فصل:** ساختار یک ماژول، مسیر درخواست داخل آن، لایه‌ی امنیت و مجوز،
اعتبارسنجی و خطا، تنظیمات، کارهای زمان‌بندی‌شده — و در پایان، ساختن یک بازار جدید
قدم‌به‌قدم.

مسیر: `backend/`. اجرا: `npm run dev`. Node 20، Express 4، Prisma 5، CommonJS.

---

## ۵.۱ آناتومی یک ماژول

هر موضوع یک پوشه زیر `src/modules/` است. `havale/` نمونه‌ی کامل است:

| فایل | نقش | قاعده |
|---|---|---|
| `havale.routes.js` | مسیرها + میان‌افزارهای نگهبان + اعتبارسنجی | فقط اتصال؛ هیچ منطقی این‌جا نیست |
| `havale.validator.js` | اسکیماهای Joi برای body / params / query | هر مسیر نویسنده یک اسکیما دارد |
| `havale.controller.js` | `req` → آرگومان‌های سرویس → `success()/created()` | نازک؛ در ماژول‌های جدیدتر (car) حذف شده و routes مستقیم سرویس را صدا می‌زند |
| `havale.service.js` | قاعده‌های کسب‌وکار، مجوز مالکیت، لاگ کار | تنها جایی که «چه کسی چه می‌تواند بکند» تصمیم گرفته می‌شود |
| `havale.repository.js` | Prisma | هیچ قاعده‌ای؛ فقط کوئری |
| `havale.dto.js` | شکل خروجی — **مرز پنهان‌سازی** | تنها جایی که شماره‌ی تماس ممکن است وارد پاسخ شود |
| `havale.market.js` | معرفی به رجیستری بازارها | `registerMarket('HAVALE', { … })` |

```js
// routes
router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT), attachAccess);
router.get('/', validate(schema.list), controller.list);
router.post('/', requireActiveSubscription, validate(schema.create), controller.create);

// controller
create: asyncHandler(async (req, res) => {
  const havale = await havaleService.create({ user: req.user, payload: req.body });
  return created(res, havale, MESSAGES.HAVALE.CREATED);
}),
```

`asyncHandler` هر خطای پرتاب‌شده را به `errorHandler` می‌رساند؛ هیچ `try/catch`
برای فرستادن پاسخ خطا در کنترلر لازم نیست.

---

## ۵.۲ نگهبان‌ها (middlewares/auth.js و access.js)

| نگهبان | چه می‌کند | خطا |
|---|---|---|
| `authenticate` | کوکی → هش توکن → نشست زنده → `req.user`, `req.session` | ۴۰۱ (`SESSION_INVALID` / `SESSION_KICKED`) |
| `requirePasswordChanged` | ورود اول باید رمز را عوض کرده باشد | ۴۰۳ `PASSWORD_CHANGE_REQUIRED` |
| `requireRole(...roles)` | نقش در فهرست | ۴۰۳ |
| `requireAdmin` | یکی از نقش‌های مدیریتی | ۴۰۳ |
| `requirePermission('tickets')` | مجوز از جدول `PERMISSIONS` (+ override در `user.permissions`) | ۴۰۳ |
| `attachAccess` | `req.access = resolveAccess(user)` — اشتراک فعال؟ سهمیه چقدر؟ | — |
| `requireActiveSubscription` | برای نوشتن و «نمایش مشخصات» | ۴۰۳ `SUBSCRIPTION_EXPIRED` |

خطاهای ۴۰۳ و ۴۰۴ در سرویس‌ها عمداً به شکل «پیدا نشد» برمی‌گردند وقتی پای مالکیت
در میان است (`requireOwn`): شناسه‌ی آگهی کسی دیگر نباید وجودش را لو بدهد.

### نشست

- توکن: ۳۲ بایت تصادفی، در کوکی `httpOnly; SameSite=Strict; Secure` (Secure از روی
  اتصال، نه `NODE_ENV`)، در دیتابیس فقط **هش SHA-256** آن.
- عمر: `SESSION_TTL_HOURS` (پیش‌فرض ۱۲) — یک عدد برای کوکی و دیتابیس.
- «یک نشست برای هر نمایندگی»: ورود تازه، بقیه را `KICKED` می‌کند.
- خروج، تغییر رمز، ریست رمز توسط مدیر و تعلیق همه نشست‌ها را سمت سرور می‌بندند.

---

## ۵.۳ اعتبارسنجی و خطا

- `validate({ body, params, query })` با Joi، `stripUnknown: true` — فیلد ناشناخته
  بی‌صدا حذف می‌شود، نه ذخیره. خطا → **۴۲۲** با `details: [{ field, message }]`.
- خانواده‌ی خطاها در `errors/AppError.js`: `BadRequestError` (۴۰۰)،
  `UnauthorizedError` (۴۰۱)، `ForbiddenError` (۴۰۳)، `NotFoundError` (۴۰۴)،
  `ConflictError` (۴۰۹)، `ValidationError` (۴۲۲). هر کدام یک `code` ماشین‌خوان از
  `constants/errorCodes.js` دارد.
- متن‌های فارسی همه در `constants/messages.js`. متن بازارها در `MESSAGES.LISTING`؛
  `MESSAGES.HAVALE` فقط برای ماژول حواله — ماژول جدید از آن قرض نمی‌گیرد.
- `errorHandler` تنها جایی است که خطا شکل می‌گیرد: در production پیام عمومی، در
  توسعه `err.message`؛ ۵۰۰ها به لاگ فنی و ربات هشدار می‌روند. اگر مرورگرِ در حال
  ناوبری (`Accept: text/html`) به API بخورد، به `/error.html` هدایت می‌شود.

---

## ۵.۴ پنهان‌سازی — مرزی که تست نمی‌گیرد

- شماره‌ها فقط در `*.dto.js` خوانده می‌شوند (`havale.dto`, `car.dto`,
  `registration.dto`, `listing/reveal.dto`). `security/audit.js` هر
  `x.coordinatorPhone` خارج از این فایل‌ها را گزارش می‌کند.
- `reveal.service.js` تنها جای خرج کردن سهمیه است، برای هر سه بازار. شمارش و
  نوشتن زیر **قفل مشورتی پستگرس** به ازای هر بیننده (`utils/serialize.js`) تا
  درخواست‌های هم‌زمان سهمیه را دو بار خرج نکنند. همان قفل برای ظرفیت زیرنمایندگی
  و سقف گزارش.
- `utils/textGuard.js`: رد کردن الگوهای شماره در ثبت، پوشاندن در خواندن، و
  `tests/e2e/textLeak.test.js` که **هر ستون متنی را خودش از schema پیدا می‌کند**.

---

## ۵.۵ تنظیمات زمان اجرا

`modules/settings/settings.service.js` یک شیء `SETTINGS` دارد؛ کلید جدید همان‌جا
اعلام می‌شود، با نوع و پیش‌فرض و توضیح:

```js
'report.dailyLimit': { type: 'number', default: () => 5, description: 'سقف گزارش تخلف هر نماینده در ۲۴ ساعت' },
```

مقدار از جدول `Setting` خوانده می‌شود، وگرنه پیش‌فرض. مسیر `/settings` فقط کلیدهای
اعلام‌شده را می‌پذیرد. کلیدهای فعلی: `sms.enabled`, `auth.requireOtp`,
`seat.priceToman`, `report.dailyLimit`. مقادیر ثابت محصول (سهمیه‌ی پیش‌فرض، سه
اخطار، پنجره‌ی گزارش) در `constants/`اند، نه این‌جا.

---

## ۵.۶ کارهای زمان‌بندی‌شده

**قاعده:** هیچ `setInterval` یا زمان‌بند داخل پروسه‌ی API نیست (استثنای تنها:
تازه‌سازی کش آدرس‌های بسته در `blockedIp.js`). هر کار دوره‌ای یک فایل در
`src/jobs/` است که کرونِ هاست با `docker compose run --rm api node src/jobs/x.js`
در کانتینر تازه اجرا می‌کند. حالت ماندگار (مثلاً «آخرین هشدار کِی فرستاده شد») در
جدول `Setting` نگه داشته می‌شود، نه در حافظه.

| job | زمان | کار |
|---|---|---|
| `nightly.js` | ۰۳:۳۰ | `retention.service.run()`: آرشیو NDJSON لاگ‌ها به `/archive`، سپس پاک کردن **فقط اگر تعداد خط آرشیو با شمارش برابر بود**؛ پاک‌سازی نشست‌های تمام‌شده، کدها، پیامک‌ها، تاریخچه‌ی قیمت، خطاها و رویدادهای حل‌شده |
| `car-prices.js` | هر ۱۵ دقیقه | `carprice.fetch` (سقف ۸ مگابایت، timeout، یک retry) → `carprice.parser` → چهار گیت اعتبار → تراکنش نوشتن → هشدار در خرابی (با cooldown در `Setting`) |

اجرای دستی محلی: `node src/jobs/car-prices.js` (با `--dry-run` فقط بررسی).

---

## ۵.۷ چند مسیر خواندنی

| بخواهید بدانید | بخوانید |
|---|---|
| اشتراک و سهمیه چطور حل می‌شود | `subscription.service.js` → `resolveAccess()` |
| مجوز برند هر نمایندگی | `catalog/brandAccess.service.js` |
| سه اخطار و تعلیق | `report.service.js` + `constants/moderation.js` |
| اطلاعیه بدون جدول | `notice.service.js` |
| تشخیص نفوذ (فقط ثبت) | `middlewares/threatDetect.js` + `security/threat.rules.js` |
| رمزنگاری ستون‌ها | `config/database.js` (`ENCRYPTED`) + `utils/crypto.js` |
| آپلود و بررسی امضای فایل | `utils/uploads.js` |
| تقویم تهران | `utils/time.js` |

---

## ۵.۸ راهنمای عملی: ساختن بازار «قطعات»

فرض کنیم بازار قطعات (`PARTS`) قرار است ساخته شود. الگو: ماژول `car/` که جدیدترین
است.

1. **schema** — `enum ListingMarket` مقدار `PARTS` بگیرد؛ اگر فیلدهای مخصوص دارد
   یک جدول جزئیات مثل `CarDetail` با رابطه‌ی یک‌به‌یک به `Listing`. سپس
   `npx prisma migrate dev --name parts_market`.
2. **`modules/parts/`** با همان فایل‌ها: `parts.constants.js`, `parts.validator.js`,
   `parts.repository.js`, `parts.service.js`, `parts.dto.js`, `parts.routes.js`,
   `parts.market.js`.
3. **dto**: کارت عمومی فقط فیلدهای ساختاریافته؛ `description` و تماس پشت
   `revealed`. از `listing/reveal.dto.js` (`contactOf`, `agencyOf`) استفاده کنید.
4. **reveal**: `revealService.reveal({ …, targetType: 'PARTS', market: 'PARTS' })`.
5. **market.js**: `registerMarket('PARTS', { label, include, summarise, describe })`
   و `require('./parts.market')` بالای routes.
6. **routes/index.js**: `router.use('/parts', partsRoutes)`.
7. **پیام‌ها**: هر متن جدید در `MESSAGES.LISTING` یا `MESSAGES.PARTS`.
8. **تست**: `tests/e2e/parts.test.js` با الگوی `car.test.js`؛ `textLeak.test.js`
   ستون‌های متنی جدید را خودش پیدا می‌کند — فقط باید اجرا شود.
9. **پنل**: فصل ۶، بخش «صفحه‌ی جدید».

هیچ فایل مشترکی جز `schema.prisma`، `routes/index.js` و `messages.js` تغییر نمی‌کند.
اگر مجبور شدید `listing/` یا `admin/` را دست بزنید، احتمالاً الگو را اشتباه
گرفته‌اید.
