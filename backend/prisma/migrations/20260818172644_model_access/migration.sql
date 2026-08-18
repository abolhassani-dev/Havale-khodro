-- CreateTable
CREATE TABLE "ModelAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "carModelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelAccess_userId_idx" ON "ModelAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelAccess_userId_carModelId_key" ON "ModelAccess"("userId", "carModelId");

-- AddForeignKey
ALTER TABLE "ModelAccess" ADD CONSTRAINT "ModelAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAccess" ADD CONSTRAINT "ModelAccess_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "CarModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
