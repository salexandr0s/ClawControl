import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'

interface MockRepos {
  agentTeams: {
    getById: ReturnType<typeof vi.fn>
  }
  agents: {
    getBySlug: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  receipts: {
    create: ReturnType<typeof vi.fn>
    append: ReturnType<typeof vi.fn>
    finalize: ReturnType<typeof vi.fn>
  }
}

interface RouteModule {
  POST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>
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

async function writeTemplate(input: {
  templateId: string
  name: string
  role: 'BUILD' | 'QA'
  root: string
}) {
  const dir = join(input.root, 'agent-templates', input.templateId)
  await fsp.mkdir(dir, { recursive: true })

  const templateJson = {
    id: input.templateId,
    name: input.name,
    description: 'Test template',
    version: '1.0.0',
    role: input.role,
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
  await fsp.writeFile(join(dir, 'MEMORY.md'), 'MEMORY', 'utf8')
  await fsp.writeFile(join(dir, 'overlay.md'), '# Overlay {{agentSlug}}', 'utf8')
}

async function loadRouteModule(): Promise<{ route: RouteModule; repos: MockRepos }> {
  receiptCounter += 1

  const agentStore = new Map<string, any>()

  const repos: MockRepos = {
    agentTeams: {
      getById: vi.fn(async (id: string) => ({
        id,
        slug: 'starter',
        name: 'Starter Team',
        description: null,
        source: 'imported',
        workflowIds: [],
        templateIds: ['build', 'security'],
        hierarchy: {
          version: 1,
          members: {
            build: {
              reportsTo: 'security',
              delegatesTo: [],
              receivesFrom: ['security'],
              canMessage: ['security'],
              capabilities: { canDelegate: false, canSendMessages: true },
            },
            security: {
              reportsTo: null,
              delegatesTo: ['build'],
              receivesFrom: ['build'],
              canMessage: ['build'],
              capabilities: { canDelegate: true, canSendMessages: true },
            },
          },
        },
        healthStatus: 'unknown',
        memberCount: 0,
        members: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    },
    agents: {
      getBySlug: vi.fn(async (slug: string) => agentStore.get(slug) ?? null),
      create: vi.fn(async (input: any) => {
        const agent = {
          id: `agent-${randomUUID()}`,
          name: input.name,
          displayName: input.displayName ?? input.name,
          slug: input.slug,
          runtimeAgentId: input.runtimeAgentId ?? input.slug,
          kind: 'worker',
          dispatchEligible: true,
          nameSource: 'system',
          role: input.role,
          station: input.station,
          teamId: input.teamId ?? null,
          templateId: input.templateId ?? null,
          status: 'idle',
          sessionKey: input.sessionKey,
          capabilities: input.capabilities ?? {},
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
        agentStore.set(agent.slug, agent)
        return agent
      }),
      update: vi.fn(async (id: string, patch: any) => {
        for (const agent of agentStore.values()) {
          if (agent.id !== id) continue
          Object.assign(agent, patch)
          agentStore.set(agent.slug, agent)
          return agent
        }
        return null
      }),
    },
    receipts: {
      create: vi.fn(async () => ({ id: `receipt-${receiptCounter}` })),
      append: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
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

  vi.doMock('@/lib/auth/operator-auth', () => ({
    verifyOperatorRequest: vi.fn(() => ({
      ok: true,
      principal: { actor: 'user:operator', actorType: 'user', actorId: 'operator', sessionId: 'sess' },
    })),
    asAuthErrorResponse: (auth: any) => ({ error: auth.error, code: auth.code }),
  }))

  vi.doMock('@/lib/services/openclaw-config', () => ({
    upsertAgentToOpenClaw: vi.fn(async (input: { agentId?: string }) => ({
      ok: true,
      agentId: input.agentId,
      created: true,
      updated: false,
      restartNeeded: false,
    })),
  }))

  const route = await import('@/app/api/agent-teams/[id]/instantiate/route')
  return { route, repos }
}

beforeEach(async () => {
  tempWorkspace = join(tmpdir(), `instantiate-team-test-${randomUUID()}`)
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

  await writeTemplate({ templateId: 'build', name: 'Build', role: 'BUILD', root: tempWorkspace })
  await writeTemplate({ templateId: 'security', name: 'Security', role: 'QA', root: tempWorkspace })

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

describe('POST /api/agent-teams/:id/instantiate', () => {
  it('creates missing agents, materializes files, and does not touch AGENTS.md', async () => {
    const { route } = await loadRouteModule()

    const request = new NextRequest('http://localhost/api/agent-teams/team-1/instantiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedConfirmText: 'CONFIRM' }),
    })

    const response = await route.POST(request, { params: Promise.resolve({ id: 'team-1' }) })
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.data.createdAgents).toHaveLength(2)

    for (const slug of ['build', 'security']) {
      await expect(fsp.readFile(join(tempWorkspace, 'agents', slug, 'SOUL.md'), 'utf8')).resolves.toContain('SOUL')
      await expect(fsp.readFile(join(tempWorkspace, 'agents', slug, 'HEARTBEAT.md'), 'utf8')).resolves.toContain('HEARTBEAT_OK')
      await expect(fsp.readFile(join(tempWorkspace, 'agents', slug, 'MEMORY.md'), 'utf8')).resolves.toContain('MEMORY')
      await expect(fsp.readFile(join(tempWorkspace, 'agents', `${slug}.md`), 'utf8')).resolves.toContain(slug)
    }

    const agentsMd = await fsp.readFile(join(tempWorkspace, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toBe('UNCHANGED\n')
  })
})
