-- New notification kinds for assignment / status / due-date events.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'DUE_SOON';

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarKey" TEXT;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "commentId" TEXT;

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: explicit members of the old implicit M2M become EDITOR rows.
-- Owners are skipped — ownership lives on Project.ownerId, never as a member.
INSERT INTO "ProjectMember" ("projectId", "userId")
SELECT pm."A", pm."B"
FROM "_ProjectMembers" pm
JOIN "Project" p ON p."id" = pm."A"
WHERE pm."B" <> p."ownerId"
ON CONFLICT DO NOTHING;

-- Data migration: implicit members (assignees of any task in the project)
-- become explicit EDITOR rows, mirroring the new auto-add-on-assign rule.
INSERT INTO "ProjectMember" ("projectId", "userId")
SELECT DISTINCT t."projectId", ta."B"
FROM "_TaskAssignees" ta
JOIN "Task" t ON t."id" = ta."A"
JOIN "Project" p ON p."id" = t."projectId"
WHERE ta."B" <> p."ownerId"
ON CONFLICT DO NOTHING;

-- DropTable (the old implicit join table, fully replaced by ProjectMember)
DROP TABLE "_ProjectMembers";
