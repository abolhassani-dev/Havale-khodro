-- پایه‌ی چند-بازاری.
--
-- هیچ ستونی حذف یا دوباره ساخته نمی‌شود: فقط تغییر نام، که در پستگرس تغییر
-- ابرداده است و آنی انجام می‌شود. کل این فایل در یک تراکنش اجرا می‌شود، پس اگر
-- یک خطش هم شکست، هیچ‌کدام اعمال نمی‌شود.

-- ۱) جدول آگهی، با نامی که دیگر فقط حواله نیست
ALTER TABLE "Havale" RENAME TO "Listing";
ALTER TABLE "ContactReveal" RENAME COLUMN "havaleId" TO "listingId";
ALTER TABLE "ViolationReport" RENAME COLUMN "havaleId" TO "listingId";

-- نام ایندکس‌ها و قیدها هم با جدول هماهنگ می‌شود، وگرنه نام قدیمی برای همیشه
-- روی دیتابیس می‌ماند و هر کس بعداً نگاه کند گیج می‌شود.
DO $$
DECLARE r record; new_name text;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS tbl
    FROM pg_constraint c
    WHERE c.conname LIKE 'Havale%' OR c.conname LIKE '%havaleId%'
  LOOP
    new_name := replace(replace(r.conname, 'havaleId', 'listingId'), 'Havale', 'Listing');
    IF new_name <> r.conname THEN
      EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, new_name);
    END IF;
  END LOOP;

  FOR r IN
    SELECT i.indexname AS conname
    FROM pg_indexes i
    WHERE i.schemaname = current_schema()
      AND (i.indexname LIKE 'Havale%' OR i.indexname LIKE '%havaleId%')
  LOOP
    new_name := replace(replace(r.conname, 'havaleId', 'listingId'), 'Havale', 'Listing');
    IF new_name <> r.conname THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.conname, new_name);
    END IF;
  END LOOP;
END $$;

-- ۲) ستون بازار. هر ردیف موجود، حواله است.
CREATE TYPE "ListingMarket" AS ENUM ('HAVALE', 'REGISTRATION');
ALTER TABLE "Listing" ADD COLUMN "market" "ListingMarket" NOT NULL DEFAULT 'HAVALE';
CREATE INDEX "Listing_market_status_createdAt_idx" ON "Listing"("market", "status", "createdAt");

-- ۳) «نوع واگذاری» فقط در بازار حواله معنا دارد
ALTER TABLE "Listing" ALTER COLUMN "solh" DROP NOT NULL;

-- ۴) جزئیات بازار ثبت‌نامی، در جدول خودش
CREATE TYPE "RegistrationMethod" AS ENUM ('LOTTERY', 'TIME_PRIORITY');
CREATE TYPE "RegistrationSaleType" AS ENUM ('PRESALE', 'CASH_SINGLE', 'CASH_STAGED', 'INSTALLMENT', 'PRODUCTION_PARTNERSHIP');

CREATE TABLE "RegistrationDetail" (
    "listingId" TEXT NOT NULL,
    "planName" TEXT,
    "method" "RegistrationMethod",
    "saleType" "RegistrationSaleType",
    "capacity" INTEGER,
    "depositToman" BIGINT,
    "premiumToman" BIGINT,
    "registerDeadline" TIMESTAMP(3),
    "deliveryEstimate" TEXT,
    "conditions" TEXT,

    CONSTRAINT "RegistrationDetail_pkey" PRIMARY KEY ("listingId")
);

CREATE INDEX "RegistrationDetail_method_saleType_idx" ON "RegistrationDetail"("method", "saleType");

ALTER TABLE "RegistrationDetail" ADD CONSTRAINT "RegistrationDetail_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
