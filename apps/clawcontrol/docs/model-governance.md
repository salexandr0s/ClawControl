# Model Governance

## Locked policy
- `main`: `anthropic/claude-opus-4-6`
- `wf-ops`: `anthropic/claude-sonnet-4-6`
- Specialists: keep current configured model mix unless explicitly overridden.

## Drift check
Run:

```bash
cd /Users/savorgserver/OpenClaw/projects/ClawControl/apps/clawcontrol
DATABASE_URL=file:./data/clawcontrol.db node scripts/check-openclaw-model-policy.mjs
```

This compares runtime OpenClaw agent models (`~/.openclaw/openclaw.json`) vs ClawControl DB agent models and reports policy drift.
