-- AlterTable
ALTER TABLE "ViolationReport" ADD COLUMN     "needsSuperApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ViolationReport_needsSuperApproval_createdAt_idx" ON "ViolationReport"("needsSuperApproval", "createdAt");
