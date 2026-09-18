-- «فقط شبکه‌ی من»: an advertisement may be limited to its owner's network
-- (the main agency and its sub-agencies). Every existing row stays public.
CREATE TYPE "ListingVisibility" AS ENUM ('PUBLIC', 'NETWORK');
ALTER TABLE "Listing" ADD COLUMN "visibility" "ListingVisibility" NOT NULL DEFAULT 'PUBLIC';
CREATE INDEX "Listing_visibility_idx" ON "Listing"("visibility");
