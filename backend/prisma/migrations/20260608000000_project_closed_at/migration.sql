-- Add nullable closedAt to Project. null = active, timestamp = closed at that moment.
ALTER TABLE "Project" ADD COLUMN "closedAt" TIMESTAMP(3);
CREATE INDEX "Project_closedAt_idx" ON "Project"("closedAt");
