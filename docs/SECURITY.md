# Security Model

This document describes SAVORG Mission Control's security architecture for operators and contributors.

---

## Design Philosophy

Mission Control is designed for **local-first, single-user** operation:

- Runs on localhost (not exposed to network by default)
- No authentication (trusts local user)
- Defense-in-depth with Governor policies
- Audit trail for all significant actions

**Not designed for:** Multi-tenant deployment, public internet exposure, or untrusted users.

---

## Governor System

The Governor is the primary security control, enforcing typed confirmation for dangerous actions.

### Policy Levels

| Level | Description | User Action |
|-------|-------------|-------------|
| **ALLOW** | Safe read operations | None required |
| **CONFIRM** | Type "CONFIRM" to proceed | Type exact text |
| **WO_CODE** | Type work order code | Type e.g., "WO-0001" |
| **DENY** | Action is blocked | N/A |

### How It Works

1. **API receives request** with `typedConfirmText` parameter
2. **Governor evaluates** action kind against policy
3. **If CONFIRM required**, validates text matches
4. **If allowed**, operation proceeds
5. **Activity logged** for audit trail

### Example Flow

```typescript
// Client sends request
POST /api/plugins
{
  "spec": "npm:@org/plugin",
  "typedConfirmText": "CONFIRM"
}

// Server validates
const result = await enforceTypedConfirm({
  actionKind: 'plugin.install',
  typedConfirmText: 'CONFIRM',
})

if (!result.allowed) {
  return 428  // Precondition Required
}
```

### Action Categories

| Category | Example Actions | Typical Policy |
|----------|----------------|----------------|
| Read operations | `agent.list`, `plugin.list` | ALLOW |
| Agent execution | `agent.run`, `agent.speak` | CONFIRM |
| Installations | `plugin.install`, `skill.install` | CONFIRM |
| State changes | `work-order.advance` | WO_CODE |
| Destructive | `plugin.uninstall`, `agent.delete` | CONFIRM |
| System ops | `maintenance.recover` | CONFIRM |

---

## Command Execution Safety

### Allowlist Only

OpenClaw commands are restricted to a predefined allowlist:

```typescript
// packages/adapters-openclaw/src/command-runner.ts
const ALLOWED_COMMANDS = [
  'status',
  'agents list',
  'agents show',
  'run',
  'speak',
  // ... 24 total commands
]
```

Commands not on the list are rejected before execution.

### No Shell Interpolation

Commands use `spawn()` with array arguments:

```typescript
// SAFE: Arguments passed as array, no shell interpretation
spawn('openclaw', ['run', agentId, taskDescription])

// This pattern prevents:
// - Command injection via `;` or `&&`
// - Subshell execution via `$(...)` or backticks
// - Variable expansion
```

### Receipts for Audit

Every command execution creates an immutable receipt:

- Timestamp
- Command and arguments
- Full stdout/stderr capture
- Exit code
- Duration

---

## Path Traversal Protection

Workspace file operations are protected against path traversal attacks.

### Validation Rules

```typescript
// apps/mission-control/lib/workspace.ts
export function isValidWorkspacePath(path: string): boolean {
  // Must start with /
  if (!path.startsWith('/')) return false

  // No .. traversal
  if (path.includes('..')) return false

  // No backslashes (windows-style)
  if (path.includes('\\')) return false

  // No null bytes
  if (path.includes('\0')) return false

  // Must be in allowed subdirectory
  const topDir = path.split('/')[1]
  return ALLOWED_SUBDIRS.includes(topDir)
}
```

### Allowed Subdirectories

Only these directories are accessible:

| Directory | Contents |
|-----------|----------|
| `/agents` | Soul files and overlays |
| `/overlays` | Shared overlay files |
| `/skills` | Skill definitions |
| `/playbooks` | Automation playbooks |
| `/plugins` | Plugin manifests |
| `/agent-templates` | Template definitions |

Attempts to access other paths (e.g., `/etc/passwd`, `/../../../home`) are rejected.

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (Untrusted)                       │
│  React UI makes API calls, could be manipulated             │
└─────────────────────────────┬────────────────────────────────┘
                              │ HTTP/SSE
══════════════════════════════╪════════════════════════════════
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  NEXT.JS API (Semi-Trusted)                  │
│  - Governor enforcement                                      │
│  - Input validation                                          │
│  - Path safety checks                                        │
└─────────────────────────────┬────────────────────────────────┘
                              │
══════════════════════════════╪════════════════════════════════
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATA LAYER (Trusted)                      │
│  - SQLite database (WAL mode)                               │
│  - Workspace filesystem                                      │
└─────────────────────────────┬────────────────────────────────┘
                              │
══════════════════════════════╪════════════════════════════════
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   EXTERNAL (Untrusted)                       │
│  - OpenClaw CLI (command allowlist enforced)                │
└─────────────────────────────────────────────────────────────┘
```

---

## Activity Audit Trail

All significant actions are logged with:

```typescript
await repos.activities.create({
  type: 'plugin.installed',    // What happened
  actor: 'user',               // Who did it
  entityType: 'plugin',        // What entity
  entityId: pluginId,          // Which instance
  summary: 'Installed @org/x', // Human description
  payloadJson: { ... },        // Full details
})
```

Activities are immutable and cannot be deleted through the UI.

---

## Known Limitations

### Single User Design

- No authentication or authorization
- Trusts anyone who can reach localhost:3000
- Not suitable for shared or networked deployments

### Localhost Binding

By default, Next.js dev server binds to `localhost`. In production:

```bash
# Explicitly bind to localhost only
npm run start -- --hostname 127.0.0.1
```

### No HTTPS

Development uses HTTP. For production:
- Use a reverse proxy (nginx, Caddy) with TLS
- Or run behind a VPN

### SQLite Concurrency

SQLite with WAL mode supports single-writer, multiple-reader:
- Only one process should write at a time
- Prisma Studio counts as a separate process

---

## Threat Mitigations

| Threat | Mitigation | Status |
|--------|------------|--------|
| Command injection | spawn() with array args, allowlist | ✅ Implemented |
| Path traversal | isValidWorkspacePath() | ✅ Implemented |
| Governor bypass | enforceTypedConfirm() on mutations | ✅ Implemented |
| Audit tampering | Immutable activity log | ✅ Implemented |
| Malicious template | Path validation on import | ✅ Implemented |
| SSE exhaustion | 50-connection limit per endpoint, 429 response | ✅ Implemented |
| Symlink escape | realpathSync() validation in path-policy | ✅ Implemented |
| Zip slip | Entry name validation, size limits | ✅ Implemented |

---

## Security Recommendations

### For Operators

1. **Keep localhost-only** — Don't expose to network without TLS and auth
2. **Review activities** — Check `/now` regularly for unexpected actions
3. **Backup database** — SQLite file at `data/mission-control.db`
4. **Update regularly** — Pull latest security patches

### For Contributors

1. **Use enforceTypedConfirm()** — All mutating endpoints must gate
2. **Validate paths** — Use isValidWorkspacePath() for file operations
3. **Log activities** — Create activity records for significant actions
4. **No shell interpolation** — Always use spawn() with array args

---

## Reporting Security Issues

Found a vulnerability? Please report responsibly:

1. **Open** a GitHub issue with the `security` label
2. **Include** reproduction steps if possible
3. **Allow** reasonable time for a fix before public disclosure
