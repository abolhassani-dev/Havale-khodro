-- The catalogue↔price-list link is withdrawn.
--
-- It existed only to put a market figure on a car advertisement. That feature
-- was dropped, and the two lists are better off apart: «قیمت روز خودروها»
-- shows the source's own rows, named the way the source names them, and the
-- catalogue stays the catalogue. Nothing else ever read these columns.
--
-- IF EXISTS throughout, because the migration that added them may not have
-- reached every database yet.

DROP INDEX IF EXISTS "CarModel_priceKey_idx";
DROP INDEX IF EXISTS "CarPriceItem_familyKey_idx";

ALTER TABLE "CarModel" DROP COLUMN IF EXISTS "priceKey";
ALTER TABLE "CarModel" DROP COLUMN IF EXISTS "priceKeyLocked";
ALTER TABLE "CarPriceItem" DROP COLUMN IF EXISTS "familyKey";
