# ClawControl Agent Template Guide

Last updated: 2026-02-09

This guide defines the authoring and import contract for user-provided agent templates in ClawControl.
Use this as the single reference for building templates that pass validation and work reliably in the current system.

## 1. Scope and Compatibility

This guide is based on the current implementation in:

- `/Users/savorgserver/OpenClaw/projects/ClawControl/packages/core/src/schemas/agent-template.schema.ts`
- `/Users/savorgserver/OpenClaw/projects/ClawControl/apps/clawcontrol/lib/templates.ts`
- `/Users/savorgserver/OpenClaw/projects/ClawControl/apps/clawcontrol/app/api/agent-templates/import/route.ts`
- `/Users/savorgserver/OpenClaw/projects/ClawControl/apps/clawcontrol/app/api/agents/create-from-template/route.ts`

Import now supports:

- pasted JSON export payload (legacy, unchanged)
- uploaded `.json` / `.template.json` files (single template)
- uploaded `.zip` files (single template or multi-template bundle)

Export remains JSON (`<id>.template.json`) for compatibility.

## 2. Required Directory Structure

Templates live under:

- `/agent-templates/<templateId>/`

Minimum required file:

- `template.json`

Strongly recommended files:

- `SOUL.md`
- `overlay.md`
- `README.md`

Example:

```text
/agent-templates/clawcontrol-ops-v1/
  template.json
  SOUL.md
  overlay.md
  README.md
```

Important:

- Folder name must match `template.json.id`.
- Hidden path segments are rejected during import.

## 3. Template ID Rules (Use Strict Form)

Schema pattern allows:

- `^[a-z0-9][a-z0-9-_]{1,48}$`

UI create flow currently enforces a stricter pattern:

- `^[a-z0-9][a-z0-9-_]{1,48}[a-z0-9]$`

To avoid UI/API mismatch, always use the stricter format:

- lowercase letters, digits, `-`, `_`
- 3 to 50 characters
- start and end with alphanumeric

## 4. `template.json` Contract

Required fields:

- `id` (string)
- `name` (string)
- `description` (string)
- `version` (string)
- `role` (enum)

Allowed `role` values:

- `CEO`
- `BUILD`
- `OPS`
- `REVIEW`
- `SPEC`
- `QA`
- `SHIP`
- `COMPOUND`
- `UPDATE`
- `CUSTOM`

No unknown top-level keys are allowed (`additionalProperties: false`).

Optional fields:

- `namingPattern`
- `sessionKeyPattern`
- `paramsSchema`
- `render`
- `defaults`
- `recommendations`
- `provisioning`
- `author`
- `tags`

## 5. Recommended `template.json` Starter

```json
{
  "id": "clawcontrol-build-v1",
  "name": "ClawControl Build Template",
  "description": "Template for BUILD role agents with standard SOUL and overlay outputs.",
  "version": "1.0.0",
  "role": "BUILD",
  "namingPattern": "clawcontrol{{ROLE}}",
  "sessionKeyPattern": "agent:{{agentSlug}}:main",
  "paramsSchema": {
    "type": "object",
    "properties": {
      "projectName": {
        "type": "string",
        "description": "Project name shown in generated files",
        "minLength": 1
      },
      "ownerName": {
        "type": "string",
        "description": "Owner/operator display name"
      }
    },
    "required": ["projectName"]
  },
  "render": {
    "engine": "mustache",
    "targets": [
      {
        "source": "SOUL.md",
        "destination": "workspace/agents/{{agentSlug}}/SOUL.md"
      },
      {
        "source": "overlay.md",
        "destination": "workspace/agents/{{agentSlug}}.md"
      }
    ]
  },
  "defaults": {
    "ownerName": "Operator"
  },
  "recommendations": {
    "skills": [
      { "name": "checks", "scope": "agent", "required": false }
    ],
    "plugins": [
      { "name": "audit-tools", "required": false }
    ]
  },
  "provisioning": {
    "enabled": true,
    "steps": ["create_files", "register_agent"]
  },
  "author": "ClawControl Team",
  "tags": ["build", "standard", "v1"]
}
```

## 6. Rendering Engine and Variables

Rendering uses simple token replacement (`{{variable}}`).

Supported behavior:

- Only direct token replacement.
- No loops, no conditionals, no helpers.
- Unknown tokens are not resolved automatically and remain literal.

Parameters available during create/preview:

- all `defaults` values
- all user-provided `params`
- `agentDisplayName`
- `agentSlug`
- `sessionKey`
- `agentName` (legacy alias of `agentDisplayName`)

Important:

- Do not rely on `{{templateId}}` unless you explicitly provide it as a parameter.
- Keep render targets deterministic and self-contained.

## 7. `paramsSchema` Guidance

Use `paramsSchema` to define what the operator must provide.

Rules:

- `paramsSchema.type` should be `object`.
- Define fields under `paramsSchema.properties`.
- Use `paramsSchema.required` for mandatory values.

Validation behavior:

- Missing required runtime params blocks preview/create-from-template.
- If `required` lists fields not in `properties`, scanner emits warnings.

## 8. Render Targets Guidance

Each render target must include:

- `source`
- `destination`

Source path rules:

