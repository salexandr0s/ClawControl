import 'server-only'

import fs from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { prisma } from '@/lib/db'

const MIGRATION_TRACKING_TABLE = '_clawcontrol_migrations'

export type DbInitErrorCode = 'DB_INIT_FAILED' | 'DB_MIGRATION_FAILED' | 'DB_UNREADABLE'

export interface DbInitStatus {
  ok: boolean
  initialized: boolean
  code: DbInitErrorCode | null
  message: string
  databaseUrl: string | null
  databasePath: string | null
  migrationsDir: string | null
  timestamp: string
}

interface MigrationEntry {
  id: string
  filePath: string
}

const REQUIRED_TABLES = ['work_orders', 'operations', 'operation_stories', 'agents', 'agent_teams']
const REQUIRED_COLUMNS_BY_TABLE: Record<string, readonly string[]> = {
  work_orders: ['owner_type', 'owner_agent_id', 'tags', 'workflow_id', 'current_stage'],
  operations: [
    'workflow_id',
    'workflow_stage_index',
    'iteration_count',
    'execution_type',
    'loop_config_json',
    'current_story_id',
    'retry_count',
    'max_retries',
    'claimed_by',
    'claim_expires_at',
    'last_claimed_at',
    'timeout_count',
  ],
  operation_stories: [
    'operation_id',
    'work_order_id',
    'story_index',
    'story_key',
    'acceptance_criteria_json',
    'status',
  ],
  agents: ['dispatch_eligible', 'name_source', 'is_stale', 'stale_at', 'team_id'],
}

let lastStatus: DbInitStatus = {
  ok: false,
  initialized: false,
  code: null,
  message: 'Database has not been initialized yet',
  databaseUrl: process.env.DATABASE_URL ?? null,
  databasePath: null,
  migrationsDir: null,
  timestamp: new Date().toISOString(),
}

let initInFlight: Promise<DbInitStatus> | null = null

function statusNow(input: Partial<DbInitStatus>): DbInitStatus {
  return {
    ok: Boolean(input.ok),
    initialized: Boolean(input.initialized),
    code: input.code ?? null,
    message: input.message ?? 'Database initialization status updated',
    databaseUrl: input.databaseUrl ?? process.env.DATABASE_URL ?? null,
    databasePath: input.databasePath ?? null,
    migrationsDir: input.migrationsDir ?? null,
    timestamp: new Date().toISOString(),
  }
}

function toDatabasePath(databaseUrl: string | null | undefined): string | null {
  if (!databaseUrl) return null
  const trimmed = databaseUrl.trim()
  if (!trimmed.toLowerCase().startsWith('file:')) return null

  const raw = trimmed.slice(5)
  if (!raw) return null

  if (raw.startsWith('//')) {
    try {
      const parsed = new URL(trimmed)
      return resolve(decodeURIComponent(parsed.pathname))
    } catch {
      return null
    }
  }

  return raw.startsWith('/') ? resolve(raw) : resolve(process.cwd(), raw)
}

function migrationCandidates(): string[] {
  const envPath = process.env.CLAWCONTROL_MIGRATIONS_DIR?.trim()

  return [
    envPath ? resolve(envPath) : null,
    resolve(process.cwd(), 'prisma', 'migrations'),
    resolve(process.cwd(), 'apps', 'clawcontrol', 'prisma', 'migrations'),
    resolve(__dirname, '../../prisma/migrations'),
    resolve(__dirname, '../../../prisma/migrations'),
    resolve(__dirname, '../../../../prisma/migrations'),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0))
}

function findMigrationsDir(): string | null {
  const candidates = migrationCandidates()
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
  }
  return null
}

function listMigrations(migrationsDir: string): MigrationEntry[] {
  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  return entries
    .map((id) => ({ id, filePath: join(migrationsDir, id, 'migration.sql') }))
    .filter((entry) => fs.existsSync(entry.filePath) && fs.statSync(entry.filePath).isFile())
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
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
      if (ch === '\n') {
        inLineComment = false
      }
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
        current += '\'\''
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

function isIgnorableSqlError(message: string, sql: string): boolean {
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
    return statement.startsWith('alter table') && statement.includes(' add column ')
  }

  if (msg.includes('no such table')) {
    return statement.startsWith('drop table')
  }

  if (msg.includes('no such index')) {
    return statement.startsWith('drop index')
  }

  if (msg.includes('no such trigger')) {
    return statement.startsWith('drop trigger')
  }

  return false
}

async function ensureMigrationTrackingTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${MIGRATION_TRACKING_TABLE}" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function readAppliedMigrations(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "${MIGRATION_TRACKING_TABLE}"`
  )

  return new Set(rows.map((row) => row.id))
}

