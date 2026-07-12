-- Replace the standalone Task(projectId) index with a composite (projectId,
-- status) one. The composite serves the hot per-project status filters (the
-- DONE roll-up on the project list, close()/syncClosureState counts) and still
-- covers projectId-only lookups via its left prefix, so the standalone index
-- was redundant. The status-only index (Task_status_idx) is kept for global
-- status filters.

-- DropIndex
DROP INDEX "Task_projectId_idx";

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");
