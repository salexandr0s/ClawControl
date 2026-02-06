-- CreateTable
CREATE TABLE "usage_ingestion_cursors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_path" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "device_id" BIGINT NOT NULL,
    "inode" BIGINT NOT NULL,
    "offset_bytes" BIGINT NOT NULL DEFAULT 0,
    "file_mtime_ms" BIGINT NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "session_usage_aggregates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "model" TEXT,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_read_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_write_tokens" BIGINT NOT NULL DEFAULT 0,
    "total_tokens" BIGINT NOT NULL DEFAULT 0,
    "total_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "has_errors" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" DATETIME,
    "last_seen_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "session_tool_usage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "call_count" BIGINT NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "session_tool_usage_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session_usage_aggregates" ("session_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "error_ingestion_cursors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_path" TEXT NOT NULL,
    "device_id" BIGINT NOT NULL,
    "inode" BIGINT NOT NULL,
    "offset_bytes" BIGINT NOT NULL DEFAULT 0,
    "file_mtime_ms" BIGINT NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "error_signature_aggregates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signature_hash" TEXT NOT NULL,
    "signature_text" TEXT NOT NULL,
    "count" BIGINT NOT NULL DEFAULT 0,
    "first_seen_at" DATETIME NOT NULL,
    "last_seen_at" DATETIME NOT NULL,
    "last_sample_sanitized" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "error_daily_aggregates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" DATETIME NOT NULL,
    "count" BIGINT NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ingestion_leases" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "acquired_at" DATETIME NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_ingestion_cursors_source_path_key" ON "usage_ingestion_cursors"("source_path");

-- CreateIndex
CREATE INDEX "usage_ingestion_cursors_agent_id_idx" ON "usage_ingestion_cursors"("agent_id");

-- CreateIndex
CREATE INDEX "usage_ingestion_cursors_session_id_idx" ON "usage_ingestion_cursors"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_usage_aggregates_session_id_key" ON "session_usage_aggregates"("session_id");

-- CreateIndex
CREATE INDEX "session_usage_aggregates_agent_id_last_seen_at_idx" ON "session_usage_aggregates"("agent_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "session_usage_aggregates_model_last_seen_at_idx" ON "session_usage_aggregates"("model", "last_seen_at");

-- CreateIndex
CREATE INDEX "session_usage_aggregates_total_cost_micros_idx" ON "session_usage_aggregates"("total_cost_micros");

-- CreateIndex
CREATE INDEX "session_usage_aggregates_has_errors_idx" ON "session_usage_aggregates"("has_errors");

-- CreateIndex
CREATE INDEX "session_tool_usage_tool_name_idx" ON "session_tool_usage"("tool_name");

-- CreateIndex
CREATE INDEX "session_tool_usage_session_id_idx" ON "session_tool_usage"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_tool_usage_session_id_tool_name_key" ON "session_tool_usage"("session_id", "tool_name");

-- CreateIndex
CREATE UNIQUE INDEX "error_ingestion_cursors_source_path_key" ON "error_ingestion_cursors"("source_path");

-- CreateIndex
CREATE UNIQUE INDEX "error_signature_aggregates_signature_hash_key" ON "error_signature_aggregates"("signature_hash");

-- CreateIndex
CREATE INDEX "error_signature_aggregates_count_idx" ON "error_signature_aggregates"("count");

-- CreateIndex
CREATE INDEX "error_signature_aggregates_last_seen_at_idx" ON "error_signature_aggregates"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "error_daily_aggregates_day_key" ON "error_daily_aggregates"("day");

-- CreateIndex
CREATE INDEX "error_daily_aggregates_day_idx" ON "error_daily_aggregates"("day");

-- CreateIndex
CREATE INDEX "ingestion_leases_expires_at_idx" ON "ingestion_leases"("expires_at");