async function tableExists(tableName: string): Promise<boolean> {
  const safeName = tableName.replace(/"/g, '""')

  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${safeName}' LIMIT 1`
  )

  return rows.length > 0
}

async function tableColumns(tableName: string): Promise<Set<string>> {
  const safeName = tableName.replace(/"/g, '""')
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${safeName}")`
  )
  return new Set(rows.map((row) => row.name))
}

async function hasRequiredSchema(): Promise<boolean> {
  for (const tableName of REQUIRED_TABLES) {
    if (!(await tableExists(tableName))) return false
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_COLUMNS_BY_TABLE)) {
    const columns = await tableColumns(tableName)
    for (const column of requiredColumns) {
      if (!columns.has(column)) return false
    }
  }

  return true
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

async function applyMigration(migration: MigrationEntry): Promise<void> {
  const sql = fs.readFileSync(migration.filePath, 'utf8')
  const statements = splitSqlStatements(sql)

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!isIgnorableSqlError(message, statement)) {
        throw new Error(`[db:migrate] ${migration.id} failed: ${message}`)
      }
    }
  }

  const escaped = escapeSqlString(migration.id)
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "${MIGRATION_TRACKING_TABLE}" ("id") VALUES ('${escaped}')`
  )
}

async function applyMigrations(migrationsDir: string): Promise<{ appliedCount: number; totalMigrations: number }> {
  const migrations = listMigrations(migrationsDir)
  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${migrationsDir}`)
  }

  await ensureMigrationTrackingTable()

  const applied = await readAppliedMigrations()

  let appliedCount = 0

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    await applyMigration(migration)
    applied.add(migration.id)
    appliedCount += 1
  }

  if (!(await hasRequiredSchema())) {
    throw new Error('Database schema is incomplete after migration execution')
  }

  return { appliedCount, totalMigrations: migrations.length }
}

function detectFailureCode(error: unknown): DbInitErrorCode {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (lower.includes('migrate') || lower.includes('migration') || lower.includes('schema is incomplete')) {
    return 'DB_MIGRATION_FAILED'
  }

  if (
    lower.includes('enoent')
    || lower.includes('eacces')
    || lower.includes('readonly')
    || lower.includes('unable to open database file')
  ) {
    return 'DB_UNREADABLE'
  }

  return 'DB_INIT_FAILED'
}

async function initializeOnce(): Promise<DbInitStatus> {
  const databaseUrl = process.env.DATABASE_URL ?? null
  const databasePath = toDatabasePath(databaseUrl)
  const migrationsDir = findMigrationsDir()

  try {
    if (databasePath) {
      fs.mkdirSync(dirname(databasePath), { recursive: true })
    }

    // Ensure DB is reachable before trying to migrate.
    await prisma.$queryRawUnsafe('PRAGMA schema_version;')

    const schemaReady = await hasRequiredSchema()

    let appliedMigrations = 0
    if (migrationsDir) {
      const result = await applyMigrations(migrationsDir)
      appliedMigrations = result.appliedCount
    } else if (!schemaReady) {
      throw new Error('Could not locate prisma migration directory')
    }

    lastStatus = statusNow({
      ok: true,
    initialized: true,
    code: null,
    message: schemaReady
      ? appliedMigrations > 0
        ? `Database migrations applied (${appliedMigrations})`
        : 'Database schema already initialized'
      : 'Database schema initialized successfully',
    databaseUrl,
    databasePath,
    migrationsDir,
  })

    return lastStatus
  } catch (error) {
    const code = detectFailureCode(error)
    const message = error instanceof Error ? error.message : String(error)

    lastStatus = statusNow({
      ok: false,
      initialized: false,
      code,
      message,
      databaseUrl,
      databasePath,
      migrationsDir,
    })

    console.error('[db:init] Failed to initialize database:', {
      code,
      message,
      databaseUrl,
      databasePath,
      migrationsDir,
    })

    return lastStatus
  }
}

export async function ensureDatabaseInitialized(): Promise<DbInitStatus> {
  if (!initInFlight) {
    initInFlight = initializeOnce().finally(() => {
      initInFlight = null
    })
  }

  return initInFlight
}

export function getDatabaseInitStatus(): DbInitStatus {
  return lastStatus
}

export function resetDatabaseInitStatusForTests(): void {
  initInFlight = null
  lastStatus = statusNow({
    ok: false,
    initialized: false,
    code: null,
    message: 'Database has not been initialized yet',
    databaseUrl: process.env.DATABASE_URL ?? null,
    databasePath: null,
    migrationsDir: null,
  })
}
