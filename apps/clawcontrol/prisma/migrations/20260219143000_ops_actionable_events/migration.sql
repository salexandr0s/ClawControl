-- CreateTable
CREATE TABLE "ops_actionable_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "job_id" TEXT,
    "job_name" TEXT,
    "run_at_ms" BIGINT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "decision_required" BOOLEAN NOT NULL DEFAULT true,
    "summary" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "evidence_json" TEXT NOT NULL DEFAULT '{}',
    "work_order_id" TEXT,
    "relayed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_actionable_events_fingerprint_key" ON "ops_actionable_events"("fingerprint");
CREATE INDEX "ops_actionable_events_relayed_at_idx" ON "ops_actionable_events"("relayed_at");
CREATE INDEX "ops_actionable_events_work_order_id_idx" ON "ops_actionable_events"("work_order_id");
CREATE INDEX "ops_actionable_events_created_at_idx" ON "ops_actionable_events"("created_at");
CREATE INDEX "ops_actionable_events_severity_idx" ON "ops_actionable_events"("severity");
