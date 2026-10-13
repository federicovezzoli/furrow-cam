-- AlterTable
ALTER TABLE "project" ADD COLUMN     "machineName" TEXT;

-- Backfill from the documents' machine snapshots.
UPDATE "project" SET "machineName" = "document" #>> '{machine,name}';
