-- CreateEnum
CREATE TYPE "CarBodyGrade" AS ENUM ('NO_PAINT', 'MINOR_PAINT', 'PAINTED', 'REPLACED', 'CHASSIS_DAMAGED');

-- CreateEnum
CREATE TYPE "CarPaintTolerance" AS ENUM ('NO_PAINT_ONLY', 'MINOR_OK', 'ANY');

-- AlterEnum
ALTER TYPE "ListingMarket" ADD VALUE 'CAR';

-- CreateTable
CREATE TABLE "CarDetail" (
    "listingId" TEXT NOT NULL,
    "bodyType" "BodyType" NOT NULL,
    "year" INTEGER,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "mileageKm" INTEGER,
    "maxMileageKm" INTEGER,
    "priceFromToman" BIGINT,
    "bodyStatus" JSONB,
    "bodyGrade" "CarBodyGrade" NOT NULL DEFAULT 'NO_PAINT',
    "paintTolerance" "CarPaintTolerance",

    CONSTRAINT "CarDetail_pkey" PRIMARY KEY ("listingId")
);

-- CreateTable
CREATE TABLE "CarPhoto" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarDetail_bodyType_bodyGrade_idx" ON "CarDetail"("bodyType", "bodyGrade");

-- CreateIndex
CREATE UNIQUE INDEX "CarPhoto_fileName_key" ON "CarPhoto"("fileName");

-- CreateIndex
CREATE INDEX "CarPhoto_listingId_idx" ON "CarPhoto"("listingId");

-- AddForeignKey
ALTER TABLE "CarDetail" ADD CONSTRAINT "CarDetail_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarPhoto" ADD CONSTRAINT "CarPhoto_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
