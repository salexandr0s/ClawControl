-- Add avatar_path and model columns to agents table
ALTER TABLE "agents" ADD COLUMN "avatar_path" TEXT;
ALTER TABLE "agents" ADD COLUMN "model" TEXT DEFAULT 'claude-sonnet-4-20250514';
