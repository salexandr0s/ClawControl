import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { invalidateWorkspaceRootCache } from '@/lib/fs/path-policy'
import { clearWorkflowRegistryCache } from '@/lib/workflows/registry'

type MockTeam = {
  id: string
  slug: string
  name: string
  description: string | null
  source: 'builtin' | 'custom' | 'imported'
  workflowIds: string[]
  templateIds: string[]
  hierarchy: {
    version: 1
    members: Record<string, {
      reportsTo: string | null
      delegatesTo: string[]
      receivesFrom: string[]
      canMessage: string[]
      capabilities: Record<string, boolean>
    }>
  }
  healthStatus: 'healthy' | 'warning' | 'degraded' | 'unknown'
}

const repoState = vi.hoisted(() => {
  const byId = new Map<string, MockTeam>()
  const bySlug = new Map<string, MockTeam>()

  return {
    byId,
    bySlug,
    reset: () => {
      byId.clear()
      bySlug.clear()
    },
    agentTeams: {
      getBySlug: async (slug: string) => bySlug.get(slug) ?? null,
      create: async (input: {
        name: string
        slug?: string
        description?: string | null
        source?: MockTeam['source']
        workflowIds?: string[]
        templateIds?: string[]
        hierarchy?: MockTeam['hierarchy']
        healthStatus?: MockTeam['healthStatus']
      }) => {
        const id = `team_${randomUUID()}`
        const slug = input.slug ?? `team-${id}`
        const team: MockTeam = {
          id,
          slug,
          name: input.name,
          description: input.description ?? null,
          source: input.source ?? 'imported',
          workflowIds: input.workflowIds ?? [],
          templateIds: input.templateIds ?? [],
          hierarchy: input.hierarchy ?? { version: 1, members: {} },
          healthStatus: input.healthStatus ?? 'unknown',
        }
        byId.set(id, team)
        bySlug.set(slug, team)
        return team
      },
      update: async (id: string, input: Partial<Omit<MockTeam, 'id' | 'slug' | 'source'>> & {
        workflowIds?: string[]
        templateIds?: string[]
        healthStatus?: MockTeam['healthStatus']
      }) => {
        const existing = byId.get(id)
        if (!existing) return null

        const next: MockTeam = {
          ...existing,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.workflowIds !== undefined ? { workflowIds: input.workflowIds } : {}),
          ...(input.templateIds !== undefined ? { templateIds: input.templateIds } : {}),
          ...(input.hierarchy !== undefined ? { hierarchy: input.hierarchy } : {}),
          ...(input.healthStatus !== undefined ? { healthStatus: input.healthStatus } : {}),
        }
        byId.set(id, next)
        bySlug.set(next.slug, next)
        return next
      },
      delete: async (id: string) => {
        const existing = byId.get(id)
        if (!existing) return false
        byId.delete(id)
        bySlug.delete(existing.slug)
        return true
      },
    },
  }
})

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    agentTeams: repoState.agentTeams,
  }),
}))

const originalOpenClawWorkspace = process.env.OPENCLAW_WORKSPACE
const originalSettingsPath = process.env.CLAWCONTROL_SETTINGS_PATH
const originalClawcontrolWorkspaceRoot = process.env.CLAWCONTROL_WORKSPACE_ROOT
const originalWorkspaceRoot = process.env.WORKSPACE_ROOT
const originalDatabaseUrl = process.env.DATABASE_URL
const originalMigrationsDir = process.env.CLAWCONTROL_MIGRATIONS_DIR

let tempWorkspace = ''

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

async function buildTestPackZip(input: {
  workflowDescription: string
  templateNotes: string
  teamName: string
  includeHierarchy?: boolean
}): Promise<File> {
  const zip = new JSZip()

  zip.file(
    'clawcontrol-package.yaml',
    [
      'id: test-pack',
      'name: Test Pack',
      'version: 1.0.0',
      'kind: team_with_workflows',
      'description: Test pack for update flow',
      // YAML can auto-coerce ISO timestamps; quote to keep this a string for schema validation.
      `createdAt: "${new Date().toISOString()}"`,
      'createdBy: test',
      '',
    ].join('\n')
  )

  zip.file(
    'workflows/test_flow.yaml',
    [
      'id: test_flow',
      `description: ${input.workflowDescription}`,
      'stages:',
      '  - ref: plan',
      '    agent: plan',
      '',
    ].join('\n')
  )

  const teamLines = [
    'id: test-team',
    'slug: test-team',
    `name: ${input.teamName}`,
    'description: test',
    'source: imported',
    'workflowIds:',
    '  - test_flow',
    'templateIds:',
    '  - test_template',
  ]
  if (input.includeHierarchy !== false) {
    teamLines.push(
      'hierarchy:',
      '  version: 1',
      '  members:',
      '    test_template:',
      '      reportsTo: null',
      '      delegatesTo: []',
      '      receivesFrom: []',
      '      canMessage: []',
      '      capabilities: {}',
    )
  }
  teamLines.push('healthStatus: healthy', '')

  zip.file('teams/test-team.yaml', teamLines.join('\n'))

  zip.file(
    'agent-templates/test_template/template.json',
    JSON.stringify({ id: 'test_template', name: 'Test Template', version: '1.0.0' }, null, 2)
  )
  zip.file('agent-templates/test_template/notes.md', input.templateNotes)

  // `File` expects web-ish BlobParts. Convert to a plain ArrayBuffer to satisfy TS' `BlobPart` types
  // (typed arrays are generic over ArrayBufferLike in newer TS libs).
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const arrayBuffer = (bytes.buffer as ArrayBuffer).slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  )
  return new File([arrayBuffer], 'test-pack.zip', { type: 'application/zip' })
}

