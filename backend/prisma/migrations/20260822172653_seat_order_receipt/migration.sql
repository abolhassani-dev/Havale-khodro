-- AlterTable
ALTER TABLE "SeatOrder" ADD COLUMN     "receiptMime" TEXT,
ADD COLUMN     "receiptName" TEXT,
ADD COLUMN     "receiptSize" INTEGER,
ADD COLUMN     "receiptStoredAs" TEXT;
