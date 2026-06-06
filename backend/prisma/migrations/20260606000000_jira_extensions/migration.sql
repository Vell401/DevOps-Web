-- Extend TaskStatus with extra workflow columns
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'BACKLOG' BEFORE 'TODO';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW' AFTER 'IN_PROGRESS';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'BLOCKED' AFTER 'IN_REVIEW';

-- Extend TaskPriority with URGENT
ALTER TYPE "TaskPriority" ADD VALUE IF NOT EXISTS 'URGENT' AFTER 'HIGH';

-- Notion-style colour palette for labels
CREATE TYPE "LabelColor" AS ENUM (
  'GRAY', 'BROWN', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'PINK', 'RED'
);

-- Activity log events
CREATE TYPE "ActivityType" AS ENUM (
  'CREATED', 'STATUS_CHANGED', 'ASSIGNEE_CHANGED', 'PRIORITY_CHANGED',
  'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'DUE_DATE_CHANGED',
  'LABEL_ADDED', 'LABEL_REMOVED', 'PARENT_CHANGED', 'COMMENT_ADDED'
);

-- User: optional avatar tint
ALTER TABLE "User" ADD COLUMN "avatarColor" TEXT NOT NULL DEFAULT 'gray';

-- Project: human-readable key + per-project task counter
ALTER TABLE "Project" ADD COLUMN "key" TEXT;
ALTER TABLE "Project" ADD COLUMN "taskCounter" INTEGER NOT NULL DEFAULT 0;
UPDATE "Project"
  SET "key" = 'P' || UPPER(SUBSTRING(REPLACE("id"::text, '-', ''), 1, 5))
  WHERE "key" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "key" SET NOT NULL;
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");

-- Task: subtasks, position, sequential number per project
ALTER TABLE "Task" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Task" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "number" INTEGER;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "createdAt", "id") AS rn
  FROM "Task"
)
UPDATE "Task" t SET "number" = n.rn FROM numbered n WHERE t.id = n.id;

ALTER TABLE "Task" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "Task_projectId_number_key" ON "Task"("projectId", "number");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill project task counters
UPDATE "Project" p SET "taskCounter" =
  COALESCE((SELECT MAX("number") FROM "Task" WHERE "projectId" = p."id"), 0);

-- Comment: track edits
ALTER TABLE "Comment" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Label
CREATE TABLE "Label" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" "LabelColor" NOT NULL DEFAULT 'GRAY',
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Label_projectId_idx" ON "Label"("projectId");
CREATE UNIQUE INDEX "Label_projectId_name_key" ON "Label"("projectId", "name");
ALTER TABLE "Label" ADD CONSTRAINT "Label_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Activity feed
CREATE TABLE "Activity" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "type" "ActivityType" NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Activity_taskId_idx" ON "Activity"("taskId");
CREATE INDEX "Activity_actorId_idx" ON "Activity"("actorId");
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TaskLabels join (implicit m2m: _LabelToTask)
CREATE TABLE "_TaskLabels" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,

  CONSTRAINT "_TaskLabels_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_TaskLabels_B_index" ON "_TaskLabels"("B");
ALTER TABLE "_TaskLabels" ADD CONSTRAINT "_TaskLabels_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TaskLabels" ADD CONSTRAINT "_TaskLabels_B_fkey"
  FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
