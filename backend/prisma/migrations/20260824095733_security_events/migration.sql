-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "ip" TEXT NOT NULL,
    "sample" TEXT,
    "path" TEXT,
    "method" TEXT,
    "userAgent" TEXT,
    "userId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedIp" (
    "ip" TEXT NOT NULL,
    "reason" TEXT,
    "until" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedIp_pkey" PRIMARY KEY ("ip")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEvent_fingerprint_key" ON "SecurityEvent"("fingerprint");

-- CreateIndex
CREATE INDEX "SecurityEvent_lastSeen_idx" ON "SecurityEvent"("lastSeen");

-- CreateIndex
CREATE INDEX "SecurityEvent_rule_lastSeen_idx" ON "SecurityEvent"("rule", "lastSeen");

-- CreateIndex
CREATE INDEX "SecurityEvent_ip_lastSeen_idx" ON "SecurityEvent"("ip", "lastSeen");

-- CreateIndex
CREATE INDEX "SecurityEvent_resolvedAt_lastSeen_idx" ON "SecurityEvent"("resolvedAt", "lastSeen");

-- CreateIndex
CREATE INDEX "BlockedIp_until_idx" ON "BlockedIp"("until");

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
