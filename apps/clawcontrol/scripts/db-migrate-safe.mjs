#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const MIGRATION_TRACKING_TABLE = '_clawcontrol_migrations'
const DEFAULT_DATABASE_URL = 'file:./data/clawcontrol.db'
const LEGACY_DATABASE_URL_PREFIX = 'file:../data/clawcontrol.db'

function legacyUrlToPreferredUrl(value) {
  const suffix = value.slice(LEGACY_DATABASE_URL_PREFIX.length)
  const currentPath = path.resolve(process.cwd(), './data/clawcontrol.db')
  const legacyPath = path.resolve(process.cwd(), '../data/clawcontrol.db')

  if (!fs.existsSync(currentPath) && fs.existsSync(legacyPath)) {
    const legacyUrl = `${LEGACY_DATABASE_URL_PREFIX}${suffix}`
    console.warn(`[db:migrate] Preserving legacy DATABASE_URL location: ${legacyUrl}`)
    return legacyUrl
  }

  const normalized = `${DEFAULT_DATABASE_URL}${suffix}`
  console.warn(`[db:migrate] Normalizing legacy DATABASE_URL ${value} -> ${normalized}`)
  return normalized
}

function normalizeDatabaseUrl(databaseUrl) {
  const value = (databaseUrl || DEFAULT_DATABASE_URL).trim()
  if (!value) return DEFAULT_DATABASE_URL
  if (value === LEGACY_DATABASE_URL_PREFIX || value.startsWith(`${LEGACY_DATABASE_URL_PREFIX}?`)) {
    return legacyUrlToPreferredUrl(value)
  }
  return value
}

function runPrismaMigrateDeploy() {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)

  return result
}

function resolveDatabasePath(databaseUrl) {
  if (!databaseUrl || !databaseUrl.toLowerCase().startsWith('file:')) {
    throw new Error('DATABASE_URL must use a file: SQLite URL for local migration fallback.')
  }

  const raw = databaseUrl.slice(5)
  if (!raw) {
    throw new Error('DATABASE_URL file: URL must include a path.')
  }

  if (raw.startsWith('//')) {
    const parsed = new URL(databaseUrl)
    return decodeURIComponent(parsed.pathname)
  }

  return raw.startsWith('/') ? raw : path.resolve(process.cwd(), raw)
}

function listMigrations(migrationsDir) {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, filePath: path.join(migrationsDir, id, 'migration.sql') }))
    .filter((entry) => fs.existsSync(entry.filePath))
}

function splitSqlStatements(sql) {
  const statements = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let inBlockComment = false
  let inTriggerDefinition = false

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '-' && next === '-') {
        inLineComment = true
        i += 1
        continue
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true
        i += 1
        continue
      }
    }

    if (ch === '\'' && !inDoubleQuote) {
      if (inSingleQuote && next === '\'') {
        current += "''"
        i += 1
        continue
      }
      inSingleQuote = !inSingleQuote
      current += ch
      continue
    }

    if (ch === '"' && !inSingleQuote) {
      if (inDoubleQuote && next === '"') {
        current += '""'
        i += 1
        continue
      }
      inDoubleQuote = !inDoubleQuote
      current += ch
      continue
    }

    if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
      if (inTriggerDefinition) {
        if (/END\s*$/i.test(current.trim())) {
          const trimmed = current.trim()
          if (trimmed) statements.push(trimmed)
          current = ''
          inTriggerDefinition = false
        } else {
          current += ch
        }
        continue
      }

      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ''
      continue
    }

    current += ch

    if (!inTriggerDefinition) {
      const normalized = current.trimStart().toUpperCase()
      if (normalized.startsWith('CREATE TRIGGER')) {
        inTriggerDefinition = true
      }
    }
  }

  const trailing = current.trim()
  if (trailing) statements.push(trailing)

  return statements
}

function isIgnorableSqlError(message, sql) {
  const msg = message.toLowerCase()
  const statement = sql.trim().toLowerCase()

  if (msg.includes('already exists')) {
    return (
      statement.startsWith('create table')
      || statement.startsWith('create index')
      || statement.startsWith('create unique index')
    )
  }

  if (msg.includes('duplicate column name')) {
    return statement.startsWith('alter table') && /\badd\s+column\b/i.test(statement)
  }

  if (msg.includes('no such table')) return statement.startsWith('drop table')
  if (msg.includes('no such index')) return statement.startsWith('drop index')
  if (msg.includes('no such trigger')) return statement.startsWith('drop trigger')

  return false
}

function applyMigrationsWithSqliteFallback() {
  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL)
  const migrationsDir = process.env.CLAWCONTROL_MIGRATIONS_DIR
    ? path.resolve(process.env.CLAWCONTROL_MIGRATIONS_DIR)
    : path.resolve(process.cwd(), 'prisma', 'migrations')

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migration directory not found: ${migrationsDir}`)
  }

  const databasePath = resolveDatabasePath(databaseUrl)
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  const db = new Database(databasePath)

  try {
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS "${MIGRATION_TRACKING_TABLE}" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "checksum" TEXT,
        "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const readApplied = db.prepare(`SELECT id FROM "${MIGRATION_TRACKING_TABLE}"`)
    const insertApplied = db.prepare(`
      INSERT OR IGNORE INTO "${MIGRATION_TRACKING_TABLE}" (id, checksum)
      VALUES (?, ?)
    `)

    const applied = new Set(readApplied.all().map((row) => row.id))
    const migrations = listMigrations(migrationsDir)

    let appliedCount = 0

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue

      const sql = fs.readFileSync(migration.filePath, 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const statements = splitSqlStatements(sql)

      const tx = db.transaction(() => {
        for (const statement of statements) {
          try {
            db.exec(statement)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (!isIgnorableSqlError(message, statement)) {
              throw new Error(`[db:migrate] ${migration.id} failed: ${message}`)
            }
          }
        }
        insertApplied.run(migration.id, checksum)
      })

      tx()
      applied.add(migration.id)
      appliedCount += 1
    }

    console.warn(`[db:migrate] SQLite fallback applied ${appliedCount} migration(s).`)
  } finally {
    db.close()
  }
}

const deploy = runPrismaMigrateDeploy()
if ((deploy.status ?? 1) === 0) {
  process.exit(0)
}

const combinedOutput = `${deploy.stdout ?? ''}\n${deploy.stderr ?? ''}`.toLowerCase()
const fallbackReasons = [
  combinedOutput.includes('schema engine error'),
  combinedOutput.includes('error: p3005'),
]

if (!fallbackReasons.some(Boolean)) {
  process.exit(deploy.status ?? 1)
}

if (combinedOutput.includes('schema engine error')) {
  console.warn('[db:migrate] prisma migrate deploy failed with a schema-engine error.')
} else if (combinedOutput.includes('error: p3005')) {
  console.warn('[db:migrate] prisma migrate deploy reported P3005 on a non-empty local database.')
}
console.warn('[db:migrate] Falling back to local SQLite migration execution.')

try {
  applyMigrationsWithSqliteFallback()
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
