import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'

interface MockRepos {
  agents: {
    list: ReturnType<typeof vi.fn>
    getByName: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  receipts: {
    create: ReturnType<typeof vi.fn>
    append: ReturnType<typeof vi.fn>
    finalize: ReturnType<typeof vi.fn>
  }
  activities: {
    create: ReturnType<typeof vi.fn>
  }
}

interface RouteModule {
  POST: (request: NextRequest) => Promise<Response>
}

const originalOpenClawWorkspace = process.env.OPENCLAW_WORKSPACE
const originalSettingsPath = process.env.CLAWCONTROL_SETTINGS_PATH
const originalClawcontrolWorkspaceRoot = process.env.CLAWCONTROL_WORKSPACE_ROOT
const originalWorkspaceRoot = process.env.WORKSPACE_ROOT

let tempWorkspace = ''
let receiptCounter = 0

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

async function writeTemplate(templateId: string, root: string) {
  const dir = join(root, 'agent-templates', templateId)
  await fsp.mkdir(dir, { recursive: true })

  const templateJson = {
    id: templateId,
    name: 'Build',
    description: 'Test template',
    version: '1.0.0',
    role: 'BUILD',
    render: {
      engine: 'mustache',
      targets: [
        { source: 'SOUL.md', destination: 'workspace/agents/{{agentSlug}}/SOUL.md' },
        { source: 'HEARTBEAT.md', destination: 'workspace/agents/{{agentSlug}}/HEARTBEAT.md' },
        { source: 'MEMORY.md', destination: 'workspace/agents/{{agentSlug}}/MEMORY.md' },
        { source: 'overlay.md', destination: 'workspace/agents/{{agentSlug}}.md' },
      ],
    },
    provisioning: { enabled: true, steps: ['create_files', 'register_agent'] },
    author: 'test',
    tags: ['test'],
  }

  await fsp.writeFile(join(dir, 'template.json'), `${JSON.stringify(templateJson, null, 2)}\n`, 'utf8')
  await fsp.writeFile(join(dir, 'SOUL.md'), '# SOUL {{agentDisplayName}}', 'utf8')
  await fsp.writeFile(join(dir, 'HEARTBEAT.md'), 'HEARTBEAT_OK', 'utf8')
  await fsp.writeFile(join(dir, 'MEMORY.md'), 'Remember: do not overwrite files.', 'utf8')
  await fsp.writeFile(join(dir, 'overlay.md'), '# Overlay {{agentSlug}}', 'utf8')
}

async function loadRouteModule(): Promise<{ route: RouteModule; repos: MockRepos }> {
  receiptCounter += 1

  const repos: MockRepos = {
    agents: {
      list: vi.fn(async () => []),
      getByName: vi.fn(async () => null),
      create: vi.fn(async (input: { name: string; displayName: string; slug: string; runtimeAgentId: string; role: string; station: string; sessionKey: string; capabilities: Record<string, unknown> }) => {
        return {
          id: `agent-${randomUUID()}`,
          name: input.name,
          displayName: input.displayName,
          slug: input.slug,
          runtimeAgentId: input.runtimeAgentId,
          kind: 'worker',
          dispatchEligible: true,
          nameSource: 'system',
          role: input.role,
          station: input.station,
          teamId: null,
          status: 'idle',
          sessionKey: input.sessionKey,
          capabilities: input.capabilities,
          wipLimit: 2,
          avatarPath: null,
          model: null,
          fallbacks: [],
          isStale: false,
          staleAt: null,
          lastSeenAt: null,
          lastHeartbeatAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      }),
    },
    receipts: {
      create: vi.fn(async () => ({ id: `receipt-${receiptCounter}` })),
      append: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
    },
    activities: {
      create: vi.fn(async () => undefined),
    },
  }

  vi.doMock('@/lib/repo', () => ({
    getRepos: () => repos,
  }))

  vi.doMock('@/lib/with-governor', () => ({
    enforceActionPolicy: vi.fn(async ({ typedConfirmText }: { typedConfirmText?: string }) => {
      if (typedConfirmText === 'CONFIRM') return { allowed: true, policy: {} }
      return { allowed: false, errorType: 'TYPED_CONFIRM_REQUIRED', policy: {} }
    }),
  }))

  vi.doMock('@/lib/services/openclaw-config', () => ({
    upsertAgentToOpenClaw: vi.fn(async (input: { agentId?: string }) => ({
      ok: true,
      agentId: input.agentId,
      created: true,
      updated: false,
      restartNeeded: false,
    })),
    removeAgentFromOpenClaw: vi.fn(async () => ({ ok: true, removed: true })),
  }))

  const route = await import('@/app/api/agents/create-from-template/route')
  return { route, repos }
}

beforeEach(async () => {
  tempWorkspace = join(tmpdir(), `create-from-template-test-${randomUUID()}`)
  await fsp.mkdir(tempWorkspace, { recursive: true })

  process.env.OPENCLAW_WORKSPACE = tempWorkspace
  process.env.CLAWCONTROL_SETTINGS_PATH = join(tempWorkspace, 'settings.json')
  delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  delete process.env.WORKSPACE_ROOT

  await fsp.writeFile(
    process.env.CLAWCONTROL_SETTINGS_PATH,
    JSON.stringify({ workspacePath: tempWorkspace, updatedAt: new Date().toISOString() })
  )

  await fsp.writeFile(join(tempWorkspace, 'AGENTS.md'), 'UNCHANGED\n', 'utf8')

  await writeTemplate('build', tempWorkspace)

  vi.resetModules()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()

  restoreEnv('OPENCLAW_WORKSPACE', originalOpenClawWorkspace)
  restoreEnv('CLAWCONTROL_SETTINGS_PATH', originalSettingsPath)
  restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
  restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)

  if (tempWorkspace) {
    await fsp.rm(tempWorkspace, { recursive: true, force: true })
  }
})

describe('POST /api/agents/create-from-template', () => {
  it('materializes SOUL/HEARTBEAT/MEMORY (+ overlay) and does not touch AGENTS.md', async () => {
    const { route } = await loadRouteModule()

    const request = new NextRequest('http://localhost/api/agents/create-from-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: 'build',
        params: {},
        typedConfirmText: 'CONFIRM',
      }),
    })

    const response = await route.POST(request)
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect((body.materialized as { written: string[] }).written.length).toBeGreaterThan(0)

    const soul = await fsp.readFile(join(tempWorkspace, 'agents', 'build', 'SOUL.md'), 'utf8')
    const heartbeat = await fsp.readFile(join(tempWorkspace, 'agents', 'build', 'HEARTBEAT.md'), 'utf8')
    const memory = await fsp.readFile(join(tempWorkspace, 'agents', 'build', 'MEMORY.md'), 'utf8')
    const overlay = await fsp.readFile(join(tempWorkspace, 'agents', 'build.md'), 'utf8')

    expect(soul).toContain('SOUL')
    expect(heartbeat).toContain('HEARTBEAT_OK')
    expect(memory).toContain('Remember:')
    expect(overlay).toContain('build')

    const agentsMd = await fsp.readFile(join(tempWorkspace, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toBe('UNCHANGED\n')
  })
})

