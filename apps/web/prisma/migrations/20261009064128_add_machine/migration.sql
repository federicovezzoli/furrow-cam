-- CreateEnum
CREATE TYPE "PostProcessor" AS ENUM ('grbl');

-- CreateTable
CREATE TABLE "machine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workAreaX" DOUBLE PRECISION NOT NULL,
    "workAreaY" DOUBLE PRECISION NOT NULL,
    "workAreaZ" DOUBLE PRECISION NOT NULL,
    "maxFeedXY" DOUBLE PRECISION NOT NULL,
    "maxFeedZ" DOUBLE PRECISION NOT NULL,
    "spindleRpmMin" INTEGER,
    "spindleRpmMax" INTEGER,
    "safeZ" DOUBLE PRECISION NOT NULL,
    "postProcessor" "PostProcessor" NOT NULL,
    "programStart" TEXT,
    "programEnd" TEXT,
    "operationStart" TEXT,
    "toolChange" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "machine_userId_idx" ON "machine"("userId");

-- AddForeignKey
ALTER TABLE "machine" ADD CONSTRAINT "machine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
