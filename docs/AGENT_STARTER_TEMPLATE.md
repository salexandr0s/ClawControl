# Agent Starter Template (Phase 1)

Last Updated: 2026-02-08

This starter template lets a fresh ClawControl workspace generate a complete governance and agent markdown contract in one run.

## Generate

```bash
npm run init:agents -- --prefix <org-prefix> --owner "<owner-name>" --force
```

Example:

```bash
npm run init:agents -- --prefix team --owner "Workspace Owner" --force
```

## Validate

```bash
npm run check:agent-docs
```

Optional strict stale-context check:

```bash
npm run check:agent-docs -- --max-context-age-days 14 --fail-on-stale
```

## Generated Global Docs

- `AGENTS.md`
- `SOUL.md`
- `HEARTBEAT.md`
- `ACCESS.md`
- `CONTEXT.md`
- `agents/SOUL.md`
- `agents/HEARTBEAT.md`

## Generated Per-Agent Docs (for each enabled role)

- `agents/<role>.md` (role overlay/prompt)
- `agents/<role>/SOUL.md`
- `agents/<role>/HEARTBEAT.md`
- `agents/<role>/ONBOARDING.md`
- `agents/<role>/CAPABILITIES.md`
- `agents/<role>/MEMORY.md`
- `agents/<role>/WORKING.md`
- `agents/<role>/ANNOUNCEMENT.md`
- `agents/<role>/.learnings/LEARNINGS.md`

## Notes

- `ACCESS.md` and `CONTEXT.md` include required metadata fields (`Last Updated`, `Updated By`, `Source of Truth`).
- The generator uses role defaults from `scripts/init-agents.mjs`; override via manifest where needed.
- This template is intentionally opinionated. Tune constraints, tool policies, and output formats after generation.
