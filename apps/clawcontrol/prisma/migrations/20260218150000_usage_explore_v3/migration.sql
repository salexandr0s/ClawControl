-- AlterTable
ALTER TABLE "session_usage_aggregates" ADD COLUMN "session_key" TEXT;
ALTER TABLE "session_usage_aggregates" ADD COLUMN "source" TEXT;
ALTER TABLE "session_usage_aggregates" ADD COLUMN "channel" TEXT;
ALTER TABLE "session_usage_aggregates" ADD COLUMN "session_kind" TEXT;
ALTER TABLE "session_usage_aggregates" ADD COLUMN "session_class" TEXT;
ALTER TABLE "session_usage_aggregates" ADD COLUMN "provider_key" TEXT;
ALTER TABLE "session_usage_aggregates" ADD COLUMN "operation_id" TEXT;
ALTER TABLE "session_usage_aggregates" ADD COLUMN "work_order_id" TEXT;

-- CreateIndex
CREATE INDEX "session_usage_aggregates_provider_key_last_seen_at_idx" ON "session_usage_aggregates"("provider_key", "last_seen_at");
CREATE INDEX "session_usage_aggregates_source_last_seen_at_idx" ON "session_usage_aggregates"("source", "last_seen_at");
CREATE INDEX "session_usage_aggregates_channel_last_seen_at_idx" ON "session_usage_aggregates"("channel", "last_seen_at");
CREATE INDEX "session_usage_aggregates_session_kind_last_seen_at_idx" ON "session_usage_aggregates"("session_kind", "last_seen_at");
CREATE INDEX "session_usage_aggregates_session_class_last_seen_at_idx" ON "session_usage_aggregates"("session_class", "last_seen_at");
CREATE INDEX "session_usage_aggregates_operation_id_idx" ON "session_usage_aggregates"("operation_id");
CREATE INDEX "session_usage_aggregates_work_order_id_idx" ON "session_usage_aggregates"("work_order_id");

-- CreateTable
CREATE TABLE "session_usage_hourly_aggregates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "model" TEXT,
    "hour_start" DATETIME NOT NULL,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_read_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_write_tokens" BIGINT NOT NULL DEFAULT 0,
    "total_tokens" BIGINT NOT NULL DEFAULT 0,
    "total_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "session_usage_hourly_aggregates_session_id_hour_start_model_key_key" ON "session_usage_hourly_aggregates"("session_id", "hour_start", "model_key");
CREATE INDEX "session_usage_hourly_aggregates_hour_start_idx" ON "session_usage_hourly_aggregates"("hour_start");
CREATE INDEX "session_usage_hourly_aggregates_hour_start_agent_id_idx" ON "session_usage_hourly_aggregates"("hour_start", "agent_id");
CREATE INDEX "session_usage_hourly_aggregates_hour_start_model_key_idx" ON "session_usage_hourly_aggregates"("hour_start", "model_key");

-- CreateTable
CREATE TABLE "session_tool_usage_daily_aggregates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "day_start" DATETIME NOT NULL,
    "tool_name" TEXT NOT NULL,
    "call_count" BIGINT NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "session_tool_usage_daily_aggregates_session_id_day_start_tool_name_key" ON "session_tool_usage_daily_aggregates"("session_id", "day_start", "tool_name");
CREATE INDEX "session_tool_usage_daily_aggregates_day_start_idx" ON "session_tool_usage_daily_aggregates"("day_start");
CREATE INDEX "session_tool_usage_daily_aggregates_tool_name_day_start_idx" ON "session_tool_usage_daily_aggregates"("tool_name", "day_start");
