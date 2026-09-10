# فصل ۷ — پایگاه داده

**در این فصل:** ۳۱ مدل در شش گروه، ستون‌هایی که باید بشناسید، مایگریشن، seed،
رمزنگاری و نگه‌داری. منبع حقیقت: `backend/prisma/schema.prisma` — بالای هر مدل
توضیح فارسی دارد.

---

## ۷.۱ نقشه‌ی مدل‌ها

```
حساب و دسترسی          بازار                        نظم و پشتیبانی
──────────────         ─────────────────────        ────────────────────
User ──┬── AuthSession  Listing ──┬── RegistrationDetail  ViolationReport
       ├── OtpChallenge           ├── CarDetail ── CarPhoto  Ticket ── TicketMessage ── TicketAttachment
       ├── BrandAccess            └── ContactReveal
       ├── ModelAccess
       ├── Subscription ── Plan   کاتالوگ                     قیمت روز
       └── SeatOrder              CarCompany ── CarBrand ──   CarPriceRun
                                  CarModel, CarColor          CarPriceItem ── CarPriceHistory
لاگ و سیستم                                                   CarPriceWatch
ActivityLog  ErrorLog  SecurityEvent  BlockedIp  Setting  SmsMessage
```

### حساب و دسترسی

| مدل | نکته‌های مهم |
|---|---|
| `User` | همه‌ی نقش‌ها در یک جدول (`role`). نمایندگی: `agencyCode`, `agencyName`, `city`, `coordinatorName`, `coordinatorPhone`. زیرنمایندگی: `parentId`. فروشنده‌ی ظرفیت: `isReseller`, `seatCredits`. `mustChangePassword`, `guideSeenAt`, `lastLoginAt`. اخطارها: `fakeStrikes`, `falseReportStrikes`. `status` فقط `ACTIVE/SUSPENDED` — **حساب هرگز حذف نمی‌شود**. `permissions` (Json) override مجوز کارمند. `phoneIndex` بلایند‌ایندکس برای جستجوی شماره‌ی رمزشده |
| `AuthSession` | `tokenHash` (یکتا)، `ip`, `userAgent`, `expiresAt`, `endedAt`, `endReason` (`LOGOUT/KICKED/EXPIRED/…`) |
| `OtpChallenge` | کد دو عاملی — تا پنل پیامک نیامده خاموش است |
| `BrandAccess`, `ModelAccess` | نمایندگی زیر کدام برند/مدل می‌تواند آگهی بگذارد. همیشه **برند**، نه شرکت (تصمیم عمدی — توضیح در schema) |
| `Plan`, `Subscription` | پلن با سهمیه‌ی روزانه/ماهانه؛ اشتراک با `expiresAt`, `status`, `origin` (`ADMIN` یا `PARENT_SEAT`) |
| `SeatOrder` | خرید ظرفیت زیرنمایندگی با فیش واریزی؛ `receiptStoredAs` نام تصادفی فایل |

### بازار

| مدل | نکته‌های مهم |
|---|---|
| `Listing` | **یک جدول برای هر سه بازار**: `market`, `kind` (`OFFER/REQUEST`), `ownerId`, `carModelId` + `carType` (نام آینه‌شده)، `solh`, رنگ/مدل/مبالغ (BigInt تومان)، `deliveryDays`, `depositDays`, `paymentType`, `description` (پشت reveal)، `status`, `suspendReason`, `serial` (شماره‌ی خوانا)، `revealCount`, `reportCount`, `editedAt`, `closesAt`, `deletedAt` (حذف نرم) |
| `RegistrationDetail` | فیلدهای مخصوص ثبت‌نامی (یک‌به‌یک) |
| `CarDetail` | خودرو: کارکرد، سال، `bodyStatus` (Json ۲۲ قطعه)، `bodyGrade` مشتق، `warranty`, `paintTolerance` |
| `CarPhoto` | نام فایل تصادفی؛ سرو فقط با مجوز |
| `ContactReveal` | **سند خرج سهمیه**: `(listingId, viewerId)` یکتا، `ip`, `phoneShown` (شماره‌ی همان لحظه)، `agencyCodeShown`. **هرگز پاک نمی‌شود** |

