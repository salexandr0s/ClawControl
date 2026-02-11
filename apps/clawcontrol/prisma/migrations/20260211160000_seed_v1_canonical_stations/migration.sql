-- Seed canonical station set for workflow-only v1 defaults.
INSERT OR IGNORE INTO "stations" (
  "id",
  "name",
  "icon",
  "description",
  "color",
  "sort_order",
  "created_at",
  "updated_at"
)
VALUES
  ('strategic', 'strategic', 'star', 'Strategic interface and executive direction', NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('orchestration', 'orchestration', 'map', 'Workflow orchestration and stage routing', NULL, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('spec', 'spec', 'file-text', 'Planning and specification', NULL, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('build', 'build', 'hammer', 'Implementation and coding', NULL, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('qa', 'qa', 'check-circle', 'Quality assurance and review', NULL, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('security', 'security', 'shield-check', 'Security review and risk control', NULL, 35, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ops', 'ops', 'settings', 'Operations and deployment', NULL, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ship', 'ship', 'zap', 'Release and rollout', NULL, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('compound', 'compound', 'brain', 'Learning and synthesis', NULL, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('update', 'update', 'wrench', 'Maintenance and updates', NULL, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

