-- #425: tapered ball end mills, with an angle per side.
ALTER TYPE "ToolType" ADD VALUE 'tapered_ball_end_mill';
ALTER TABLE "tool" ADD COLUMN "taperAngle" DOUBLE PRECISION;
