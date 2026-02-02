-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal_md" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'planned',
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "owner" TEXT NOT NULL DEFAULT 'user',
    "routing_template" TEXT NOT NULL DEFAULT 'default_routing',
    "blocked_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "shipped_at" DATETIME
);

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "work_order_id" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "assignee_agent_ids" TEXT NOT NULL DEFAULT '[]',
    "depends_on_operation_ids" TEXT NOT NULL DEFAULT '[]',
    "wip_class" TEXT NOT NULL DEFAULT 'implementation',
    "blocked_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "operations_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "session_key" TEXT NOT NULL,
    "capabilities" TEXT NOT NULL DEFAULT '{}',
    "wip_limit" INTEGER NOT NULL DEFAULT 2,
    "last_seen_at" DATETIME,
    "last_heartbeat_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "work_order_id" TEXT NOT NULL,
    "operation_id" TEXT,
    "type" TEXT NOT NULL,
    "question_md" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolved_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    CONSTRAINT "approvals_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "approvals_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "work_order_id" TEXT NOT NULL,
    "operation_id" TEXT,
    "kind" TEXT NOT NULL,
    "command_name" TEXT NOT NULL,
    "command_args_json" TEXT NOT NULL DEFAULT '{}',
    "exit_code" INTEGER,
    "duration_ms" INTEGER,
    "stdout_excerpt" TEXT NOT NULL DEFAULT '',
    "stderr_excerpt" TEXT NOT NULL DEFAULT '',
    "parsed_json" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" DATETIME,
    CONSTRAINT "receipts_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "receipts_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "work_order_id" TEXT NOT NULL,
    "operation_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path_or_url" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artifacts_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "work_order_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "agent_name" TEXT,
    "content" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "cron_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" DATETIME,
    "next_run_at" DATETIME,
    "last_status" TEXT,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "config_json" TEXT NOT NULL DEFAULT '{}',
    "last_used_at" DATETIME,
    "installed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "plugins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_json" TEXT NOT NULL DEFAULT '{}',
    "installed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_code_key" ON "work_orders"("code");

-- CreateIndex
CREATE INDEX "work_orders_state_idx" ON "work_orders"("state");

-- CreateIndex
CREATE INDEX "work_orders_priority_idx" ON "work_orders"("priority");

-- CreateIndex
CREATE INDEX "work_orders_owner_idx" ON "work_orders"("owner");

-- CreateIndex
CREATE INDEX "work_orders_created_at_idx" ON "work_orders"("created_at");

-- CreateIndex
CREATE INDEX "operations_work_order_id_idx" ON "operations"("work_order_id");

-- CreateIndex
CREATE INDEX "operations_status_idx" ON "operations"("status");

-- CreateIndex
CREATE INDEX "operations_station_idx" ON "operations"("station");

-- CreateIndex
CREATE UNIQUE INDEX "agents_name_key" ON "agents"("name");

-- CreateIndex
CREATE UNIQUE INDEX "agents_session_key_key" ON "agents"("session_key");

-- CreateIndex
CREATE INDEX "agents_status_idx" ON "agents"("status");

-- CreateIndex
CREATE INDEX "agents_station_idx" ON "agents"("station");

-- CreateIndex
CREATE INDEX "approvals_work_order_id_idx" ON "approvals"("work_order_id");

-- CreateIndex
CREATE INDEX "approvals_status_idx" ON "approvals"("status");

-- CreateIndex
CREATE INDEX "approvals_type_idx" ON "approvals"("type");

-- CreateIndex
CREATE INDEX "activities_ts_idx" ON "activities"("ts");

-- CreateIndex
CREATE INDEX "activities_type_idx" ON "activities"("type");

-- CreateIndex
CREATE INDEX "activities_entity_type_entity_id_idx" ON "activities"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "receipts_work_order_id_idx" ON "receipts"("work_order_id");

-- CreateIndex
CREATE INDEX "receipts_kind_idx" ON "receipts"("kind");

-- CreateIndex
CREATE INDEX "receipts_started_at_idx" ON "receipts"("started_at");

-- CreateIndex
CREATE INDEX "artifacts_work_order_id_idx" ON "artifacts"("work_order_id");

-- CreateIndex
CREATE INDEX "artifacts_type_idx" ON "artifacts"("type");

-- CreateIndex
CREATE INDEX "messages_work_order_id_idx" ON "messages"("work_order_id");

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_path_key" ON "documents"("path");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE UNIQUE INDEX "cron_jobs_name_key" ON "cron_jobs"("name");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE UNIQUE INDEX "plugins_name_key" ON "plugins"("name");
