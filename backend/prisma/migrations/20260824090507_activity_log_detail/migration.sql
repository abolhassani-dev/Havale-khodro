-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "changes" JSONB,
ADD COLUMN     "device" TEXT;

-- CreateIndex
CREATE INDEX "ActivityLog_targetId_createdAt_idx" ON "ActivityLog"("targetId", "createdAt");
