# Post-Install: ClawControl Core Pack

This pack installs:
- Agent templates (10)
- Workflows
- Team definition
- Workflow selection overlay

This pack **does not** auto-edit your workspace `AGENTS.md`.

## AGENTS.md snippet (copy/paste)

```md
## ClawControl Workflow Governance (Core Pack)

Hard rules:
- Workflow-only execution. Do not bypass the stage engine or gates.
- Build/UI/Ops work requires an approved PlanReview before starting.
- Security veto is final; no agent may override it.

Recommended agent hierarchy / stage agents:
- CEO inbox: main
- Orchestration + specialists:
  manager, research, plan, plan_review, build, build_review, ui, ui_review, security, ops

Per-agent workspace files (required):
- agents/<id>/SOUL.md
- agents/<id>/HEARTBEAT.md
- agents/<id>/MEMORY.md
- optional overlay: agents/<id>.md
```

## Instantiate Agents (materialize files)

After importing and deploying the pack:
1. Go to **Agents → Teams**.
2. Open the team installed by this pack.
3. Click **Instantiate Agents**.

This will create any missing agents and materialize required workspace files (create-if-missing):
- `/agents/<id>/SOUL.md`
- `/agents/<id>/HEARTBEAT.md`
- `/agents/<id>/MEMORY.md`
- optional: `/agents/<id>.md`

If you already have agents with the same slugs, ClawControl will **not** overwrite your existing files.
