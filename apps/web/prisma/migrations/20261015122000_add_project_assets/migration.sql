-- CreateTable
CREATE TABLE "project_asset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_asset_projectId_sha256_key" ON "project_asset"("projectId", "sha256");

-- AddForeignKey
ALTER TABLE "project_asset" ADD CONSTRAINT "project_asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
