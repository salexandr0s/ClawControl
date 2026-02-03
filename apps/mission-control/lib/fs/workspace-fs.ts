/**
 * Workspace FS
 *
 * Real filesystem-backed implementation for workspace browsing/editing.
 *
 * Paths are always expressed as workspace-relative paths starting with `/`.
 */

import { promises as fsp } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { validateWorkspacePath, getWorkspaceRoot, getAllowedSubdirs, getAllowedRootFiles } from './path-policy'

export type WorkspaceEntryType = 'file' | 'folder'

export interface WorkspaceEntry {
  id: string
  name: string
  type: WorkspaceEntryType
  path: string // parent path, starts with '/'
  size?: number
  modifiedAt: Date
}

export interface WorkspaceEntryWithContent extends WorkspaceEntry {
  content: string
}

// We encode the workspace-relative full path (e.g. "/agents/foo.md") as id.
export function encodeWorkspaceId(fullPath: string): string {
  const normalized = fullPath.startsWith('/') ? fullPath : `/${fullPath}`
  return Buffer.from(normalized, 'utf8').toString('base64url')
}

export function decodeWorkspaceId(id: string): string {
  const decoded = Buffer.from(id, 'base64url').toString('utf8')
  if (!decoded.startsWith('/')) return `/${decoded}`
  return decoded
}

export async function listWorkspace(path = '/'): Promise<WorkspaceEntry[]> {
  const res = validateWorkspacePath(path)
  if (!res.valid || !res.resolvedPath) throw new Error(res.error || 'Invalid path')

  const absDir = res.resolvedPath
  const entries = await fsp.readdir(absDir, { withFileTypes: true })

  const out: WorkspaceEntry[] = []
  const allowedSubdirs = new Set(getAllowedSubdirs())
  const allowedRootFiles = new Set(getAllowedRootFiles())

  for (const ent of entries) {
    // Skip dotfiles by default (can revisit)
    if (ent.name.startsWith('.')) continue

    // At root, only expose allowlisted folders/files.
    if (path === '/') {
      if (ent.isDirectory()) {
        if (!allowedSubdirs.has(ent.name)) continue
      } else {
        if (!allowedRootFiles.has(ent.name)) continue
      }
    }

    const abs = join(absDir, ent.name)
    const st = await fsp.stat(abs)

    out.push({
      id: encodeWorkspaceId(path === '/' ? `/${ent.name}` : `${path}/${ent.name}`),
      name: ent.name,
      type: ent.isDirectory() ? 'folder' : 'file',
      path,
      size: ent.isDirectory() ? undefined : st.size,
      modifiedAt: st.mtime,
    })
  }

  // Sort: folders first, then files; then name
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return out
}

export async function readWorkspaceFileById(id: string): Promise<WorkspaceEntryWithContent> {
  const fullPath = decodeWorkspaceId(id)
  const res = validateWorkspacePath(fullPath)
  if (!res.valid || !res.resolvedPath) throw new Error(res.error || 'Invalid path')

  const abs = res.resolvedPath
  const st = await fsp.stat(abs)
  if (st.isDirectory()) throw new Error('Cannot read folder content')

  const content = await fsp.readFile(abs, 'utf8')

  const parent = dirname(fullPath)
  const parentPath = parent === '.' ? '/' : parent

  return {
    id,
    name: basename(fullPath),
    type: 'file',
    path: parentPath === '/' ? '/' : parentPath,
    size: st.size,
    modifiedAt: st.mtime,
    content,
  }
}

export async function writeWorkspaceFileById(id: string, content: string): Promise<WorkspaceEntryWithContent> {
  const fullPath = decodeWorkspaceId(id)
  const res = validateWorkspacePath(fullPath)
  if (!res.valid || !res.resolvedPath) throw new Error(res.error || 'Invalid path')

  const abs = res.resolvedPath
  await fsp.mkdir(dirname(abs), { recursive: true })
  await fsp.writeFile(abs, content, 'utf8')

  const st = await fsp.stat(abs)

  const parent = dirname(fullPath)
  const parentPath = parent === '.' ? '/' : parent

  return {
    id,
    name: basename(fullPath),
    type: 'file',
    path: parentPath === '/' ? '/' : parentPath,
    size: st.size,
    modifiedAt: st.mtime,
    content,
  }
}

export async function ensureWorkspaceRootExists(): Promise<void> {
  const root = getWorkspaceRoot()
  await fsp.mkdir(root, { recursive: true })
}

export async function createWorkspaceFile(
  parentPath: string,
  name: string,
  content = ''
): Promise<WorkspaceEntryWithContent> {
  const fullPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
  const res = validateWorkspacePath(fullPath)
  if (!res.valid || !res.resolvedPath) throw new Error(res.error || 'Invalid path')

  const abs = res.resolvedPath

  // Check if already exists
  try {
    await fsp.access(abs)
    throw new Error('File already exists')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  await fsp.mkdir(dirname(abs), { recursive: true })
  await fsp.writeFile(abs, content, 'utf8')

  const st = await fsp.stat(abs)

  return {
    id: encodeWorkspaceId(fullPath),
    name,
    type: 'file',
    path: parentPath,
    size: st.size,
    modifiedAt: st.mtime,
    content,
  }
}

export async function createWorkspaceFolder(
  parentPath: string,
  name: string
): Promise<WorkspaceEntry> {
  const fullPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
  const res = validateWorkspacePath(fullPath)
  if (!res.valid || !res.resolvedPath) throw new Error(res.error || 'Invalid path')

  const abs = res.resolvedPath

  // Check if already exists
  try {
    await fsp.access(abs)
    throw new Error('Folder already exists')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  await fsp.mkdir(abs, { recursive: true })

  const st = await fsp.stat(abs)

  return {
    id: encodeWorkspaceId(fullPath),
    name,
    type: 'folder',
    path: parentPath,
    modifiedAt: st.mtime,
  }
}

export async function deleteWorkspaceEntry(id: string): Promise<void> {
  const fullPath = decodeWorkspaceId(id)
  const res = validateWorkspacePath(fullPath)
  if (!res.valid || !res.resolvedPath) throw new Error(res.error || 'Invalid path')

  const abs = res.resolvedPath
  const st = await fsp.stat(abs)

  if (st.isDirectory()) {
    await fsp.rm(abs, { recursive: true, force: true })
  } else {
    await fsp.unlink(abs)
  }
}