### کاتالوگ و قیمت روز

| مدل | نکته‌های مهم |
|---|---|
| `CarCompany` → `CarBrand` → `CarModel`, `CarColor` | فهرست بسته، `isActive`، `bodyType` روی مدل |
| `CarPriceRun` | هر اجرای موفق: `sourceStamp` (تاریخ خودِ منبع)، تعداد ردیف |
| `CarPriceItem` | کلید پایدار منبع، قیمت‌های بازار/کارخانه، متنِ خانه، `lastSeenAt` |
| `CarPriceHistory` | فقط در تغییر قیمت + یک بار در روز |
| `CarPriceWatch` | ستاره‌ی «فهرست من» — به ازای **حساب** |

### نظم، پشتیبانی، لاگ

| مدل | نکته‌های مهم |
|---|---|
| `ViolationReport` | یک گزارش برای هر (آگهی، گزارش‌دهنده)؛ `status` `PENDING/CONFIRMED/REJECTED/ABUSIVE` |
| `Ticket`, `TicketMessage`, `TicketAttachment` | دسته، اولویت، `isStaff` روی پیام |
| `ActivityLog` | «چه کسی چه کرد»: `action` (رشته‌ی ثابت مثل `LOGIN`, `CONTACT_REVEALED`)، `targetType/Id`, `summary`, `ip`, `device`, `changes` (Json از-به). **نقش OWNER هیچ ردیفی نمی‌نویسد** جز `LOGIN_FAILED` |
| `ErrorLog` | ۵۰۰ها با شمارش تکرار و `resolvedAt` |
| `SecurityEvent` | یک ردیف به ازای (قاعده، آدرس) — جمع می‌شود، رشد نمی‌کند |
| `BlockedIp` | بستن دستی آدرس؛ هرگز خودکار |
| `Setting` | تنظیمات زمان اجرا + حالت ماندگار jobها |
| `SmsMessage` | هر پیامک (فرستاده یا نه)؛ `to` رمز می‌شود |

---

## ۷.۲ مایگریشن

```bash
# تغییر schema.prisma، سپس:
npx prisma migrate dev --name what_changed      # روی havale_dev؛ فایل SQL در prisma/migrations/
DATABASE_URL='…havale_test' npx prisma migrate deploy   # دیتابیس تست هم
```

- روی سرور، `docker/entrypoint.sh` در هر بوت `prisma migrate deploy` می‌زند. مایگریشن
  باید **بدون داده‌ی موجود را خراب کردن** اجرا شود؛ ستون تازه nullable یا با
  پیش‌فرض.
- مایگریشن دستی (بدون `migrate dev`) هم قابل قبول است: پوشه با نام
  `YYYYMMDDHHMMSS_name/migration.sql` — نمونه: `20260906201500_drop_car_price_catalogue_link`.
- `prisma migrate reset` **همه‌چیز را پاک می‌کند** — فقط محلی، و بعدش seedها.

---

## ۷.۳ seed

| اسکریپت | چه می‌سازد | شرط |
|---|---|---|
| `scripts/seed.js` | پلن پیش‌فرض، کاتالوگ کامل، مدیر اول | در production `SEED_ADMIN_PASSWORD` الزامی |
| `scripts/seed-demo.js` | ۴ نمایندگی + حواله‌های نمونه | `ALLOW_DEMO_SEED=true` (و `SEED_DEMO=true` برای بوت خودکار) |
| `scripts/seed-cars.js` | ۱۰ آگهی خودرو با بدنه‌های مختلف | همان |
| `scripts/create-owner.js` | حساب مالک | تعاملی، رمز از ترمینال خاموش |

