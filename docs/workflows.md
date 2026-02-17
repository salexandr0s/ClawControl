# ClawControl Workflows

Last updated: 2026-02-17

This document describes how workflows work in ClawControl and how users manage them.

## 1. What a Workflow Is

A workflow is a YAML-defined execution plan used by the manager stage engine.

Workflows reference **specialist agents** only. The CEO is not represented inside workflow YAML.
By default, ClawControl treats the OpenClaw runtime agent `main` as the CEO inbox (escalation/notification target).

Each workflow includes:

- `id`
- `description`
- ordered `stages`

Each stage defines the assigned agent role, optional gating/loop-back behavior, and optional loop configuration.

## 2. Built-in vs Custom Workflows

ClawControl loads workflows from two sources:

- Built-in (shipped in app config): read-only
- Custom (workspace `/workflows/*.yaml`): editable

Rules:

- Built-in workflows cannot be edited/deleted.
- Built-ins can be cloned to create editable custom versions.
- Custom workflow IDs must be unique across both sources.

## 3. Selection Rules

Selection rules are deterministic and loaded from:

- built-in `config/workflow-selection.yaml`
- optional workspace override `/workflows/workflow-selection.yaml`

Resolution order:

1. explicit requested workflow ID
2. first matching rule (with precedence ordering)
3. default workflow fallback

## 4. Manager Engine Contract

All non-system work executes via:

`work order -> workflow stage -> operation -> completion -> next stage`

The engine reads workflow definitions at runtime from the merged registry (built-in + custom).

## 5. Workspace Snapshot Files

On workflow/selection changes, ClawControl writes merged snapshots to workspace:

- `/workflows/clawcontrol-resolved-workflows.yaml`
- `/workflows/clawcontrol-resolved-selection.yaml`

These are portability/interoperability snapshots and should be treated as generated files.

## 6. UI Surface

Use the **Workflows** tab to:

- list workflows
- inspect stages and usage
- create/edit custom workflows
- clone built-ins
- import workflow YAML
- export workflow YAML or package artifacts

## 7. API Endpoints

Main endpoints:

- `GET /api/workflows`
- `GET /api/workflows/:id`
- `POST /api/workflows`
- `PATCH /api/workflows/:id`
- `DELETE /api/workflows/:id`
- `POST /api/workflows/:id/clone`
- `POST /api/workflows/import`
- `GET /api/workflows/:id/export`
- `GET /api/workflows/selection`
- `PUT /api/workflows/selection`

Mutating routes require operator session + CSRF and governor policy enforcement.

## 8. Dispatch Compatibility (OpenClaw CLI)

Workflow stage dispatch uses OpenClaw with compatibility modes controlled by:

- `CLAWCONTROL_OPENCLAW_DISPATCH_MODE=auto` (default): try `openclaw run`, fallback to `openclaw agent --local` when `run` is unavailable.
- `CLAWCONTROL_OPENCLAW_DISPATCH_MODE=run`: force the `run` command path.
- `CLAWCONTROL_OPENCLAW_DISPATCH_MODE=agent_local`: force `agent --local` dispatch.

For `agent_local`, ClawControl sends a deterministic `--session-id` and requires a non-null session id in command output. If no session id is returned, dispatch fails and the operation is blocked.

## 9. Strict Live Workflow Validation

ClawControl includes a strict desktop-runtime harness that resets workorder runtime state, seeds starter workflows, runs real workorders end-to-end, and enforces dispatch/session integrity.

### Commands

```bash
npm run workflow:test:desktop
```

Supporting scripts:

- `scripts/reset-workorders-desktop.sql`
- `scripts/run-workflow-real-workorders.mjs`

### Strict checks

- no `workflow.dispatch_failed` events
- all `workflow.dispatched` events include non-null `sessionId`
- each workflow has real dispatch activity
- all runs end `work_order.state='shipped'`
- no blocked/cancelled runs and no pending approvals
- rework evidence for loop-capable workflows

### Report artifacts

The harness writes:

- `/Users/savorgserver/OpenClaw/tmp/workflow-test-report-<timestamp>.json`
- `/Users/savorgserver/OpenClaw/tmp/workflow-test-report-<timestamp>.md`
- `/Users/savorgserver/OpenClaw/tmp/workflow-test-server-<timestamp>.log`
