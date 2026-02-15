import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { invalidateWorkspaceRootCache } from '@/lib/fs/path-policy'

// ---------------------------------------------------------------------------
// Mocks: bypass operator auth + approval gate + typed confirm enforcement
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: () => ({
    ok: true,
    principal: { actor: 'user:operator', actorType: 'user', actorId: 'operator', sessionId: 'sess' },
  }),
  asAuthErrorResponse: (result: { error: string; code: string }) => ({ error: result.error, code: result.code }),
}))

vi.mock('@/lib/approval-gate', () => ({
  ensureApprovalGate: async () => ({
    allowed: true,
    reason: 'approved',
    approval: { id: 'ap_test' },
    policy: { riskLevel: 'danger', confirmMode: 'CONFIRM', requiresApproval: true },
  }),
}))

vi.mock('@/lib/with-governor', () => ({
  enforceActionPolicy: async () => ({
    allowed: true,
    policy: { riskLevel: 'danger', confirmMode: 'CONFIRM', requiresApproval: true },
  }),
}))

let zipBytes: Uint8Array = new Uint8Array()
const testSlug = 'test-skill'
const testVersion = '1.0.0'

vi.mock('@/lib/clawhub/http-adapter', () => ({
  createHttpClawHubAdapter: () => ({
    searchSkills: async () => {
      throw new Error('not implemented in test')
    },
    getSkill: async () => ({
      skill: {
        slug: testSlug,
        displayName: 'Test Skill',
        summary: 'Test summary',
        tags: { latest: testVersion },
        stats: { comments: 0, downloads: 1, installsAllTime: 0, installsCurrent: 0, stars: 0, versions: 1 },
        createdAt: 0,
        updatedAt: 0,
      },
      latestVersion: { version: testVersion, createdAt: 0, changelog: '' },
      owner: null,
      moderation: { isSuspicious: false, isMalwareBlocked: false },
    }),
    listVersions: async () => ({ items: [{ version: testVersion, createdAt: 0, changelog: '', changelogSource: null }], nextCursor: null }),
    getSkillVersion: async () => ({
      skill: { slug: testSlug, displayName: 'Test Skill' },
      version: {
        version: testVersion,
        createdAt: 0,
        changelog: '',
        changelogSource: null,
        files: [{ path: 'SKILL.md', size: 12, sha256: 'deadbeef', contentType: 'text/markdown' }],
      },
    }),
    listFiles: async () => [{ path: 'SKILL.md', size: 12, sha256: 'deadbeef', contentType: 'text/markdown' }],
    getFile: async () => {
      throw new Error('not implemented in test')
    },
    downloadZip: async () => ({ bytes: zipBytes, contentType: 'application/zip', fileName: `${testSlug}-${testVersion}.zip` }),
  }),
}))

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  CLAWCONTROL_MIGRATIONS_DIR: process.env.CLAWCONTROL_MIGRATIONS_DIR,
  OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE,
  CLAWCONTROL_SETTINGS_PATH: process.env.CLAWCONTROL_SETTINGS_PATH,
  CLAWCONTROL_WORKSPACE_ROOT: process.env.CLAWCONTROL_WORKSPACE_ROOT,
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
}

let tempRoot = ''
let workspaceRoot = ''
let settingsPath = ''

function restoreEnv(key: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), `clawhub-install-${randomUUID()}-`))
  workspaceRoot = join(tempRoot, 'workspace')
  settingsPath = join(workspaceRoot, 'settings.json')

  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(workspaceRoot, 'AGENTS.md'), '# test\n', 'utf8')
  await writeFile(
    settingsPath,
    JSON.stringify({ workspacePath: workspaceRoot, updatedAt: new Date().toISOString() }),
    'utf8'
  )

  const dbPath = join(tempRoot, 'test.db')
  process.env.DATABASE_URL = `file:${dbPath}`
  process.env.CLAWCONTROL_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')
  process.env.OPENCLAW_WORKSPACE = workspaceRoot
  process.env.CLAWCONTROL_SETTINGS_PATH = settingsPath
  delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  delete process.env.WORKSPACE_ROOT

  invalidateWorkspaceRootCache()
  delete (globalThis as { prisma?: unknown }).prisma
  vi.resetModules()

  const { ensureDatabaseInitialized } = await import('@/lib/db/init')
  await ensureDatabaseInitialized()
  const { ensureReservedWorkOrders } = await import('@/lib/db')
  await ensureReservedWorkOrders()

  const zip = new JSZip()
  zip.file('SKILL.md', '# Test Skill\\n\\nHello')
  zipBytes = await zip.generateAsync({ type: 'uint8array' })
})

afterEach(async () => {
  try {
    const { prisma } = await import('@/lib/db')
    await prisma.$disconnect()
  } catch {
    // ignore
  }

  restoreEnv('DATABASE_URL', originalEnv.DATABASE_URL)
  restoreEnv('CLAWCONTROL_MIGRATIONS_DIR', originalEnv.CLAWCONTROL_MIGRATIONS_DIR)
  restoreEnv('OPENCLAW_WORKSPACE', originalEnv.OPENCLAW_WORKSPACE)
  restoreEnv('CLAWCONTROL_SETTINGS_PATH', originalEnv.CLAWCONTROL_SETTINGS_PATH)
  restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalEnv.CLAWCONTROL_WORKSPACE_ROOT)
  restoreEnv('WORKSPACE_ROOT', originalEnv.WORKSPACE_ROOT)

  invalidateWorkspaceRootCache()
  delete (globalThis as { prisma?: unknown }).prisma
  vi.resetModules()

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

describe('clawhub install creates receipt + db record', () => {
  it('installs a global skill bundle and records a receipt', async () => {
    const route = await import('@/app/api/clawhub/skills/[slug]/install/route')

    const request = new Request(`http://localhost/api/clawhub/skills/${testSlug}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: testVersion,
        scope: 'global',
        overwrite: false,
        typedConfirmText: 'CONFIRM',
      }),
    })

    const response = await route.POST(
      request as unknown as import('next/server').NextRequest,
      { params: Promise.resolve({ slug: testSlug }) }
    )

    const payload = (await response.json()) as { receiptId?: string }
    expect(response.status).toBe(200)
    expect(payload.receiptId).toBeTruthy()

    const skillMdPath = join(workspaceRoot, 'skills', testSlug, 'skill.md')
    const installedMd = await readFile(skillMdPath, 'utf8')
    expect(installedMd).toContain('# Test Skill')

    const { prisma } = await import('@/lib/db')
    const installRow = await prisma.clawHubSkillInstall.findUnique({
      where: { slug_scopeKey: { slug: testSlug, scopeKey: '__global__' } },
    })
    expect(installRow?.slug).toBe(testSlug)
    expect(installRow?.version).toBe(testVersion)
    expect(installRow?.scope).toBe('global')
    expect(installRow?.lastReceiptId).toBe(payload.receiptId)

    const receipt = await prisma.receipt.findUnique({ where: { id: payload.receiptId! } })
    expect(receipt?.exitCode).toBe(0)
    expect(receipt?.commandName).toBe('skill.install')
  })
})
