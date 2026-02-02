# AGENTS.md - Global Operating Invariants

**Version**: 1.0
**Last Updated**: 2026-02-01

This document defines the non-negotiable operating rules for all agents in the SAVORG system. Every agent must load and follow these invariants.

---

## 1. Single Mouthpiece

**Only savorgCEO communicates with the human user.**

- Internal agents (savorgBUILD, savorgOPS, savorgQA, etc.) write to Mission Control, not directly to users.
- All user-facing messages flow through savorgCEO.
- No agent may send Discord/Telegram messages directly except savorgCEO.

---

## 2. Local-First Truth

**Mission Control's local database is the shared brain.**

- All Work Orders, Operations, Artifacts, and Receipts live in SQLite.
- OpenClaw is the executor; Mission Control is the orchestrator.
- Never store critical state only in OpenClaw sessions.
- If in doubt, write it to the database.

---

## 3. Silent Success

**No noise unless actionable.**

- Don't notify on routine success.
- Only surface: failures, blocked items, required approvals, incidents.
- Activity feed captures everything; notifications are selective.

---

## 4. Side-Effect Gating

**External side effects require explicit Approval records.**

Gated actions include:

- Deploying to production
- Editing production cron jobs
- Destructive repairs (doctor --fix, reset)
- Sending messages to users
- Modifying AGENTS.md or global skills
- Installing/enabling plugins

**Workflow**:

1. Agent requests approval via Mission Control
2. User reviews and approves/rejects
3. Agent proceeds only after approval

---

## 5. Receipts Everywhere

**Every run, playbook step, cron action, or repair produces a receipt.**

Receipts include:

- Exit code
- Duration (ms)
- stdout/stderr excerpts (max 32KB each)
- Parsed JSON (if applicable)
- Start/end timestamps

**No silent operations.** If it ran, there's a receipt.

---

## 6. Safety by Allowlist

**UI buttons cannot run arbitrary shell commands.**

- Only allowlisted command templates may execute.
- Each template has a risk level: `safe`, `caution`, `danger`.
- `danger` templates require approval + typed confirmation.

**Never**:

- Execute user-provided shell strings directly
- Bypass the command template system
- Run commands without creating receipts

---

## 7. Graceful Degradation

**If OpenClaw telemetry breaks, Mission Control UI stays usable.**

- Live View disables gracefully with clear message
- Activity feed continues locally
- Maintenance buttons show "Gateway unavailable" state
- No crashes or blank screens

---

## 8. State Machine Enforcement

**Work Order and Operation transitions are strict.**

### Work Order States

```
planned → active
active → blocked | review | shipped | cancelled
blocked → active | cancelled
review → active | shipped
shipped → (terminal)
cancelled → (terminal)
```

### Operation States

```
todo → in_progress | blocked
in_progress → review | done | blocked | rework
review → done | rework
blocked → todo | in_progress
rework → todo | in_progress
done → (terminal)
```

**Invalid transitions must fail with TRANSITION_INVALID error.**

---

## 9. Agent Naming Convention

**All agents follow the naming pattern: `savorg` + ROLE**

- Prefix `savorg` is always lowercase
- ROLE is uppercase ASCII A-Z and digits only
- No spaces, hyphens, or underscores
- Max length: 20 characters

**Examples**: `savorgBUILD`, `savorgQA`, `savorgOPS`, `savorgUPDATE`

---

## 10. WIP Limits

**Each station has Work-In-Progress limits.**

- Default WIP limit: 1-2 per agent
- Agents pull eligible operations on heartbeat
- Do not exceed WIP limit
- Blocked operations don't count against WIP

---

## 11. Memory & Files

**Agents operate within defined boundaries.**

- Read/write only within workspace
- No access to user home directory except workspace
- No network access without explicit capability
- Log all file operations to receipts

---

## 12. Output Discipline

**Agents produce structured, parseable output.**

- Use JSON for machine-readable output
- Use Markdown for human-readable docs
- Keep logs concise and scannable
- Never dump raw stack traces to users

---

## 13. Heartbeat Protocol

**Agents with heartbeats must check in regularly.**

- Default interval: 5 minutes
- Heartbeat checks:
  - Can connect to Mission Control
  - Can read assigned operations
  - Can write receipts
- Missed heartbeats trigger alerts

---

## 14. Compounding Requirement

**Every shipped Work Order produces a Compound doc.**

Location: `docs/compounds/WO-####-<slug>.md`

Required sections:

- Problem + Context
- What changed
- Gotchas / failure modes
- Debug steps that worked
- New tests/checks to add

---

## 15. Protected Files

**Certain files require approval to modify:**

- `AGENTS.md` (this file)
- `agents/*.md` overlays
- Global skills (`skills/*/SKILL.md`)
- Command templates
- Playbooks

**Modification workflow**:

1. Generate diff preview
2. Request approval
3. Typed confirmation for dangerous changes
4. Apply change
5. Create activity record

---

## Loading Order

Agents must load configuration in this order:

1. `AGENTS.md` (this file) - global invariants
2. `agents/<agentName>.md` - role overlay
3. `agents/<agentName>/SOUL.md` - persona (optional)
4. `agents/<agentName>/HEARTBEAT.md` - heartbeat checklist

---

*These invariants are non-negotiable. Violations should be logged as activities and may trigger incident Work Orders.*
