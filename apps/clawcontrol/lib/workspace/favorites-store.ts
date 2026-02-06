import 'server-only'

import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { validateWorkspacePath } from '@/lib/fs/path-policy'

export interface WorkspaceRecentItem {
  path: string
  touchedAt: string
}

export interface WorkspaceFavoritesDoc {
  favorites: string[]
  recents: WorkspaceRecentItem[]
  pinToday?: boolean
}

const DEFAULT_DOC: WorkspaceFavoritesDoc = {
  favorites: [],
  recents: [],
}

const RECENTS_LIMIT = 50

function favoritesPath(): string {
  const openClawHome = process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
  return join(openClawHome, 'clawcontrol', 'favorites.json')
}

function normalizePath(path: string): string {
  const validation = validateWorkspacePath(path)
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid workspace path')
  }

  const normalized = path.startsWith('/') ? path : `/${path}`
  return `/${normalized.split('/').filter(Boolean).join('/')}`
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const parent = dirname(path)
  await fsp.mkdir(parent, { recursive: true })

  const tmp = `${path}.tmp-${Date.now()}`
  await fsp.writeFile(tmp, data, 'utf8')
  await fsp.rename(tmp, path)
}

export async function readWorkspaceFavorites(): Promise<WorkspaceFavoritesDoc> {
  const path = favoritesPath()

  try {
    const raw = await fsp.readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceFavoritesDoc>

    const favorites = Array.isArray(parsed.favorites)
      ? parsed.favorites.filter((item): item is string => typeof item === 'string')
      : []

    const recents = Array.isArray(parsed.recents)
      ? parsed.recents
        .filter((item): item is WorkspaceRecentItem => {
          if (!item || typeof item !== 'object') return false
          const rec = item as WorkspaceRecentItem
          return typeof rec.path === 'string' && typeof rec.touchedAt === 'string'
        })
        .slice(0, RECENTS_LIMIT)
      : []

    return {
      favorites,
      recents,
      ...(typeof parsed.pinToday === 'boolean' ? { pinToday: parsed.pinToday } : {}),
    }
  } catch {
    return { ...DEFAULT_DOC }
  }
}

export async function writeWorkspaceFavorites(doc: WorkspaceFavoritesDoc): Promise<void> {
  await writeAtomic(favoritesPath(), JSON.stringify(doc, null, 2))
}

export async function mutateFavorites(action: 'add' | 'remove' | 'toggle', path: string): Promise<WorkspaceFavoritesDoc> {
  const normalizedPath = normalizePath(path)
  const current = await readWorkspaceFavorites()

  const set = new Set(current.favorites)

  if (action === 'add') {
    set.add(normalizedPath)
  } else if (action === 'remove') {
    set.delete(normalizedPath)
  } else {
    if (set.has(normalizedPath)) set.delete(normalizedPath)
    else set.add(normalizedPath)
  }

  const next: WorkspaceFavoritesDoc = {
    ...current,
    favorites: Array.from(set).sort((a, b) => a.localeCompare(b)),
  }

  await writeWorkspaceFavorites(next)
  return next
}

export async function touchRecent(path: string): Promise<WorkspaceFavoritesDoc> {
  const normalizedPath = normalizePath(path)
  const current = await readWorkspaceFavorites()
  const touchedAt = new Date().toISOString()

  const recents = [
    { path: normalizedPath, touchedAt },
    ...current.recents.filter((item) => item.path !== normalizedPath),
  ].slice(0, RECENTS_LIMIT)

  const next: WorkspaceFavoritesDoc = {
    ...current,
    recents,
  }

  await writeWorkspaceFavorites(next)
  return next
}
