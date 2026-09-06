-- AlterTable
ALTER TABLE "CarModel" ADD COLUMN     "priceKey" TEXT,
ADD COLUMN     "priceKeyLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CarPriceItem" ADD COLUMN     "familyKey" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "CarModel_priceKey_idx" ON "CarModel"("priceKey");

-- CreateIndex
CREATE INDEX "CarPriceItem_familyKey_idx" ON "CarPriceItem"("familyKey");
