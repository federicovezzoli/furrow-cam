-- AlterTable: existing machines get the default spin-up delay (#240), as new ones do.
ALTER TABLE "machine" ADD COLUMN     "spinUpDelay" DOUBLE PRECISION NOT NULL DEFAULT 5;
ALTER TABLE "machine" ALTER COLUMN "spinUpDelay" DROP DEFAULT;
