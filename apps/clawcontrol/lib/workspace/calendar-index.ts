import 'server-only'

import { promises as fsp } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative } from 'node:path'
import { getAllowedSubdirs, getWorkspaceRoot, validateWorkspacePath } from '@/lib/fs/path-policy'
import { encodeWorkspaceId } from '@/lib/fs/workspace-fs'

export interface CalendarFileEntry {
  id: string
  path: string
  name: string
  createdAt: string | null
  lastEditedAt: string
}

export interface WorkspaceCalendarResult {
  month: string
  root: string
  folder: string
  days: Array<{
    day: string
    count: number
    files: CalendarFileEntry[]
  }>
}

interface DateFileDetector {
  name: string
  match: (filename: string) => Date | null
}

const detectors: DateFileDetector[] = [
  {
    name: 'iso-date-markdown',
    match: (filename) => {
      const matched = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/)
      if (!matched) return null
      const date = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])))
      return Number.isNaN(date.getTime()) ? null : date
    },
  },
]

function parseMonth(month: string): { start: Date; end: Date } {
  const matched = month.match(/^(\d{4})-(\d{2})$/)
  if (!matched) throw new Error('Invalid month format. Expected YYYY-MM')

  const year = Number(matched[1])
  const monthIndex = Number(matched[2]) - 1

  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999))

  return { start, end }
}

function toWorkspacePath(absPath: string): string {
  const root = getWorkspaceRoot()
  const rel = relative(root, absPath).replace(/\\/g, '/')
  return `/${rel}`
}

function createdAtFromStat(stat: Awaited<ReturnType<typeof fsp.stat>>): string | null {
  const birth = stat.birthtime
  if (!birth || Number.isNaN(birth.getTime()) || birth.getTime() <= 0) return null
  if (birth.getTime() > Date.now() + 60_000) return null
  return birth.toISOString()
}

async function collectDateFiles(dirAbsPath: string, out: Array<{ absPath: string; date: Date }>): Promise<void> {
  let entries: Dirent[] = []
  try {
    entries = await fsp.readdir(dirAbsPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const absPath = join(dirAbsPath, ent.name)

    if (ent.isDirectory()) {
      await collectDateFiles(absPath, out)
      continue
    }

    if (!ent.isFile()) continue

    for (const detector of detectors) {
      const detectedDate = detector.match(ent.name)
      if (detectedDate) {
        out.push({ absPath, date: detectedDate })
        break
      }
    }
  }
}

export async function getWorkspaceCalendar(input: {
  month: string
  root?: string | null
  folder?: string | null
}): Promise<WorkspaceCalendarResult> {
  const { start, end } = parseMonth(input.month)
  const rootName = (input.root || 'memory').trim() || 'memory'

  const allowed = new Set(getAllowedSubdirs())
  const defaultFolder = `/${allowed.has(rootName) ? rootName : 'memory'}`
  const folder = (input.folder && input.folder.startsWith('/')) ? input.folder : defaultFolder

  const validation = validateWorkspacePath(folder)
  if (!validation.valid || !validation.resolvedPath) {
    throw new Error(validation.error || 'Invalid folder')
  }

  const collected: Array<{ absPath: string; date: Date }> = []
  await collectDateFiles(validation.resolvedPath, collected)

  const grouped = new Map<string, CalendarFileEntry[]>()

  for (const item of collected) {
    if (item.date < start || item.date > end) continue

    const workspacePath = toWorkspacePath(item.absPath)

    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(item.absPath)
    } catch {
      continue
    }

    const day = item.date.toISOString().slice(0, 10)
    const list = grouped.get(day) ?? []

    list.push({
      id: encodeWorkspaceId(workspacePath),
      path: workspacePath,
      name: item.absPath.split('/').pop() || workspacePath,
      createdAt: createdAtFromStat(stat),
      lastEditedAt: stat.mtime.toISOString(),
    })

    grouped.set(day, list)
  }

  const days = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, files]) => ({
      day,
      count: files.length,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    }))

  return {
    month: input.month,
    root: rootName,
    folder,
    days,
  }
}
