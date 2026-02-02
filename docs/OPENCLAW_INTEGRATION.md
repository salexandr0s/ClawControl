# OpenClaw Integration

This document describes how SAVORG Mission Control integrates with [OpenClaw](https://github.com/openclaw/openclaw).

---

## Overview

OpenClaw is the CLI for orchestrating AI agents. Mission Control provides a visual interface on top of OpenClaw, enabling:

- **Visual work order management** — Track features through spec → build → QA → ship
- **Agent oversight** — Monitor agent status and execution in real-time
- **Approval gates** — Review and approve dangerous actions before execution
- **Audit trail** — Full history of all agent activities

---

## CLI Binary Support

Mission Control supports both CLI binary names:

- **`openclaw`** — New/current name
- **`clawdbot`** — Legacy name (still in use on some systems)

### Resolution Order

The binary is resolved at runtime with this priority:

1. **`OPENCLAW_BIN` environment variable** — Explicit override
2. **`openclaw --version`** — Try new name first
3. **`clawdbot --version`** — Fallback to legacy name
4. **Graceful degradation** — Demo mode if neither found

### Override via Environment

```bash
# Force a specific binary
OPENCLAW_BIN=clawdbot npm run dev

# Or in .env
OPENCLAW_BIN=clawdbot
```

### API Response

The maintenance API includes CLI info:

```json
{
  "cliBin": "clawdbot",
  "cliVersion": "1.2.3",
  "cliSource": "fallback"
}
```

---

## Detection

Mission Control detects the CLI binary at runtime:

```typescript
// packages/adapters-openclaw/src/resolve-bin.ts
const resolution = await resolveCliBin()
// { bin: 'clawdbot', version: '1.2.3', source: 'fallback' }
```

If neither binary is found:
- Mission Control runs in **demo mode** with mock data
- All features remain accessible for UI exploration
- No real commands are executed

---

## Command Allowlist

Mission Control only executes pre-approved commands. Commands are stored as args (without the binary name) and the resolved binary is prepended at runtime.

**Current Allowlist (18 commands):**

| Command Args | Description | Dangerous |
|--------------|-------------|-----------|
| `health [--json]` | Check gateway health | No |
| `gateway status [--json]` | Get gateway status | No |
| `gateway probe` | Probe connectivity | No |
| `doctor [--json]` | Run diagnostics | No |
| `doctor --fix` | Auto-fix issues | **Yes** |
| `gateway start` | Start gateway | No |
| `gateway stop` | Stop gateway | **Yes** |
| `gateway restart` | Restart gateway | **Yes** |
| `logs [--follow]` | View/tail logs | No |
| `security audit [--deep]` | Run security audit | No |
| `security audit --fix` | Apply safe guardrails | **Yes** |
| `status --all` | Comprehensive status | No |
| `gateway discover` | Scan for gateways | No |

See [openclaw-command-allowlist.md](audit/openclaw-command-allowlist.md) for full documentation and verification status.

### Adding New Commands

New commands must be added to the allowlist in `packages/adapters-openclaw/src/command-runner.ts`:

```typescript
export const ALLOWED_COMMANDS = {
  // Commands are binary-agnostic (args only)
  'health': { args: ['health'], danger: false, description: 'Check gateway health' },
  'gateway.restart': { args: ['gateway', 'restart'], danger: true, description: 'Restart the gateway' },
  // ... add new commands here
}
```

**Important:** Only add commands that are documented in official [OpenClaw docs](https://docs.openclaw.ai).

---

## Execution Model

### Safe Execution with spawn()

All commands use Node's `spawn()` with array arguments to prevent shell injection:

```typescript
// SAFE: Arguments as array
spawn('openclaw', ['run', agentId, taskDescription])

// UNSAFE (never used): Shell interpolation
exec(`openclaw run ${agentId} "${taskDescription}"`)  // DON'T DO THIS
```

### Receipt Logging

Every command execution creates a receipt:

```typescript
const receipt = await repos.receipts.create({
  workOrderId: 'system',
  kind: 'manual',
  commandName: 'openclaw run',
  commandArgs: { agentId, task },
})
```

Receipts capture:
- Timestamp
- Command and arguments
- stdout/stderr streams
- Exit code
- Duration
- Parsed JSON output (if applicable)

---

## Workspace Structure

OpenClaw expects this workspace structure:

```
project-root/
├── .openclaw/
│   └── config.yaml          # OpenClaw configuration
├── agents/
│   ├── AGENTS.md            # Agent registry
│   ├── savorgBUILD.soul.md  # Agent soul file
│   └── savorgBUILD.md       # Agent overlay
├── overlays/
│   └── *.md                 # Shared overlays
├── skills/
│   ├── user/                # User-defined skills
│   └── installed/           # Installed skills
├── playbooks/
│   └── *.md                 # Automation playbooks
└── plugins/
    └── *.json               # Plugin manifests
```

### File Types

| File Type | Location | Purpose |
|-----------|----------|---------|
| Soul | `agents/<name>.soul.md` | Agent identity and core behaviors |
| Overlay | `agents/<name>.md` or `overlays/` | Custom instructions and constraints |
| Skill | `skills/` | Reusable agent capabilities |
| Playbook | `playbooks/` | Multi-step automation scripts |
| Plugin | `plugins/` | External tool integrations |

---

## Governor Policies

Mission Control enforces Governor policies before OpenClaw execution:

### Policy Types

| Policy | Description | User Action |
|--------|-------------|-------------|
| `ALLOW` | No confirmation needed | Automatic |
| `CONFIRM` | Type "CONFIRM" to proceed | Manual confirmation |
| `WO_CODE` | Type work order code | Manual confirmation |
| `DENY` | Action blocked | N/A |

### Policy Evaluation

```typescript
// apps/mission-control/lib/with-governor.ts
export async function enforceTypedConfirm(options: {
  actionKind: string
  typedConfirmText?: string
}): Promise<GovernorResult>
```

### Action Kinds

Over 60 action kinds are defined in `packages/core/src/governor/index.ts`:

```typescript
'agent.status'           // CONFIRM
'agent.create'           // CONFIRM
'plugin.install'         // CONFIRM
'work-order.advance'     // WO_CODE
'maintenance.recover'    // CONFIRM
```

---

## Activity Logging

All significant operations are logged to the activity feed:

```typescript
await repos.activities.create({
  type: 'agent.executed',
  actor: 'user',
  entityType: 'agent',
  entityId: agentId,
  summary: `Executed ${taskDescription}`,
  payloadJson: { receiptId, exitCode },
})
```

Activity types include:
- `agent.*` — Agent lifecycle and execution
- `work-order.*` — Work order state changes
- `plugin.*` — Plugin install/uninstall
- `skill.*` — Skill changes
- `template.*` — Template operations
- `maintenance.*` — System maintenance

---

## Error Handling

### OpenClaw Unavailable

When OpenClaw is not on PATH:

```typescript
// Returns mock data instead of real execution
if (!isOpenClawAvailable()) {
  return mockCommandResult(command)
}
```

### Command Failures

Non-zero exit codes are captured in receipts:

```typescript
await repos.receipts.finalize(receipt.id, {
  exitCode: process.exitCode || 1,
  durationMs: elapsed,
  parsedJson: { error: stderr.trim() },
})
```

### Timeout Handling

Commands have a default 60-second timeout:

```typescript
const child = spawn('openclaw', args, {
  timeout: 60000,
})
```

---

## Demo Mode Details

When OpenClaw is unavailable, Mission Control provides:

### Mock Agents

Pre-configured agents in `packages/core/src/mocks/`:
- savorgSPEC — Specification agent
- savorgBUILD — Build/implementation agent
- savorgQA — Testing agent
- savorgOPS — Operations agent

### Mock Workspace

Virtual filesystem with sample files:
- Soul files
- Overlays
- Skills
- Playbooks

### Mock Execution

Commands return simulated results:
- Status checks return healthy
- List commands return mock data
- Run commands simulate execution with receipts

---

## Troubleshooting

### "OpenClaw not found"

1. Verify installation: `which openclaw`
2. Check PATH includes OpenClaw location
3. Restart Mission Control after installing

### "Permission denied"

1. Check file permissions on OpenClaw binary
2. Verify workspace directory is writable
3. Check SQLite database permissions

### "Command timeout"

1. Check OpenClaw is responding: `openclaw status`
2. Increase timeout in adapter if needed
3. Check for hanging agent processes

### "Invalid workspace"

1. Verify workspace structure matches expected layout
2. Create missing directories (agents/, skills/, etc.)
3. Initialize with `openclaw init` if available
