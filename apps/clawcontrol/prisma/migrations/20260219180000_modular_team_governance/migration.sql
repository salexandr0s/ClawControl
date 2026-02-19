-- AlterTable
ALTER TABLE "agent_teams" ADD COLUMN "governance_json" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ops_actionable_events" ADD COLUMN "team_id" TEXT;
ALTER TABLE "ops_actionable_events" ADD COLUMN "ops_runtime_agent_id" TEXT;
ALTER TABLE "ops_actionable_events" ADD COLUMN "relay_key" TEXT;

-- CreateIndex
CREATE INDEX "ops_actionable_events_team_id_idx" ON "ops_actionable_events"("team_id");
CREATE INDEX "ops_actionable_events_relay_key_idx" ON "ops_actionable_events"("relay_key");
