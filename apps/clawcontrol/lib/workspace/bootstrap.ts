import { promises as fsp } from 'node:fs'
import { join, resolve } from 'node:path'

const REQUIRED_DIRS = [
  'agents',
  'skills',
  'agent-templates',
  'memory',
  'docs',
  'playbooks',
] as const

const DEFAULT_AGENTS_MD = [
  '# AGENTS.md',
  '',
  'This workspace was initialized by ClawControl.',
  '',
  'Add your agent hierarchy and governance rules here.',
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

  return {
    path: normalized,
    ensured: true,
    createdDirectories,
    createdFiles,
  }
}
