/*
  Warnings:

  - You are about to drop the column `companyId` on the `BrandAccess` table. All the data in the column will be lost.
  - Made the column `brandId` on table `BrandAccess` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "BrandAccess" DROP CONSTRAINT "BrandAccess_companyId_fkey";

-- DropForeignKey
ALTER TABLE "CarBrand" DROP CONSTRAINT "CarBrand_companyId_fkey";

-- DropIndex
DROP INDEX "BrandAccess_userId_companyId_key";

-- AlterTable
ALTER TABLE "BrandAccess" DROP COLUMN "companyId",
ALTER COLUMN "brandId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CarBrand" ADD COLUMN     "logo" TEXT,
ALTER COLUMN "companyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CarBrand" ADD CONSTRAINT "CarBrand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CarCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
