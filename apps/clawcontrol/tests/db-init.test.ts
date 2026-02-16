import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('database initialization', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalMigrationsDir = process.env.CLAWCONTROL_MIGRATIONS_DIR

  afterEach(async () => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl

    if (originalMigrationsDir === undefined) delete process.env.CLAWCONTROL_MIGRATIONS_DIR
    else process.env.CLAWCONTROL_MIGRATIONS_DIR = originalMigrationsDir

    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()
  })

  it('creates and migrates a fresh sqlite database on first initialization', async () => {
    const tempRoot = join(tmpdir(), `db-init-success-${randomUUID()}`)
    const dbPath = join(tempRoot, 'fresh.db')
    await fsp.mkdir(tempRoot, { recursive: true })

    process.env.DATABASE_URL = `file:${dbPath}`
    process.env.CLAWCONTROL_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()

    const mod = await import('@/lib/db/init')
    const status = await mod.ensureDatabaseInitialized()
    const { prisma } = await import('@/lib/db')

    expect(status.ok).toBe(true)
    expect(status.initialized).toBe(true)
    expect(status.code).toBeNull()
    await expect(fsp.stat(dbPath)).resolves.toBeDefined()

    const operationColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("operations")'
    )
    const operationColumnNames = new Set(operationColumns.map((row) => row.name))
    expect(operationColumnNames.has('execution_type')).toBe(true)
    expect(operationColumnNames.has('loop_config_json')).toBe(true)
    expect(operationColumnNames.has('claimed_by')).toBe(true)

    const storyColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("operation_stories")'
    )
    const storyColumnNames = new Set(storyColumns.map((row) => row.name))
    expect(storyColumnNames.has('story_key')).toBe(true)
    expect(storyColumnNames.has('acceptance_criteria_json')).toBe(true)

    const appliedMigrations = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT id FROM "_clawcontrol_migrations"'
    )
    expect(appliedMigrations.some((row) => row.id === '20260210190000_manager_engine_single_mode')).toBe(true)
    expect(appliedMigrations.some((row) => row.id === '20260212083000_workflow_team_packages')).toBe(true)
    expect(appliedMigrations.some((row) => row.id === '20260216193000_team_hierarchy_v1')).toBe(true)

    const agentColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("agents")'
    )
    const agentColumnNames = new Set(agentColumns.map((row) => row.name))
    expect(agentColumnNames.has('team_id')).toBe(true)
    expect(agentColumnNames.has('template_id')).toBe(true)

    const agentTeamTable = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_teams' LIMIT 1"
    )
    expect(agentTeamTable.length).toBe(1)

    const agentTeamColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("agent_teams")'
    )
    const agentTeamColumnNames = new Set(agentTeamColumns.map((row) => row.name))
    expect(agentTeamColumnNames.has('hierarchy_json')).toBe(true)

    await prisma.$disconnect()

    await fsp.rm(tempRoot, { recursive: true, force: true })
  })

  it('applies newly added migrations even when the required schema is already present', async () => {
    const tempRoot = join(tmpdir(), `db-init-upgrade-${randomUUID()}`)
    const dbPath = join(tempRoot, 'fresh.db')
    await fsp.mkdir(tempRoot, { recursive: true })

    process.env.DATABASE_URL = `file:${dbPath}`
    process.env.CLAWCONTROL_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()

    const mod = await import('@/lib/db/init')
    const first = await mod.ensureDatabaseInitialized()
    expect(first.ok).toBe(true)

    const { prisma } = await import('@/lib/db')
    const scanTableBefore = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='artifact_scan_records' LIMIT 1"
    )
    expect(scanTableBefore.length).toBe(1)

    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "artifact_scan_records"')
    await prisma.$executeRawUnsafe(
      "DELETE FROM \"_clawcontrol_migrations\" WHERE id = '20260215160000_security_scans_activity_taxonomy'"
    )
    await prisma.$disconnect()

    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()

    const mod2 = await import('@/lib/db/init')
    const second = await mod2.ensureDatabaseInitialized()
    expect(second.ok).toBe(true)

    const { prisma: prisma2 } = await import('@/lib/db')
    const scanTableAfter = await prisma2.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='artifact_scan_records' LIMIT 1"
    )
    expect(scanTableAfter.length).toBe(1)
    await prisma2.$disconnect()

    await fsp.rm(tempRoot, { recursive: true, force: true })
  })

  it('returns DB_MIGRATION_FAILED when schema is missing and migrations directory is unavailable', async () => {
    const tempRoot = join(tmpdir(), `db-init-${randomUUID()}`)
    const dbPath = join(tempRoot, 'fresh.db')
    const emptyMigrationsDir = join(tempRoot, 'empty-migrations')
    await fsp.mkdir(tempRoot, { recursive: true })
    await fsp.mkdir(emptyMigrationsDir, { recursive: true })

    process.env.DATABASE_URL = `file:${dbPath}`
    process.env.CLAWCONTROL_MIGRATIONS_DIR = emptyMigrationsDir

    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()

    const mod = await import('@/lib/db/init')
    const status = await mod.ensureDatabaseInitialized()

    expect(status.ok).toBe(false)
    expect(status.code).toBe('DB_MIGRATION_FAILED')
    expect(status.message).toContain('migration')

    await fsp.rm(tempRoot, { recursive: true, force: true })
  })
})
