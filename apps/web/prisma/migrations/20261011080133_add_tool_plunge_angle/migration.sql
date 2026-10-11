-- AlterTable: existing bits keep plunging straight down until the user edits them.
ALTER TABLE "tool" ADD COLUMN     "plungeAngle" DOUBLE PRECISION NOT NULL DEFAULT 90;
ALTER TABLE "tool" ALTER COLUMN "plungeAngle" DROP DEFAULT;
