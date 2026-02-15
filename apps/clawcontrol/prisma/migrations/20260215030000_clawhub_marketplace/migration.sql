-- ClawHub marketplace skill install tracking

CREATE TABLE IF NOT EXISTS "clawhub_skill_installs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "agent_id" TEXT,
  "source_url" TEXT NOT NULL,
  "install_method" TEXT NOT NULL,
  "manifest_hash" TEXT,
  "installed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "installed_by" TEXT NOT NULL DEFAULT 'user',
  "last_receipt_id" TEXT,
  "uninstalled_at" DATETIME,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clawhub_skill_installs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "clawhub_skill_installs_slug_scope_key_key" ON "clawhub_skill_installs"("slug", "scope_key");
CREATE INDEX IF NOT EXISTS "clawhub_skill_installs_slug_idx" ON "clawhub_skill_installs"("slug");
CREATE INDEX IF NOT EXISTS "clawhub_skill_installs_agent_id_idx" ON "clawhub_skill_installs"("agent_id");

