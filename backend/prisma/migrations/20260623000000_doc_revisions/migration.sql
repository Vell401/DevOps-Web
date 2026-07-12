-- CreateTable
CREATE TABLE "DocPageRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "editorId" TEXT,
    "title" TEXT NOT NULL,
    "content" JSONB,
    "contentText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocPageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocPageRevision_pageId_createdAt_idx" ON "DocPageRevision"("pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "DocPageRevision" ADD CONSTRAINT "DocPageRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPageRevision" ADD CONSTRAINT "DocPageRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

