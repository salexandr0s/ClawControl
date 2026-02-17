import { beforeEach, describe, expect, it, vi } from 'vitest'

type ExecResult = {
  stdout: string
  stderr: string
}

type ExecCallback = (error: Error | null, result: ExecResult) => void

const mocks = vi.hoisted(() => {
  const execFile = vi.fn()
  const upsert = vi.fn()
  const upsertAgentToOpenClaw = vi.fn()
  const getOpenClawBin = vi.fn(() => 'openclaw')
  const parseJsonFromCommandOutput = vi.fn((stdout: string) => {
    try {
      return JSON.parse(stdout)
    } catch {
      return null
    }
  })
  const runCommandJson = vi.fn()
  const chatSend = vi.fn()

  return {
    execFile,
    upsert,
    getOpenClawBin,
    parseJsonFromCommandOutput,
    runCommandJson,
    chatSend,
    upsertAgentToOpenClaw,
    reset() {
      execFile.mockReset()
      upsert.mockReset()
      upsertAgentToOpenClaw.mockReset()
      getOpenClawBin.mockReset()
      parseJsonFromCommandOutput.mockReset()
      runCommandJson.mockReset()
      chatSend.mockReset()

      getOpenClawBin.mockReturnValue('openclaw')
      parseJsonFromCommandOutput.mockImplementation((stdout: string) => {
        try {
          return JSON.parse(stdout)
        } catch {
          return null
        }
      })
      upsertAgentToOpenClaw.mockResolvedValue({
        ok: true,
        created: false,
        updated: true,
        restartNeeded: true,
      })
    },
  }
})

vi.mock('child_process', () => ({
  execFile: mocks.execFile,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    agentSession: {
      upsert: mocks.upsert,
    },
  },
}))

vi.mock('@/lib/openclaw/console-client', () => ({
  getWsConsoleClient: () => ({
    chatSend: mocks.chatSend,
  }),
}))

vi.mock('@/lib/services/openclaw-config', () => ({
  upsertAgentToOpenClaw: mocks.upsertAgentToOpenClaw,
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: mocks.runCommandJson,
  getOpenClawBin: mocks.getOpenClawBin,
  parseJsonFromCommandOutput: mocks.parseJsonFromCommandOutput,
}))

function queueExecSuccess(stdout: string, stderr = '') {
  mocks.execFile.mockImplementationOnce((_bin: string, _args: string[], _options: unknown, cb: ExecCallback) => {
    cb(null, { stdout, stderr })
    return {} as never
  })
}

function queueExecError(message: string, stderr = '', stdout = '') {
  const error = Object.assign(new Error(message), { stderr, stdout })
  mocks.execFile.mockImplementationOnce((_bin: string, _args: string[], _options: unknown, cb: ExecCallback) => {
    cb(error, { stdout, stderr })
    return {} as never
  })
}

function readSessionIdArg(args: string[]): string {
  const idx = args.indexOf('--session-id')
  expect(idx).toBeGreaterThanOrEqual(0)
  return args[idx + 1] ?? ''
}

async function loadModule() {
  return import('@/lib/openclaw/sessions')
}

beforeEach(() => {
  vi.resetModules()
  mocks.reset()
  delete process.env.CLAWCONTROL_OPENCLAW_DISPATCH_MODE
})

