-- Machines with a safe Z below 1 mm were backfilled above it; toolpaths used to cap the clearance there.
UPDATE "machine" SET "entryClearance" = "safeZ" WHERE "entryClearance" > "safeZ";
