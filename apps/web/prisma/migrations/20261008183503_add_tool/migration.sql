-- CreateEnum
CREATE TYPE "ToolType" AS ENUM ('flat_end_mill', 'ball_end_mill', 'v_bit', 'drill');

-- CreateEnum
CREATE TYPE "CutDirection" AS ENUM ('upcut', 'downcut', 'compression');

-- CreateTable
CREATE TABLE "tool" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ToolType" NOT NULL,
    "diameter" DOUBLE PRECISION NOT NULL,
    "fluteCount" INTEGER NOT NULL,
    "fluteLength" DOUBLE PRECISION NOT NULL,
    "cutDirection" "CutDirection",
    "vAngle" DOUBLE PRECISION,
    "tipDiameter" DOUBLE PRECISION,
    "spindleRpm" INTEGER NOT NULL,
    "feedRate" DOUBLE PRECISION NOT NULL,
    "plungeRate" DOUBLE PRECISION NOT NULL,
    "stepDown" DOUBLE PRECISION NOT NULL,
    "stepOver" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tool_userId_idx" ON "tool"("userId");

-- AddForeignKey
ALTER TABLE "tool" ADD CONSTRAINT "tool_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
