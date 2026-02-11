import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommandJson: vi.fn(),
  getRepos: vi.fn(),
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: mocks.runCommandJson,
}))

vi.mock('@/lib/repo', () => ({
  getRepos: mocks.getRepos,
}))

const originalOpenClawWorkspace = process.env.OPENCLAW_WORKSPACE
const originalClawcontrolWorkspaceRoot = process.env.CLAWCONTROL_WORKSPACE_ROOT
const originalWorkspaceRoot = process.env.WORKSPACE_ROOT

function restoreEnv(key: 'OPENCLAW_WORKSPACE' | 'CLAWCONTROL_WORKSPACE_ROOT' | 'WORKSPACE_ROOT', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(() => {
  vi.resetModules()
  mocks.runCommandJson.mockReset()
  mocks.getRepos.mockReset()
  restoreEnv('OPENCLAW_WORKSPACE', originalOpenClawWorkspace)
  restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
  restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)
})

describe('agent hierarchy source warnings', () => {
  it('does not emit source_unavailable warnings for optional runtime and fallback when CLI is missing', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'hierarchy-source-warnings-'))

    try {
      const workspaceRoot = join(tempRoot, 'OpenClaw')
      const clawcontrolRoot = join(workspaceRoot, 'projects', 'ClawControl')
      const fallbackDir = join(clawcontrolRoot, 'openclaw')

      await mkdir(fallbackDir, { recursive: true })
      await writeFile(join(clawcontrolRoot, 'clawcontrol.config.yaml'), 'agents: {}\n', 'utf-8')
      await writeFile(
        join(fallbackDir, 'openclaw.json5'),
        '{ tools: { agentToAgent: { enabled: false } }, agents: { list: [] } }',
        'utf-8'
      )

      process.env.OPENCLAW_WORKSPACE = workspaceRoot
      delete process.env.CLAWCONTROL_WORKSPACE_ROOT
      delete process.env.WORKSPACE_ROOT

      mocks.getRepos.mockReturnValue({
        agents: {
          list: vi.fn().mockResolvedValue([]),
        },
      })
      mocks.runCommandJson.mockResolvedValue({
        error: 'OpenClaw CLI not available: OpenClaw CLI not found',
        exitCode: 127,
      })

      const { getAgentHierarchyData } = await import('@/lib/services/agent-hierarchy')
      const data = await getAgentHierarchyData()

      expect(data.meta.sources.yaml.available).toBe(true)
      expect(data.meta.sources.fallback.available).toBe(true)
      expect(data.meta.sources.fallback.used).toBe(true)
      expect(data.meta.sources.runtime.available).toBe(false)
      expect(data.meta.warnings.some((warning) => warning.code === 'source_unavailable')).toBe(false)
      expect(data.meta.warnings.some((warning) => warning.code === 'runtime_unavailable_fallback_used')).toBe(false)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('does not emit source_unavailable warnings for missing optional YAML/fallback files on fresh installs', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'hierarchy-source-missing-'))

    try {
      const workspaceRoot = join(tempRoot, 'OpenClaw')
      await mkdir(workspaceRoot, { recursive: true })

      process.env.OPENCLAW_WORKSPACE = workspaceRoot
      delete process.env.CLAWCONTROL_WORKSPACE_ROOT
      delete process.env.WORKSPACE_ROOT

      mocks.getRepos.mockReturnValue({
        agents: {
          list: vi.fn().mockResolvedValue([]),
        },
      })
      mocks.runCommandJson.mockResolvedValue({
        error: 'OpenClaw CLI not available: OpenClaw CLI not found',
        exitCode: 127,
      })

      const { getAgentHierarchyData } = await import('@/lib/services/agent-hierarchy')
      const data = await getAgentHierarchyData()

      expect(data.meta.sources.runtime.available).toBe(false)
      expect(data.meta.sources.db.available).toBe(true)
      expect(data.meta.warnings.some((warning) => warning.code === 'source_unavailable')).toBe(false)
      expect(data.meta.warnings.some((warning) => warning.code === 'runtime_unavailable_fallback_used')).toBe(false)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
