import { promises as fsp } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const REQUIRED_DIRS = [
  'agents',
  'skills',
  'agent-templates',
  'workflows',
  'workflow-packages',
  'memory',
  'docs',
  'playbooks',
] as const

const DEFAULT_AGENTS_MD = [
  '# AGENTS.md — Workspace Rules',
  '',
  'This file is the source of truth for agent behavior in this workspace.',
  'ClawControl created this stub because `AGENTS.md` was missing.',
  '',
  '## Quick Start (ClawControl)',
  '- `main` is the default CEO inbox (OpenClaw runtime agent).',
  '- Use workflow-only execution via the Manager Stage Engine.',
  '- Security veto is final.',
  '',
  '## Agent File Contract',
  'For each agent id/slug:',
  '- `agents/<id>/SOUL.md` (identity + hard rules)',
  '- `agents/<id>/HEARTBEAT.md` (heartbeat checklist)',
  '- `agents/<id>/MEMORY.md` (long-term notes; keep concise)',
  '- `agents/<id>.md` (overlay/prompt glue, if used)',
  '',
  '## Fill This In',
  '1. Your agent hierarchy (CEO -> Manager -> Specialists).',
  '2. Tool policies (allowlists/denylists).',
  '3. Governance: proposals, approvals, risk classes, gates.',
  '',
  'Docs: https://docs.clawcontrol.cc/reference/workspace-files',
  '',
].join('\n')

const DEFAULT_MAIN_SOUL_MD = [
  '# ClawcontrolCEO (main)',
  '',
  'You are the primary interface for the human operator and the executive inbox for ClawControl.',
  '',
  '## Responsibilities',
  '- Intake and clarify requests.',
  '- Create and update Work Orders (what we are doing and why).',
  '- Delegate execution to the Manager Stage Engine and specialists.',
  '- Review outcomes and ensure governance gates are followed.',
  '',
  '## Hard Rules',
  '- Workflow-only execution: do not bypass the Manager Stage Engine.',
  '- Never override a security veto. A veto is final.',
  '- If something is blocked, escalate with a clear reason and next action.',
  '',
  '## Collaboration',
  '- You coordinate with ClawcontrolManager for orchestration.',
  '- Specialists do implementation; you focus on correctness, safety, and decisions.',
  '',
].join('\n')

const DEFAULT_MAIN_HEARTBEAT_MD = [
  '# CEO Heartbeat (main)',
  '',
  'When a heartbeat is requested:',
  '- Check dashboard status: running work orders, blocked items, pending approvals, incidents.',
  '- If blocked due to security veto: do not resume; report the veto as final.',
  '- If approvals are pending: summarize what is needed and why.',
  '- If nothing actionable: reply exactly `HEARTBEAT_OK`.',
  '',
].join('\n')

function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return resolve(trimmed)
}

async function ensureDir(path: string): Promise<boolean> {
  try {
    await fsp.access(path)
    return false
  } catch {
    await fsp.mkdir(path, { recursive: true })
    return true
  }
}

async function ensureFile(path: string, content: string): Promise<boolean> {
  try {
    await fsp.access(path)
    return false
  } catch {
    await fsp.mkdir(dirname(path), { recursive: true })
    await fsp.writeFile(path, content, 'utf8')
    return true
  }
}

export interface WorkspaceScaffoldResult {
  path: string | null
  ensured: boolean
  createdDirectories: string[]
  createdFiles: string[]
}

export async function ensureWorkspaceScaffold(
  workspacePath: string | null | undefined
): Promise<WorkspaceScaffoldResult> {
  const normalized = normalizeWorkspacePath(workspacePath)
  if (!normalized) {
    return {
      path: null,
      ensured: false,
      createdDirectories: [],
      createdFiles: [],
    }
  }

  await fsp.mkdir(normalized, { recursive: true })

  const createdDirectories: string[] = []
  const createdFiles: string[] = []

  for (const dirName of REQUIRED_DIRS) {
    const dirPath = join(normalized, dirName)
    if (await ensureDir(dirPath)) {
      createdDirectories.push(dirPath)
    }
  }

  const agentsMdPath = join(normalized, 'AGENTS.md')
  if (await ensureFile(agentsMdPath, DEFAULT_AGENTS_MD)) {
    createdFiles.push(agentsMdPath)
  }

  const mainSoulPath = join(normalized, 'agents', 'main', 'SOUL.md')
  if (await ensureFile(mainSoulPath, DEFAULT_MAIN_SOUL_MD)) {
    createdFiles.push(mainSoulPath)
  }

  const mainHeartbeatPath = join(normalized, 'agents', 'main', 'HEARTBEAT.md')
  if (await ensureFile(mainHeartbeatPath, DEFAULT_MAIN_HEARTBEAT_MD)) {
    createdFiles.push(mainHeartbeatPath)
  }

  return {
    path: normalized,
    ensured: true,
    createdDirectories,
    createdFiles,
  }
}
