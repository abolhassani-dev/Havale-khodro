-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('SUBSCRIPTION', 'SEATS', 'LISTING', 'APPEAL', 'TECHNICAL', 'OTHER');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "category" "TicketCategory" NOT NULL DEFAULT 'OTHER';

-- CreateIndex
CREATE INDEX "Ticket_category_status_idx" ON "Ticket"("category", "status");
