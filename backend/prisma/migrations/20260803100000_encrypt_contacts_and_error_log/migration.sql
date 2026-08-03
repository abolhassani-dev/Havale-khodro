-- Contact columns move to encryption at rest, and errors get a table.
--
-- The unique constraint moves from `phone` to `phoneIndex`: the encrypted
-- column holds a different ciphertext every time the same number is written,
-- so uniqueness on it would be meaningless. The blind index is deterministic
-- and keyed, which is exactly what a unique constraint needs.
--
-- Existing rows still hold plaintext after this runs. scripts/encrypt-existing.js
-- converts them; it is idempotent and the entrypoint runs it on every start.

-- DropIndex
DROP INDEX "User_phone_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneIndex" TEXT;

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'error',
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "path" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "requestId" TEXT,
    "userId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorLog_lastSeen_idx" ON "ErrorLog"("lastSeen");

-- CreateIndex
CREATE INDEX "ErrorLog_resolvedAt_lastSeen_idx" ON "ErrorLog"("resolvedAt", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorLog_fingerprint_key" ON "ErrorLog"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneIndex_key" ON "User"("phoneIndex");

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