describe('spawnAgentSession dispatch modes', () => {
  it('uses openclaw run in run mode', async () => {
    process.env.CLAWCONTROL_OPENCLAW_DISPATCH_MODE = 'run'
    queueExecSuccess('{"sessionId":"sess_run_1"}')

    const sessions = await loadModule()
    const result = await sessions.spawnAgentSession({
      agentId: 'wf-build',
      label: 'agent:wf-build:wo:wo_1:op:op_1',
      task: 'implement feature',
      context: { lane: 'build' },
      timeoutSeconds: 33,
    })

    expect(result.sessionId).toBe('sess_run_1')
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    const args = mocks.execFile.mock.calls[0]?.[1] as string[]
    expect(args[0]).toBe('run')
    expect(args[1]).toBe('wf-build')
    expect(args).toContain('--label')
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
  })

  it('auto mode falls back to agent_local when run is unavailable and caches it', async () => {
    queueExecError(
      'Command failed',
      "error: unknown command 'run'\n(Did you mean cron?)"
    )
    queueExecSuccess('{"meta":{"agentMeta":{"sessionId":"sess_agent_1"}}}')
    queueExecSuccess('{"meta":{"agentMeta":{"sessionId":"sess_agent_2"}}}')

    const sessions = await loadModule()
    const first = await sessions.spawnAgentSession({
      agentId: 'wf-plan',
      label: 'agent:wf-plan:wo:wo_2:op:op_2',
      task: 'draft plan',
      context: { stage: 'plan' },
      timeoutSeconds: 20,
    })
    const second = await sessions.spawnAgentSession({
      agentId: 'wf-plan',
      label: 'agent:wf-plan:wo:wo_2:op:op_2',
      task: 'refine plan',
      context: { stage: 'plan' },
      timeoutSeconds: 20,
    })

    expect(first.sessionId).toBe('sess_agent_1')
    expect(second.sessionId).toBe('sess_agent_2')
    expect(mocks.execFile).toHaveBeenCalledTimes(3)

    const firstArgs = mocks.execFile.mock.calls[0]?.[1] as string[]
    const secondArgs = mocks.execFile.mock.calls[1]?.[1] as string[]
    const thirdArgs = mocks.execFile.mock.calls[2]?.[1] as string[]

    expect(firstArgs[0]).toBe('run')
    expect(secondArgs[0]).toBe('agent')
    expect(thirdArgs[0]).toBe('agent')

    const firstSessionId = readSessionIdArg(secondArgs)
    const secondSessionId = readSessionIdArg(thirdArgs)
    expect(firstSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(secondSessionId).toBe(firstSessionId)
  })

  it('syncs model before agent_local fallback when model is provided', async () => {
    queueExecError(
      'Command failed',
      "error: unknown command 'run'\n(Did you mean cron?)"
    )
    queueExecSuccess('{"meta":{"agentMeta":{"sessionId":"sess_agent_model_synced"}}}')

    const sessions = await loadModule()
    const result = await sessions.spawnAgentSession({
      agentId: 'wf-plan',
      label: 'agent:wf-plan:wo:wo_6:op:op_6',
      task: 'plan task',
      model: 'openai-codex/gpt-5.3-codex',
      timeoutSeconds: 25,
    })

    expect(result.sessionId).toBe('sess_agent_model_synced')
    expect(mocks.upsertAgentToOpenClaw).toHaveBeenCalledWith({
      agentId: 'wf-plan',
      runtimeAgentId: 'wf-plan',
      model: 'openai-codex/gpt-5.3-codex',
    })
  })

  it('proceeds with agent_local fallback when model sync fails', async () => {
    mocks.upsertAgentToOpenClaw.mockResolvedValueOnce({
      ok: false,
      error: 'Cannot write OpenClaw config',
    })
    queueExecError(
      'Command failed',
      "error: unknown command 'run'\n(Did you mean cron?)"
    )
    queueExecSuccess('{"meta":{"agentMeta":{"sessionId":"sess_agent_after_sync_warning"}}}')

    const sessions = await loadModule()
    const result = await sessions.spawnAgentSession({
      agentId: 'wf-security',
      label: 'agent:wf-security:wo:wo_7:op:op_7',
      task: 'security task',
      model: 'openai-codex/gpt-5.3-codex',
      timeoutSeconds: 25,
    })

    expect(result.sessionId).toBe('sess_agent_after_sync_warning')
    expect(mocks.upsertAgentToOpenClaw).toHaveBeenCalledTimes(1)
  })

  it('keeps fallback errors actionable when model sync fails', async () => {
    mocks.upsertAgentToOpenClaw.mockResolvedValueOnce({
      ok: false,
      error: 'Cannot write OpenClaw config',
    })
    queueExecError(
      'Command failed',
      "error: unknown command 'run'\n(Did you mean cron?)"
    )
    queueExecError(
      'Command failed',
      'FailoverError: No API key found for provider "openai".'
    )

    const sessions = await loadModule()

    let thrownMessage = ''
    try {
      await sessions.spawnAgentSession({
        agentId: 'wf-research',
        label: 'agent:wf-research:wo:wo_8:op:op_8',
        task: 'research task',
        model: 'openai-codex/gpt-5.3-codex',
        timeoutSeconds: 15,
      })
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }

    expect(thrownMessage).toContain('openclaw run unavailable; fallback agent_local failed')
    expect(thrownMessage).toContain('model_sync_warning=')
  })

  it('uses agent_local mode and accepts nested sessionId locations', async () => {
    process.env.CLAWCONTROL_OPENCLAW_DISPATCH_MODE = 'agent_local'
    queueExecSuccess('{"meta":{"systemPromptReport":{"sessionId":"sess_agent_local"}}}')

    const sessions = await loadModule()
    const result = await sessions.spawnAgentSession({
      agentId: 'wf-research',
      label: 'agent:wf-research:wo:wo_3:op:op_3',
      task: 'research task',
      context: { stage: 'research' },
      timeoutSeconds: 25,
    })

    expect(result.sessionId).toBe('sess_agent_local')
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    const args = mocks.execFile.mock.calls[0]?.[1] as string[]
    expect(args[0]).toBe('agent')
    expect(args).toContain('--local')
    expect(args).toContain('--session-id')
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
  })

  it('fails in agent_local mode when no sessionId is returned', async () => {
    process.env.CLAWCONTROL_OPENCLAW_DISPATCH_MODE = 'agent_local'
    queueExecSuccess('{"meta":{"agentMeta":{"provider":"openai-codex"}}}')

    const sessions = await loadModule()
    await expect(
      sessions.spawnAgentSession({
        agentId: 'wf-security',
        label: 'agent:wf-security:wo:wo_4:op:op_4',
        task: 'security review',
        context: { stage: 'security' },
        timeoutSeconds: 15,
      })
    ).rejects.toThrow('did not return a sessionId')

    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('respects forced run mode and does not fallback', async () => {
    process.env.CLAWCONTROL_OPENCLAW_DISPATCH_MODE = 'run'
    queueExecError('Command failed', "error: unknown command 'run'")

    const sessions = await loadModule()
    await expect(
      sessions.spawnAgentSession({
        agentId: 'wf-ui',
        label: 'agent:wf-ui:wo:wo_5:op:op_5',
        task: 'ui change',
        context: { stage: 'ui' },
        timeoutSeconds: 40,
      })
    ).rejects.toThrow('openclaw run failed')

    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    const args = mocks.execFile.mock.calls[0]?.[1] as string[]
    expect(args[0]).toBe('run')
  })
})
