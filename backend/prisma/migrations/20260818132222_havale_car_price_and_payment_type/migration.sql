-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'STAGED', 'INSTALLMENT');

-- AlterTable
ALTER TABLE "Havale" ADD COLUMN     "carPriceToman" BIGINT,
ADD COLUMN     "paymentType" "PaymentType";
