import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const MIGRATION_TRACKING_TABLE = '_clawcontrol_migrations'

type PrismaLikeClient = {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>
  $executeRawUnsafe(query: string): Promise<number>
  $disconnect(): Promise<void>
}

type PrismaLikeClientCtor = new (options?: {
  adapter?: unknown
  log?: Array<'query' | 'error' | 'warn'>
}) => PrismaLikeClient

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

function findMigrationsDir(serverDir: string): string {
  const candidates = [
    path.join(serverDir, 'apps', 'clawcontrol', 'prisma', 'migrations'),
    path.join(serverDir, 'prisma', 'migrations'),
  ]

  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) {
    throw new Error(
      `Packaged migrations not found under ${serverDir}. Expected prisma/migrations in server bundle.`
    )
  }
  return found
}

function listMigrations(migrationsDir: string): Array<{ id: string; filePath: string }> {
  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const migrations = entries
    .map((id) => ({
      id,
      filePath: path.join(migrationsDir, id, 'migration.sql'),
    }))
    .filter((entry) => fs.existsSync(entry.filePath))

  if (migrations.length === 0) {
    throw new Error(`No migration.sql files found in ${migrationsDir}`)
  }

  return migrations
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
        current += ch
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

async function readAppliedMigrations(prisma: PrismaLikeClient): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "${MIGRATION_TRACKING_TABLE}"`
  )
  return new Set(rows.map((row) => row.id))
}

async function ensureMigrationTrackingTable(prisma: PrismaLikeClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${MIGRATION_TRACKING_TABLE}" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function getTableColumns(prisma: PrismaLikeClient, tableName: string): Promise<Set<string>> {
  const safeTableName = tableName.replace(/"/g, '""')
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${safeTableName}")`
  )
  return new Set(rows.map((row) => row.name))
}

async function isSchemaCurrent(prisma: PrismaLikeClient): Promise<boolean> {
  const requiredColumns: Record<string, string[]> = {
    work_orders: ['id', 'owner_type', 'owner_agent_id', 'tags', 'workflow_id', 'current_stage'],
    operations: [
      'id',
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
      'id',
      'operation_id',
      'work_order_id',
      'story_index',
      'story_key',
      'acceptance_criteria_json',
      'status',
    ],
    agents: ['id', 'display_name', 'slug', 'runtime_agent_id', 'kind', 'dispatch_eligible', 'fallbacks'],
    activities: ['id', 'actor_type', 'actor_agent_id'],
    artifacts: ['id', 'created_by_agent_id'],
    stations: ['id', 'name', 'sort_order'],
    agent_sessions: ['id', 'session_id', 'state'],
  }

  for (const [tableName, columns] of Object.entries(requiredColumns)) {
    const tableColumns = await getTableColumns(prisma, tableName)
    if (tableColumns.size === 0) return false
    for (const column of columns) {
      if (!tableColumns.has(column)) return false
    }
  }

  return true
}

function isIgnorableSqlError(message: string, statement: string): boolean {
  const msg = message.toLowerCase()
  const sql = statement.trim().toLowerCase()

  if (msg.includes('already exists')) {
    return (
      sql.startsWith('create table') ||
      sql.startsWith('create index') ||
      sql.startsWith('create unique index')
    )
  }

  if (msg.includes('duplicate column name')) {
    return sql.startsWith('alter table') && sql.includes(' add column ')
  }

  return false
}

async function applyMigration(
  prisma: PrismaLikeClient,
  migrationId: string,
  migrationSqlPath: string
): Promise<void> {
  const sql = fs.readFileSync(migrationSqlPath, 'utf8')
  const statements = splitSqlStatements(sql)

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement)
    } catch (error) {
      const message = getErrorMessage(error)
      if (!isIgnorableSqlError(message, statement)) {
        const snippet = statement.replace(/\s+/g, ' ').slice(0, 220)
        throw new Error(`[db:migrate] ${migrationId} failed: ${message}. SQL: ${snippet}`)
      }
      console.warn(`[db:migrate] Ignored for ${migrationId}: ${message}`)
    }
  }

  const escapedId = escapeSqlString(migrationId)
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "${MIGRATION_TRACKING_TABLE}" ("id") VALUES ('${escapedId}')`
  )
}

async function baselineMigrations(prisma: PrismaLikeClient, migrationIds: string[]): Promise<void> {
  for (const id of migrationIds) {
    const escapedId = escapeSqlString(id)
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "${MIGRATION_TRACKING_TABLE}" ("id") VALUES ('${escapedId}')`
    )
  }
}

export async function ensurePackagedDatabaseSchema(
  serverDir: string,
  databasePath: string
): Promise<void> {
  const migrationsDir = findMigrationsDir(serverDir)
  const migrations = listMigrations(migrationsDir)
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  const requireFromServer = createRequire(path.join(serverDir, 'package.json'))
  const prismaModule = requireFromServer('@prisma/client') as {
    PrismaClient: PrismaLikeClientCtor
  }
  const adapterModule = requireFromServer('@prisma/adapter-better-sqlite3') as {
    PrismaBetterSqlite3: new (config: { url: string }) => unknown
  }

  const PrismaClient = prismaModule.PrismaClient
  const adapter = new adapterModule.PrismaBetterSqlite3({ url: databasePath })
  const prisma = new PrismaClient({
    adapter,
    log: ['error'],
  })

  try {
    await ensureMigrationTrackingTable(prisma)

    const applied = await readAppliedMigrations(prisma)
    if (applied.size === 0 && (await isSchemaCurrent(prisma))) {
      await baselineMigrations(
        prisma,
        migrations.map((migration) => migration.id)
      )
      console.log('[db:migrate] Existing schema detected; migration baseline recorded')
      return
    }

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue
      console.log(`[db:migrate] Applying ${migration.id}`)
      await applyMigration(prisma, migration.id, migration.filePath)
    }

    if (!(await isSchemaCurrent(prisma))) {
      throw new Error('Database schema bootstrap incomplete after applying packaged migrations')
    }
  } finally {
    await prisma.$disconnect()
  }
}
