-- AlterTable
ALTER TABLE "tool" ADD COLUMN     "color" TEXT NOT NULL,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "tool_userId_default_key" ON "tool"("userId") WHERE ("isDefault");

