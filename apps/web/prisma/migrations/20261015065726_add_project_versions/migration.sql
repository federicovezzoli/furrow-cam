-- CreateTable
CREATE TABLE "project_version" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT,
    "schemaVersion" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_version_projectId_createdAt_idx" ON "project_version"("projectId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
