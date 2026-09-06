-- قیمت روز خودرو: snapshot ساعتی، تاریخچه‌ی نقطه‌ای و «فهرست من».
--
-- ردیف‌ها با شناسه‌ی پایدارِ خود منبع کلید می‌خورند نه با اسم؛ تاریخچه فقط در
-- تغییر قیمت و یک بار در روز نوشته می‌شود؛ هر اجرای کرون — موفق یا نه — یک
-- ردیف در CarPriceRun دارد تا «آخرین به‌روزرسانی» همیشه آخرین اجرای موفق باشد.

-- CreateEnum
CREATE TYPE "CarPriceGroup" AS ENUM ('DOMESTIC', 'IMPORTED');

-- CreateEnum
CREATE TYPE "PriceDirection" AS ENUM ('UP', 'DOWN', 'FLAT');

-- CreateTable
CREATE TABLE "CarPriceItem" (
    "id" TEXT NOT NULL,
    "group" "CarPriceGroup" NOT NULL,
    "brand" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceToman" BIGINT,
    "priceText" TEXT NOT NULL,
    "secondToman" BIGINT,
    "secondText" TEXT NOT NULL,
    "changeToman" BIGINT,
    "changePct" DECIMAL(7,2),
    "direction" "PriceDirection",
    "prevToman" BIGINT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "changedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarPriceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarPriceRun" (
    "id" TEXT NOT NULL,
    "group" "CarPriceGroup" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "secondLabel" TEXT,
    "error" TEXT,

    CONSTRAINT "CarPriceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarPriceHistory" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "priceToman" BIGINT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarPriceWatch" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarPriceWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarPriceItem_group_sortOrder_idx" ON "CarPriceItem"("group", "sortOrder");

-- CreateIndex
CREATE INDEX "CarPriceItem_seenAt_idx" ON "CarPriceItem"("seenAt");

-- CreateIndex
CREATE INDEX "CarPriceRun_group_ok_finishedAt_idx" ON "CarPriceRun"("group", "ok", "finishedAt");

-- CreateIndex
CREATE INDEX "CarPriceHistory_itemId_at_idx" ON "CarPriceHistory"("itemId", "at");

-- CreateIndex
CREATE INDEX "CarPriceHistory_at_idx" ON "CarPriceHistory"("at");

-- CreateIndex
CREATE INDEX "CarPriceWatch_ownerId_idx" ON "CarPriceWatch"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CarPriceWatch_ownerId_itemId_key" ON "CarPriceWatch"("ownerId", "itemId");

-- AddForeignKey
ALTER TABLE "CarPriceHistory" ADD CONSTRAINT "CarPriceHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CarPriceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarPriceWatch" ADD CONSTRAINT "CarPriceWatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarPriceWatch" ADD CONSTRAINT "CarPriceWatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CarPriceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
