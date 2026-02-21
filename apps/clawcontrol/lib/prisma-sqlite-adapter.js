import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_DATABASE_URL = 'file:./data/clawcontrol.db'
const LEGACY_DATABASE_URL_PREFIX = 'file:../data/clawcontrol.db'

function legacyUrlToPreferredUrl(value) {
  const suffix = value.slice(LEGACY_DATABASE_URL_PREFIX.length)
  const currentPath = resolve(process.cwd(), './data/clawcontrol.db')
  const legacyPath = resolve(process.cwd(), '../data/clawcontrol.db')

  if (!existsSync(currentPath) && existsSync(legacyPath)) {
    return `${LEGACY_DATABASE_URL_PREFIX}${suffix}`
  }

  return `${DEFAULT_DATABASE_URL}${suffix}`
}

function normalizeDatabaseUrl(databaseUrl) {
  const value = (databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL).trim()
  if (!value) return DEFAULT_DATABASE_URL
  if (value === LEGACY_DATABASE_URL_PREFIX || value.startsWith(`${LEGACY_DATABASE_URL_PREFIX}?`)) {
    return legacyUrlToPreferredUrl(value)
  }
  return value
}

function decodeFileUrlPath(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl)
    return decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
}

export function sqlitePathFromDatabaseUrl(databaseUrl) {
  const normalized = normalizeDatabaseUrl(databaseUrl)

  if (normalized === ':memory:' || normalized === 'file::memory:') {
    return ':memory:'
  }

  if (!normalized.toLowerCase().startsWith('file:')) {
    throw new Error(`Unsupported DATABASE_URL for sqlite adapter: ${normalized}`)
  }

  const raw = normalized.slice(5)
  if (!raw) {
    throw new Error(`Invalid DATABASE_URL (empty file path): ${normalized}`)
  }

  if (raw.startsWith('//')) {
    const decoded = decodeFileUrlPath(normalized)
    if (!decoded) {
      throw new Error(`Invalid DATABASE_URL (unparseable file URL): ${normalized}`)
    }
    return decoded
  }

  return raw.split('?')[0]
}

export function createSqliteAdapter(databaseUrl) {
  const url = sqlitePathFromDatabaseUrl(databaseUrl)
  return new PrismaBetterSqlite3({ url })
}
