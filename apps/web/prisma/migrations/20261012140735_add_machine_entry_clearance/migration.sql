-- AlterTable: existing machines keep the fixed 1 mm entry clearance toolpaths used before.
ALTER TABLE "machine" ADD COLUMN     "entryClearance" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "machine" ALTER COLUMN "entryClearance" DROP DEFAULT;
