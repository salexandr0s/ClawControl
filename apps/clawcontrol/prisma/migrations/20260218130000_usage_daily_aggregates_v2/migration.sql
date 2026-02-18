-- CreateTable
CREATE TABLE "session_usage_daily_aggregates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "model" TEXT,
    "day_start" DATETIME NOT NULL,
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
CREATE UNIQUE INDEX "session_usage_daily_aggregates_session_id_day_start_model_key_key" ON "session_usage_daily_aggregates"("session_id", "day_start", "model_key");

-- CreateIndex
CREATE INDEX "session_usage_daily_aggregates_day_start_idx" ON "session_usage_daily_aggregates"("day_start");

-- CreateIndex
CREATE INDEX "session_usage_daily_aggregates_day_start_agent_id_idx" ON "session_usage_daily_aggregates"("day_start", "agent_id");

-- CreateIndex
CREATE INDEX "session_usage_daily_aggregates_day_start_model_key_idx" ON "session_usage_daily_aggregates"("day_start", "model_key");
