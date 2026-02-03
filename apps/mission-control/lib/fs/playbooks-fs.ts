/**
 * Playbooks FS
 *
 * Real filesystem-backed implementation for playbooks.
 * Playbooks are YAML files in the workspace/playbooks directory.
 */

import { promises as fsp } from 'node:fs'
import { join, basename } from 'node:path'
import { getWorkspaceRoot } from './path-policy'
import yaml from 'js-yaml'

export interface PlaybookEntry {
  id: string
  name: string
  description: string
  severity: 'info' | 'warn' | 'critical'
  modifiedAt: Date
}

export interface PlaybookEntryWithContent extends PlaybookEntry {
  content: string
}

const PLAYBOOKS_DIR = 'playbooks'

function getPlaybooksRoot(): string {
  return join(getWorkspaceRoot(), PLAYBOOKS_DIR)
}

function fileNameToId(fileName: string): string {
  return Buffer.from(fileName, 'utf8').toString('base64url')
}

function idToFileName(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8')
}

interface PlaybookFrontmatter {
  name?: string
  description?: string
  severity?: 'info' | 'warn' | 'critical'
}

function parseFrontmatter(content: string): { frontmatter: PlaybookFrontmatter; body: string } {
  // Check for YAML frontmatter between --- markers
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (match) {
    try {
      const frontmatter = yaml.load(match[1]) as PlaybookFrontmatter
      return { frontmatter, body: match[2] }
    } catch {
      return { frontmatter: {}, body: content }
    }
  }

  // Try parsing whole content as YAML and extract metadata
  try {
    const parsed = yaml.load(content) as { name?: string; description?: string; severity?: string }
    return {
      frontmatter: {
        name: parsed.name,
        description: parsed.description,
        severity: parsed.severity as 'info' | 'warn' | 'critical' | undefined,
      },
      body: content,
    }
  } catch {
    return { frontmatter: {}, body: content }
  }
}

export async function listPlaybooks(): Promise<PlaybookEntry[]> {
  const root = getPlaybooksRoot()

  try {
    await fsp.mkdir(root, { recursive: true })
  } catch {
    // Directory might already exist
  }

  let entries: { name: string; isDirectory: () => boolean }[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const playbooks: PlaybookEntry[] = []

  for (const ent of entries) {
    if (ent.isDirectory()) continue
    if (!ent.name.endsWith('.yaml') && !ent.name.endsWith('.yml')) continue

    const abs = join(root, ent.name)
    const st = await fsp.stat(abs)
    const content = await fsp.readFile(abs, 'utf8')
    const { frontmatter } = parseFrontmatter(content)

    const nameWithoutExt = ent.name.replace(/\.ya?ml$/, '')

    playbooks.push({
      id: fileNameToId(ent.name),
      name: frontmatter.name ?? nameWithoutExt,
      description: frontmatter.description ?? `Playbook: ${nameWithoutExt}`,
      severity: frontmatter.severity ?? 'info',
      modifiedAt: st.mtime,
    })
  }

  // Sort by name
  playbooks.sort((a, b) => a.name.localeCompare(b.name))

  return playbooks
}

export async function getPlaybook(id: string): Promise<PlaybookEntryWithContent | null> {
  const fileName = idToFileName(id)
  const abs = join(getPlaybooksRoot(), fileName)

  try {
    const st = await fsp.stat(abs)
    const content = await fsp.readFile(abs, 'utf8')
    const { frontmatter } = parseFrontmatter(content)

    const nameWithoutExt = fileName.replace(/\.ya?ml$/, '')

    return {
      id,
      name: frontmatter.name ?? nameWithoutExt,
      description: frontmatter.description ?? `Playbook: ${nameWithoutExt}`,
      severity: frontmatter.severity ?? 'info',
      modifiedAt: st.mtime,
      content,
    }
  } catch {
    return null
  }
}

export async function updatePlaybook(id: string, content: string): Promise<PlaybookEntryWithContent | null> {
  const fileName = idToFileName(id)
  const abs = join(getPlaybooksRoot(), fileName)

  try {
    await fsp.writeFile(abs, content, 'utf8')
    const st = await fsp.stat(abs)
    const { frontmatter } = parseFrontmatter(content)

    const nameWithoutExt = fileName.replace(/\.ya?ml$/, '')

    return {
      id,
      name: frontmatter.name ?? nameWithoutExt,
      description: frontmatter.description ?? `Playbook: ${nameWithoutExt}`,
      severity: frontmatter.severity ?? 'info',
      modifiedAt: st.mtime,
      content,
    }
  } catch {
    return null
  }
}

export async function ensurePlaybooksDir(): Promise<void> {
  const root = getPlaybooksRoot()
  await fsp.mkdir(root, { recursive: true })
}
