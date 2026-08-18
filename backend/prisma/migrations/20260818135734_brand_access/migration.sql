-- CreateTable
CREATE TABLE "BrandAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "brandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandAccess_userId_idx" ON "BrandAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandAccess_userId_companyId_key" ON "BrandAccess"("userId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandAccess_userId_brandId_key" ON "BrandAccess"("userId", "brandId");

-- AddForeignKey
ALTER TABLE "BrandAccess" ADD CONSTRAINT "BrandAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandAccess" ADD CONSTRAINT "BrandAccess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CarCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandAccess" ADD CONSTRAINT "BrandAccess_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "CarBrand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
