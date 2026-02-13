# Packages and Marketplace Artifacts

Last updated: 2026-02-13

ClawControl supports portable package artifacts for import/deploy/export flows.

## 1. Package Format

Extension:

- `.clawpack.zip`

Required root manifest:

- `clawcontrol-package.yaml`

Supported package kinds:

- `agent_template`
- `agent_team`
- `workflow`
- `team_with_workflows`

## 2. Supported Package Contents

Optional content folders:

- `agent-templates/<templateId>/...`
- `workflows/<workflowId>.yaml`
- `teams/<teamId>.yaml`
- `selection/workflow-selection.yaml`
- `marketplace/listing.yaml` (optional listing metadata for marketplace ingestion)

Notes:

- Do not attempt to package or replace the OpenClaw runtime agent `main`. ClawControl treats `main` as the default CEO inbox and scaffolds `agents/main/*` create-if-missing.

## 3. Import / Deploy Flow

Package flow is two-step:

1. Analyze package (`/api/packages/import`)
2. Deploy staged package (`/api/packages/deploy`)

Analyze reports:

- manifest metadata
- discovered artifact counts
- conflict detection (templates/workflows/teams)
- temporary stage id for deployment

Deploy supports scoped application toggles:

- templates
- workflows
- teams
- selection

## 4. Rollback Behavior

Deployment is best-effort transactional:

- template filesystem writes are rolled back on failure
- created workflows/teams are reverted when possible
- previous selection overlay is restored if selection deployment fails

## 5. Export

You can export package artifacts from API:

- `GET /api/packages/:id/export?kind=workflow`
- `GET /api/packages/:id/export?kind=agent_template`
- `GET /api/packages/:id/export?kind=agent_team`
- `GET /api/packages/:id/export?kind=team_with_workflows`

Exported packages include:

- `clawcontrol-package.yaml` (runtime manifest)
- `marketplace/listing.yaml` (optional marketplace sidecar metadata)

## 6. Security and Governance

All mutating package routes require:

- operator session + CSRF
- governor action policy (`package.import`, `package.deploy`, `package.export`)

## 7. Workspace History

Package analyze/deploy/export events are recorded under:

- `/workflow-packages/history/*.json`

These records are local operational traces for auditability and debugging.
