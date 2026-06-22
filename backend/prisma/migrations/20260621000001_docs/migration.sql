-- CreateEnum
CREATE TYPE "DocRole" AS ENUM ('READER', 'WRITER');

-- CreateTable
CREATE TABLE "DocSpace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocSpaceMember" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "DocRole" NOT NULL DEFAULT 'WRITER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocSpaceMember_pkey" PRIMARY KEY ("spaceId","userId")
);

-- CreateTable
CREATE TABLE "DocPage" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "icon" TEXT,
    "content" JSONB,
    "contentText" TEXT NOT NULL DEFAULT '',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocImage" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocSpace_ownerId_idx" ON "DocSpace"("ownerId");

-- CreateIndex
CREATE INDEX "DocSpaceMember_userId_idx" ON "DocSpaceMember"("userId");

-- CreateIndex
CREATE INDEX "DocPage_spaceId_parentId_idx" ON "DocPage"("spaceId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocImage_key_key" ON "DocImage"("key");

-- CreateIndex
CREATE INDEX "DocImage_pageId_idx" ON "DocImage"("pageId");

-- AddForeignKey
ALTER TABLE "DocSpace" ADD CONSTRAINT "DocSpace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocSpaceMember" ADD CONSTRAINT "DocSpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "DocSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocSpaceMember" ADD CONSTRAINT "DocSpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "DocSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocImage" ADD CONSTRAINT "DocImage_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocImage" ADD CONSTRAINT "DocImage_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