- relative path only
- must not include `..`
- must not include `\`
- must not include null bytes
- must not start with `/`

If `render.targets` is omitted, defaults are used:

- `SOUL.md -> workspace/agents/{{agentSlug}}/SOUL.md`
- `overlay.md -> workspace/agents/{{agentSlug}}.md`

## 9. Import/Export Formats

Export endpoint returns JSON (downloaded as `<id>.template.json`):

```json
{
  "templateId": "clawcontrol-build-v1",
  "name": "ClawControl Build Template",
  "version": "1.0.0",
  "exportedAt": "2026-02-06T00:00:00.000Z",
  "files": {
    "template.json": "{...}",
    "SOUL.md": "# ...",
    "overlay.md": "# ...",
    "README.md": "# ..."
  }
}
```

JSON API import (legacy) still expects wrapper body:

```json
{
  "template": {
    "templateId": "clawcontrol-build-v1",
    "name": "ClawControl Build Template",
    "version": "1.0.0",
    "exportedAt": "2026-02-06T00:00:00.000Z",
    "files": {
      "template.json": "{...}",
      "SOUL.md": "# ...",
      "overlay.md": "# ..."
    }
  },
  "typedConfirmText": "CONFIRM"
}
```

UI note:

- UI import supports both file upload and JSON paste mode.

### 9.1 Supported Uploaded File Types

- `.zip`
- `.json`
- `.template.json`

### 9.2 Supported ZIP Layouts

#### A) Single template at archive root

```text
template.json
SOUL.md
overlay.md
README.md
```

#### B) Single template in one top-level folder

```text
<templateId>/template.json
<templateId>/SOUL.md
<templateId>/overlay.md
```

#### C) Bundle/team archive (multiple top-level template folders)

```text
alpha/template.json
alpha/SOUL.md
alpha/overlay.md
beta/template.json
beta/SOUL.md
beta/overlay.md
```

Bundle rules:

- each top-level folder must include its own `template.json`
- duplicate template IDs across bundle entries are rejected
- import is all-or-nothing (no partial writes)

Noise entries automatically ignored:

- `__MACOSX/**`
- `.DS_Store`

Unsupported or mixed layouts are rejected with a clear error.

## 10. Security and Size Limits

Import hard limits:

- max files: 100
- max file size: 10 MB each
- max total payload: 50 MB

Rejected file names include:

- empty names
- absolute paths
- any `..`
- Windows drive paths
- backslashes
- null bytes
- leading `/`
- hidden path segments (for example `.git`, `.secret`)

All writes are constrained by workspace path policy and allowed root areas.

Validation checks per template include:

- `template.json` exists and parses
- schema + semantic validation via `validateTemplateConfig`
- folder-to-id rules for folder-based ZIP imports
- required source files exist:
  - if `render.targets` is provided: all `target.source` files must exist
  - if `render.targets` is omitted: `SOUL.md` and `overlay.md` are required
- duplicate IDs in one bundle are rejected
- conflicts with existing `/agent-templates/<id>` are rejected

## 11. Governance and Confirmations

These actions are governor-protected:

- `template.create` (caution, confirm)
- `template.import` (danger, confirm + approval)
- `template.delete` (danger, confirm + approval)
- `template.export` (safe)
- `agent.create_from_template` (caution, confirm)

If governance blocks action, API returns policy details and an error (often `428` or `403`).

## 12. End-to-End Author Checklist

Before distributing a template:

1. Ensure folder name equals template id exactly.
2. Validate id against strict pattern (`^[a-z0-9][a-z0-9-_]{1,48}[a-z0-9]$`).
3. Confirm `template.json` has only allowed keys.
4. Ensure `paramsSchema.required` keys exist in `paramsSchema.properties`.
5. Include `SOUL.md` and `overlay.md` sources referenced by `render.targets`.
6. Remove unresolved placeholders you did not intend to keep literal.
7. Add `README.md` with usage, required params, and expected outputs.
8. Preview with `/api/agents/create-from-template/preview` using required params.
9. Import into a clean environment to verify no id/folder mismatch issues.
10. Export and re-import once to confirm portability.

## 13. Known Implementation Notes

- Current create-from-template flow renders previews and registers the agent, but does not persist generated rendered files to disk yet.
- Export currently returns JSON payload (`.template.json`) even though import supports ZIP.
- Treat uploaded template content as untrusted input and avoid embedding secrets.

## 14. Template README Minimum Standard

Every shared template should include:

1. Purpose and intended role.
2. Required parameters with examples.
3. Render target list and expected output paths.
4. Any assumptions about workspace layout.
5. Version history and compatibility notes.
6. Security notes (no secrets in template files).

## 15. Quick Troubleshooting

`Template validation failed`

- Check required keys, role enum, and unknown properties in `template.json`.

`Template id must match folder`

- Rename folder or update `template.json.id` to exact match.

`Missing required parameters`

- Provide all fields listed in `paramsSchema.required`.

`Invalid file name` during import

- Remove traversal, absolute, hidden, backslash, or null-byte paths.

`Template already exists`

- Use a new template id/versioned id (for example `clawcontrol-build-v2`).

`Unsupported ZIP layout`

- Use one of the three supported ZIP layouts and ensure each bundle folder has `template.json`.

`Duplicate template ID(s) in bundle`

- Ensure each bundled template uses a unique `template.json.id`.

`Missing required source file(s)`

- Add all `render.targets[].source` files, or include default `SOUL.md` + `overlay.md` when `render.targets` is omitted.