همه idempotent‌اند (دوباره اجرا کردن تکراری نمی‌سازد) و از مسیر خودِ سرویس‌ها
می‌روند، پس هر قاعده‌ی محصول را رعایت می‌کنند.

> **پیش از اولین نمایندگی واقعی**: `SEED_DEMO=false`, `ALLOW_DEMO_SEED=false`،
> حساب‌های نمونه تعلیق، دیتابیس فرش — `docs/launch-checklist.md`.

---

## ۷.۴ رمزنگاری ستون‌ها

`config/database.js` روی PrismaClient قلاب می‌زند: ستون‌های `ENCRYPTED` در نوشتن
رمز و در خواندن باز می‌شوند (AES-256-GCM، IV تازه، پیشوند `v1.`). امروز:
`User.phone`, `User.coordinatorPhone`, `ContactReveal.phoneShown`, `SmsMessage.to`.

- کلید: `DATA_ENCRYPTION_KEY` (۳۲ بایت hex). **بدون کلید، همه‌چیز متن ساده است** —
  وضعیت فعلی به تصمیم مالک؛ بوت production یک هشدار چاپ می‌کند.
- فعال‌سازی: کلید در `.env` → `node scripts/encrypt-existing.js` (بک‌فیل) → بکاپ
  را هم رمز کنید (`security-audit.md` بند C1).
- تست‌ها با یک کلید ثابت اجرا می‌شوند تا مسیر رمز هم پوشش داشته باشد.

---

## ۷.۵ نگه‌داری (retention)

`modules/admin/retention.service.js`، از `nightly.js`:

| چه | چند روز (پیش‌فرض) | متغیر |
|---|---|---|
| لاگ ورود/خروج | ۹۰ | `RETAIN_AUTH_DAYS` |
| ورود ناموفق | ۳۰ | `RETAIN_FAILED_LOGIN_DAYS` |
| لاگ آگهی‌ها | ۳۶۵ | `RETAIN_LISTING_DAYS` |
| لاگ مدیریت | ۷۳۰ | `RETAIN_ADMIN_DAYS` |
| خطاهای حل‌شده | ۹۰ | `RETAIN_RESOLVED_ERROR_DAYS` |
| رویدادهای امنیتی حل‌شده | ۱۸۰ | `RETAIN_RESOLVED_SECURITY_DAYS` |
| نشست‌های تمام‌شده | ۹۰ | (همان `auth`) |
| کدهای یک‌بارمصرف | ۳۰ | `RETAIN_OTP_DAYS` |
| پیامک‌ها | ۹۰ | `RETAIN_SMS_DAYS` |
| تاریخچه‌ی قیمت | ۴۰۰ | `RETAIN_CAR_PRICE_HISTORY_DAYS` |
| فایل‌های آرشیو | ۳۶۵ | `ACTIVITY_ARCHIVE_DAYS` |

لاگ کارها **اول آرشیو می‌شود** (NDJSON فشرده در `/archive`، با نام و کد نمایندگی
denormalize‌شده تا بعد از تعلیق حساب هم خواندنی باشد) و فقط اگر تعداد خط آرشیو با
شمارش برابر بود پاک می‌شود. `ContactReveal` و رویدادهای امنیتی باز هرگز پاک
نمی‌شوند.

---

## ۷.۶ دسترسی مستقیم

- محلی: `psql postgresql://havale:havale@127.0.0.1:5432/havale_dev` یا `npx prisma studio`.
- سرور: `docker compose exec db psql -U havale havale` یا Adminer روی ۸۴۴۳ (`docs/deployment.md`).
  هر تغییر مستقیم، لاگ کارها را دور می‌زند — فقط برای خواندن، مگر در وضعیت اضطراری.
- هیچ `$queryRawUnsafe` در کد نیست و نباید باشد؛ تنها SQL خام، قفل مشورتی
  پارامتری در `utils/serialize.js` است.
