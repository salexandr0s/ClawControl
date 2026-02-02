# Workspace Path Policy

This document describes the path safety rules enforced by SAVORG Mission Control when accessing workspace files.

---

## Overview

Mission Control provides a workspace file browser for managing agent files (souls, overlays, skills, etc.). To prevent path traversal attacks, all file operations are validated against a strict policy.

---

## Validation Rules

### Rule 1: Absolute Paths Only

All paths must start with `/` (the workspace root):

```
✅ /agents/savorgBUILD.soul.md
✅ /skills/user/coding.md
❌ agents/savorgBUILD.soul.md     (relative)
❌ ./agents/savorgBUILD.soul.md   (relative)
```

### Rule 2: No Parent Directory Traversal

Paths cannot contain `..` sequences:

```
✅ /agents/savorgBUILD.soul.md
❌ /agents/../../../etc/passwd
❌ /agents/../../secrets.txt
```

### Rule 3: No Backslashes

Windows-style path separators are rejected:

```
✅ /agents/subfolder/file.md
❌ /agents\subfolder\file.md
❌ /agents/subfolder\..\file.md
```

### Rule 4: No Null Bytes

Null byte injection is blocked:

```
✅ /agents/soul.md
❌ /agents/soul.md%00.txt
❌ /agents/soul.md\x00.txt
```

### Rule 5: Allowed Subdirectories Only

Files must be in approved directories:

| Directory | Purpose | Examples |
|-----------|---------|----------|
| `/agents` | Agent souls and overlays | `savorgBUILD.soul.md`, `savorgQA.md` |
| `/overlays` | Shared overlay files | `coding-standards.md` |
| `/skills` | Skill definitions | `user/debugging.md` |
| `/playbooks` | Automation playbooks | `deploy-staging.md` |
| `/plugins` | Plugin manifests | `github-integration.json` |
| `/agent-templates` | Template definitions | `savorg-build/template.json` |

Accessing other directories is rejected:

```
✅ /agents/savorgBUILD.soul.md
✅ /skills/user/coding.md
❌ /etc/passwd
❌ /home/user/.ssh/id_rsa
❌ /var/log/system.log
```

---

## Implementation

### Validation Function

```typescript
// apps/mission-control/lib/workspace.ts

const ALLOWED_SUBDIRS = ['agents', 'overlays', 'skills', 'playbooks', 'plugins', 'agent-templates'] as const

export function isValidWorkspacePath(path: string): boolean {
  // Must start with /
  if (!path.startsWith('/')) return false

  // No .. traversal
  if (path.includes('..')) return false

  // No backslashes (windows-style)
  if (path.includes('\\')) return false

  // No null bytes
  if (path.includes('\0')) return false

  // Normalize and check it's still under workspace
  const normalized = path.split('/').filter(Boolean).join('/')

  // Must be in root or an allowed subdir
  if (normalized === '') return true // root
  const topDir = normalized.split('/')[0]
  return ALLOWED_SUBDIRS.includes(topDir)
}
```

### Usage in API Routes

```typescript
// Example: workspace file PUT
export async function PUT(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path')

  if (!path || !isValidWorkspacePath(path)) {
    return NextResponse.json(
      { error: 'Invalid workspace path' },
      { status: 400 }
    )
  }

  // Safe to proceed with file operation
  // ...
}
```

---

## Test Cases

### Valid Paths

| Path | Valid | Reason |
|------|-------|--------|
| `/` | ✅ | Workspace root |
| `/agents` | ✅ | Allowed directory |
| `/agents/savorgBUILD.soul.md` | ✅ | File in allowed dir |
| `/skills/user/coding.md` | ✅ | Nested in allowed dir |
| `/plugins/my-plugin.json` | ✅ | File in allowed dir |
| `/agent-templates/my-template/template.json` | ✅ | Template file |

### Invalid Paths

| Path | Valid | Reason |
|------|-------|--------|
| `agents/file.md` | ❌ | Missing leading slash |
| `/agents/../etc/passwd` | ❌ | Contains `..` |
| `/etc/passwd` | ❌ | Not in allowed subdir |
| `/agents\file.md` | ❌ | Contains backslash |
| `/agents/file.md%00` | ❌ | Contains null byte |
| `/random/file.md` | ❌ | `random` not in allowed list |

---

## Security Considerations

### Why These Rules?

1. **Absolute paths** prevent ambiguity about the base directory
2. **No `..` traversal** prevents escaping the workspace
3. **No backslashes** prevents mixed-path-style attacks
4. **No null bytes** prevents C-string truncation attacks
5. **Allowlist** ensures only expected directories are accessible

### Future Enhancements

For production filesystem implementations (vs. current mock):

1. **Symlink resolution** — Use `realpathSync()` to resolve symlinks before validation
2. **Case normalization** — Handle case-insensitive filesystems
3. **Character encoding** — Normalize Unicode paths
4. **Stat verification** — Verify target is file/directory as expected

---

## Adding New Allowed Directories

To add a new allowed directory:

1. Edit `ALLOWED_SUBDIRS` in `apps/mission-control/lib/workspace.ts`:

```typescript
const ALLOWED_SUBDIRS = [
  'agents',
  'overlays',
  'skills',
  'playbooks',
  'plugins',
  'new-directory',  // Add here
] as const
```

2. Add corresponding mock data if needed in `packages/core/src/mocks/`

3. Update this documentation

---

## Error Messages

When path validation fails, the API returns:

```json
{
  "error": "Invalid workspace path"
}
```

The specific validation failure is intentionally not disclosed to avoid information leakage about the validation rules.

---

## Related Documentation

- [Security Model](./SECURITY.md) — Full security architecture
- [OpenClaw Integration](./OPENCLAW_INTEGRATION.md) — Workspace structure
