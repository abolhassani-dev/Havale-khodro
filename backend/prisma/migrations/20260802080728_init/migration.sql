-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'AGENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionOrigin" AS ENUM ('ADMIN', 'PARENT_SEAT');

-- CreateEnum
CREATE TYPE "HavaleKind" AS ENUM ('OFFER', 'REQUEST');

-- CreateEnum
CREATE TYPE "HavaleStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'EXPIRED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SolhStatus" AS ENUM ('SOLH', 'VEKALATI');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('FAKE_LISTING', 'WRONG_PRICE', 'UNREACHABLE', 'ALREADY_SOLD', 'FRAUD', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'ABUSIVE');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "SeatOrderStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('LOGOUT', 'KICKED', 'EXPIRED', 'ADMIN_REVOKED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "agencyCode" TEXT,
    "agencyName" TEXT,
    "city" TEXT,
    "coordinatorName" TEXT,
    "coordinatorPhone" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "dailyRevealLimitOverride" INTEGER,
    "monthlyRevealLimitOverride" INTEGER,
    "isReseller" BOOLEAN NOT NULL DEFAULT false,
    "seatCredits" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "fakeStrikes" INTEGER NOT NULL DEFAULT 0,
    "falseReportStrikes" INTEGER NOT NULL DEFAULT 0,
    "adminNote" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "priceToman" BIGINT NOT NULL,
    "dailyRevealLimit" INTEGER NOT NULL DEFAULT 30,
    "monthlyRevealLimit" INTEGER NOT NULL DEFAULT 300,
    "maxActiveHavale" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "priceToman" BIGINT NOT NULL DEFAULT 0,
    "origin" "SubscriptionOrigin" NOT NULL DEFAULT 'ADMIN',
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Havale" (
    "id" TEXT NOT NULL,
    "serial" SERIAL NOT NULL,
    "kind" "HavaleKind" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "carType" TEXT NOT NULL,
    "solh" "SolhStatus" NOT NULL,
    "carColor" TEXT,
    "model" TEXT,
    "amountToman" BIGINT,
    "paidAmountToman" BIGINT,
    "deliveryDays" INTEGER,
    "depositDays" INTEGER,
    "supplierCompany" TEXT,
    "description" TEXT,
    "status" "HavaleStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspendReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "revealCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "closesAt" TIMESTAMP(3),
    "renewedAt" TIMESTAMP(3),
    "renewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Havale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactReveal" (
    "id" TEXT NOT NULL,
    "havaleId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "ip" TEXT,
    "phoneShown" TEXT,
    "agencyCodeShown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactReveal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationReport" (
    "id" TEXT NOT NULL,
    "serial" SERIAL NOT NULL,
    "havaleId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "ownerNotifiedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "serial" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "lastReplyAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "SessionEndReason",

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatOrder" (
    "id" TEXT NOT NULL,
    "serial" SERIAL NOT NULL,
    "buyerId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "unitPriceToman" BIGINT NOT NULL,
    "totalToman" BIGINT NOT NULL,
    "status" "SeatOrderStatus" NOT NULL DEFAULT 'PENDING',
    "buyerNote" TEXT,
    "adminNote" TEXT,
    "ownerNotifiedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "summary" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_agencyCode_key" ON "User"("agencyCode");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_parentId_idx" ON "User"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_expiresAt_idx" ON "Subscription"("userId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Havale_serial_key" ON "Havale"("serial");

-- CreateIndex
CREATE INDEX "Havale_status_closesAt_idx" ON "Havale"("status", "closesAt");

-- CreateIndex
CREATE INDEX "Havale_deletedAt_idx" ON "Havale"("deletedAt");

-- CreateIndex
CREATE INDEX "Havale_kind_status_createdAt_idx" ON "Havale"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Havale_ownerId_kind_status_idx" ON "Havale"("ownerId", "kind", "status");

-- CreateIndex
CREATE INDEX "Havale_carType_carColor_idx" ON "Havale"("carType", "carColor");

-- CreateIndex
CREATE INDEX "Havale_supplierCompany_idx" ON "Havale"("supplierCompany");

-- CreateIndex
CREATE INDEX "ContactReveal_viewerId_createdAt_idx" ON "ContactReveal"("viewerId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactReveal_havaleId_createdAt_idx" ON "ContactReveal"("havaleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactReveal_havaleId_viewerId_key" ON "ContactReveal"("havaleId", "viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationReport_serial_key" ON "ViolationReport"("serial");

-- CreateIndex
CREATE INDEX "ViolationReport_status_createdAt_idx" ON "ViolationReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ViolationReport_reporterId_createdAt_idx" ON "ViolationReport"("reporterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationReport_havaleId_reporterId_key" ON "ViolationReport"("havaleId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_serial_key" ON "Ticket"("serial");

-- CreateIndex
CREATE INDEX "Ticket_status_lastReplyAt_idx" ON "Ticket"("status", "lastReplyAt");

-- CreateIndex
CREATE INDEX "Ticket_userId_createdAt_idx" ON "Ticket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_endedAt_idx" ON "AuthSession"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_createdAt_idx" ON "OtpChallenge"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeatOrder_serial_key" ON "SeatOrder"("serial");

-- CreateIndex
CREATE INDEX "SeatOrder_status_createdAt_idx" ON "SeatOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SeatOrder_buyerId_createdAt_idx" ON "SeatOrder"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_action_createdAt_idx" ON "ActivityLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Havale" ADD CONSTRAINT "Havale_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactReveal" ADD CONSTRAINT "ContactReveal_havaleId_fkey" FOREIGN KEY ("havaleId") REFERENCES "Havale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactReveal" ADD CONSTRAINT "ContactReveal_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationReport" ADD CONSTRAINT "ViolationReport_havaleId_fkey" FOREIGN KEY ("havaleId") REFERENCES "Havale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationReport" ADD CONSTRAINT "ViolationReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationReport" ADD CONSTRAINT "ViolationReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatOrder" ADD CONSTRAINT "SeatOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatOrder" ADD CONSTRAINT "SeatOrder_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