beforeEach(async () => {
  repoState.reset()

  tempWorkspace = join(tmpdir(), `packages-update-flow-${randomUUID()}`)
  await fsp.mkdir(tempWorkspace, { recursive: true })
  await fsp.mkdir(join(tempWorkspace, 'agent-templates'), { recursive: true })

  process.env.OPENCLAW_WORKSPACE = tempWorkspace
  process.env.CLAWCONTROL_SETTINGS_PATH = join(tempWorkspace, 'settings.json')
  delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  delete process.env.WORKSPACE_ROOT

  await fsp.writeFile(
    process.env.CLAWCONTROL_SETTINGS_PATH,
    JSON.stringify({ workspacePath: tempWorkspace, updatedAt: new Date().toISOString() })
  )

  const dbPath = join(tempWorkspace, 'test.db')
  process.env.DATABASE_URL = `file:${dbPath}`
  process.env.CLAWCONTROL_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

  invalidateWorkspaceRootCache()
  clearWorkflowRegistryCache()
  delete (globalThis as { prisma?: unknown }).prisma
  vi.resetModules()

  const { ensureDatabaseInitialized } = await import('@/lib/db/init')
  await ensureDatabaseInitialized()
})

afterEach(async () => {
  try {
    const { prisma } = await import('@/lib/db')
    await prisma.$disconnect()
  } catch {
    // ignore
  }

  restoreEnv('OPENCLAW_WORKSPACE', originalOpenClawWorkspace)
  restoreEnv('CLAWCONTROL_SETTINGS_PATH', originalSettingsPath)
  restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
  restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)
  restoreEnv('DATABASE_URL', originalDatabaseUrl)
  restoreEnv('CLAWCONTROL_MIGRATIONS_DIR', originalMigrationsDir)

  invalidateWorkspaceRootCache()
  clearWorkflowRegistryCache()
  delete (globalThis as { prisma?: unknown }).prisma
  vi.resetModules()

  const workspaceToRemove = tempWorkspace
  tempWorkspace = ''
  if (workspaceToRemove) {
    await fsp.rm(workspaceToRemove, { recursive: true, force: true })
  }
})

describe('package deploy update flow', () => {
  it('updates conflicting workflows/templates/teams when overwrite flags are enabled', async () => {
    const { analyzePackageImport, deployStagedPackage } = await import('@/lib/packages/service')

    const first = await buildTestPackZip({
      workflowDescription: 'v1 workflow',
      templateNotes: 'v1 notes',
      teamName: 'Team v1',
    })
    const analysis1 = await analyzePackageImport(first)
    await deployStagedPackage({
      packageId: analysis1.packageId,
      options: {
        applyTemplates: true,
        applyWorkflows: true,
        applyTeams: true,
        applySelection: false,
      },
    })

    const workflowPath = join(tempWorkspace, 'workflows', 'test_flow.yaml')
    const templatePath = join(tempWorkspace, 'agent-templates', 'test_template', 'notes.md')

    expect(await fsp.readFile(workflowPath, 'utf8')).toContain('description: v1 workflow')
    expect(await fsp.readFile(templatePath, 'utf8')).toBe('v1 notes')
    expect(repoState.bySlug.get('test-team')?.name).toBe('Team v1')

    const second = await buildTestPackZip({
      workflowDescription: 'v2 workflow',
      templateNotes: 'v2 notes',
      teamName: 'Team v2',
    })
    const analysis2 = await analyzePackageImport(second)
    await deployStagedPackage({
      packageId: analysis2.packageId,
      options: {
        applyTemplates: true,
        applyWorkflows: true,
        applyTeams: true,
        applySelection: false,
        overwriteTemplates: true,
        overwriteWorkflows: true,
        overwriteTeams: true,
      },
    })

    expect(await fsp.readFile(workflowPath, 'utf8')).toContain('description: v2 workflow')
    expect(await fsp.readFile(templatePath, 'utf8')).toBe('v2 notes')
    expect(repoState.bySlug.get('test-team')?.name).toBe('Team v2')
  })

  it('rejects conflicting deploys when overwrite flags are disabled', async () => {
    const { analyzePackageImport, deployStagedPackage } = await import('@/lib/packages/service')

    const first = await buildTestPackZip({
      workflowDescription: 'v1 workflow',
      templateNotes: 'v1 notes',
      teamName: 'Team v1',
    })
    const analysis1 = await analyzePackageImport(first)
    await deployStagedPackage({
      packageId: analysis1.packageId,
      options: {
        applyTemplates: true,
        applyWorkflows: true,
        applyTeams: true,
        applySelection: false,
      },
    })

    const second = await buildTestPackZip({
      workflowDescription: 'v2 workflow',
      templateNotes: 'v2 notes',
      teamName: 'Team v2',
    })
    const analysis2 = await analyzePackageImport(second)

    await expect(deployStagedPackage({
      packageId: analysis2.packageId,
      options: {
        applyTemplates: true,
        applyWorkflows: true,
        applyTeams: true,
        applySelection: false,
      },
    })).rejects.toMatchObject({ status: 409 })
  })

  it('fails analysis when team hierarchy is missing', async () => {
    const { analyzePackageImport } = await import('@/lib/packages/service')

    const invalid = await buildTestPackZip({
      workflowDescription: 'v1 workflow',
      templateNotes: 'v1 notes',
      teamName: 'Team v1',
      includeHierarchy: false,
    })

    await expect(analyzePackageImport(invalid)).rejects.toMatchObject({
      code: 'PACKAGE_VALIDATION_FAILED',
      status: 400,
    })
  })
})
