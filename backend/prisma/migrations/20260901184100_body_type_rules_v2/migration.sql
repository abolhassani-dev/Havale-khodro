-- The first classification pass carried real mistakes (رنجرور and لوانته read
-- as pickups, مونزا as an SUV, and some three hundred models it did not know).
-- The rules were reviewed against the whole catalogue and rewritten; but the
-- boot classifier only ever writes into NULL, so rows already stamped by the
-- old rules would keep their wrong answer forever. Clear the column once and
-- let the next boot refill every row with the corrected rules. Any admin edit
-- made in the few days the column existed is cleared with it — an accepted,
-- one-time cost of correcting the bulk verdicts.
UPDATE "CarModel" SET "bodyType" = NULL;
