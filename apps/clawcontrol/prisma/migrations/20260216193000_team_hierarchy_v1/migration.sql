-- Team hierarchy v1 foundation:
-- - agents.template_id (links runtime agent back to template member)
-- - agent_teams.hierarchy_json (team-level editable hierarchy snapshot)

ALTER TABLE "agents" ADD COLUMN "template_id" TEXT;
CREATE INDEX IF NOT EXISTS "agents_template_id_idx" ON "agents"("template_id");

ALTER TABLE "agent_teams" ADD COLUMN "hierarchy_json" TEXT NOT NULL DEFAULT '{"version":1,"members":{}}';

-- Best-effort backfill for template_id:
-- infer from team.template_ids + agent.slug match when available.
UPDATE "agents"
SET "template_id" = "slug"
WHERE ("template_id" IS NULL OR trim("template_id") = '')
  AND "team_id" IS NOT NULL
  AND "slug" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "agent_teams" t, json_each(
      CASE
        WHEN json_valid(t."template_ids") THEN t."template_ids"
        ELSE '[]'
      END
    ) jt
    WHERE t."id" = "agents"."team_id"
      AND lower(trim(CAST(jt.value AS TEXT))) = lower(trim("agents"."slug"))
  );

-- Backfill hierarchy_json for existing teams with empty member shells keyed by templateIds.
UPDATE "agent_teams"
SET "hierarchy_json" = json_object(
  'version', 1,
  'members', COALESCE((
    SELECT json_group_object(
      CAST(jt.value AS TEXT),
      json_object(
        'reportsTo', NULL,
        'delegatesTo', json('[]'),
        'receivesFrom', json('[]'),
        'canMessage', json('[]'),
        'capabilities', json('{}')
      )
    )
    FROM json_each(
      CASE
        WHEN json_valid("agent_teams"."template_ids") THEN "agent_teams"."template_ids"
        ELSE '[]'
      END
    ) jt
  ), json('{}'))
)
WHERE "hierarchy_json" IS NULL
  OR trim("hierarchy_json") = ''
  OR "hierarchy_json" = '{"version":1,"members":{}}';
