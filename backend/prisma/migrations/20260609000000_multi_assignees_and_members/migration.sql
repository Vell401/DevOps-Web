-- Multi-assignee on tasks + explicit project members.

-- 1) New ActivityType enum values for granular logging of multi-assignee changes.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ASSIGNEE_ADDED' AFTER 'ASSIGNEE_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'ASSIGNEE_REMOVED' AFTER 'ASSIGNEE_ADDED';

-- 2) Task assignees: many-to-many.
CREATE TABLE "_TaskAssignees" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_TaskAssignees_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_TaskAssignees_B_index" ON "_TaskAssignees"("B");

-- Migrate existing Task.assigneeId into the new join table BEFORE dropping the column.
INSERT INTO "_TaskAssignees" ("A","B")
SELECT id, "assigneeId" FROM "Task" WHERE "assigneeId" IS NOT NULL;

ALTER TABLE "_TaskAssignees" ADD CONSTRAINT "_TaskAssignees_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TaskAssignees" ADD CONSTRAINT "_TaskAssignees_B_fkey"
  FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the old single-assignee column.
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_assigneeId_fkey";
DROP INDEX IF EXISTS "Task_assigneeId_idx";
ALTER TABLE "Task" DROP COLUMN "assigneeId";

-- 3) Project members: many-to-many.
CREATE TABLE "_ProjectMembers" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_ProjectMembers_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_ProjectMembers_B_index" ON "_ProjectMembers"("B");
ALTER TABLE "_ProjectMembers" ADD CONSTRAINT "_ProjectMembers_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProjectMembers" ADD CONSTRAINT "_ProjectMembers_B_fkey"
  FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
