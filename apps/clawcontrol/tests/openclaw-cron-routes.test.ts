import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runCommandJson: vi.fn(),
  runDynamicCommandJson: vi.fn(),
  runDynamicCommand: vi.fn(),
  parseJsonFromCommandOutput: vi.fn(),
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: mocks.runCommandJson,
  runDynamicCommandJson: mocks.runDynamicCommandJson,
  runDynamicCommand: mocks.runDynamicCommand,
  parseJsonFromCommandOutput: mocks.parseJsonFromCommandOutput,
}))

beforeEach(async () => {
  vi.resetModules()
  mocks.runCommandJson.mockReset()
  mocks.runDynamicCommandJson.mockReset()
  mocks.runDynamicCommand.mockReset()
  mocks.parseJsonFromCommandOutput.mockReset()
  mocks.parseJsonFromCommandOutput.mockImplementation((text: string) => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })
  const availability = await import('@/lib/openclaw/availability')
  availability.clearCache()
})

describe('openclaw cron create route', () => {
  it('accepts the new 2.17 body shape and builds cron.create params', async () => {
    mocks.runDynamicCommandJson.mockResolvedValue({
      exitCode: 0,
      data: { jobId: 'job_new_1' },
    })

    const route = await import('@/app/api/openclaw/cron/route')
    const request = new NextRequest('http://localhost/api/openclaw/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'nightly-summary',
        enabled: true,
        schedule: {
          kind: 'cron',
          expr: '0 * * * *',
          tz: 'UTC',
          stagger: '20s',
          exact: true,
        },
        payload: { kind: 'agentTurn', text: 'Summarize overnight changes' },
        sessionTarget: 'isolated',
        wakeMode: 'now',
        delivery: { mode: 'none' },
      }),
    })

    const response = await route.POST(request)
    const payload = await response.json() as { data: { jobId: string } }

    expect(response.status).toBe(200)
    expect(payload.data.jobId).toBe('job_new_1')
    expect(mocks.runDynamicCommandJson).toHaveBeenCalledWith(
      'cron.create',
      expect.objectContaining({
        name: 'nightly-summary',
        session: 'isolated',
        wake: 'now',
        cron: '0 * * * *',
        tz: 'UTC',
        stagger: '20s',
        exact: 'true',
        message: 'Summarize overnight changes',
        'no-deliver': 'true',
      }),
      expect.objectContaining({ timeout: expect.any(Number) })
    )
  })

  it('maps legacy create body for one-release compatibility', async () => {
    mocks.runDynamicCommandJson.mockResolvedValue({
      exitCode: 0,
      data: { jobId: 'legacy_1' },
    })

    const route = await import('@/app/api/openclaw/cron/route')
    const request = new NextRequest('http://localhost/api/openclaw/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'legacy-job',
        schedule: '*/15 * * * *',
        command: 'Do work',
        enabled: false,
      }),
    })

    const response = await route.POST(request)
    const payload = await response.json() as { data: { jobId: string } }

    expect(response.status).toBe(200)
    expect(payload.data.jobId).toBe('legacy_1')
    expect(mocks.runDynamicCommandJson).toHaveBeenCalledWith(
      'cron.create',
      expect.objectContaining({
        name: 'legacy-job',
        session: 'isolated',
        wake: 'now',
        cron: '*/15 * * * *',
        message: 'Do work',
        disabled: 'true',
        'no-deliver': 'true',
      }),
      expect.any(Object)
    )
  })

  it('rejects invalid new body payload', async () => {
    const route = await import('@/app/api/openclaw/cron/route')
    const request = new NextRequest('http://localhost/api/openclaw/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'bad',
        schedule: { kind: 'cron', expr: '0 * * * *' },
        payload: { kind: 'agentTurn', text: '' },
        sessionTarget: 'isolated',
      }),
    })

    const response = await route.POST(request)
    const payload = await response.json() as { status: string; error: string }

    expect(response.status).toBe(200)
    expect(payload.status).toBe('unavailable')
    expect(payload.error).toContain('payload.text')
    expect(mocks.runDynamicCommandJson).not.toHaveBeenCalled()
  })
})

describe('openclaw cron mutation routes (non-JSON CLI output)', () => {
  it('uses fallback success shape for run when CLI output is plain text', async () => {
    mocks.runDynamicCommand.mockResolvedValue({
      exitCode: 0,
      durationMs: 12,
      stdout: 'Triggered\n',
      stderr: '',
      timedOut: false,
    })
    mocks.parseJsonFromCommandOutput.mockReturnValue(null)

    const route = await import('@/app/api/openclaw/cron/[id]/run/route')
    const response = await route.POST(
      new NextRequest('http://localhost/api/openclaw/cron/job_1/run', { method: 'POST' }),
      { params: Promise.resolve({ id: 'job_1' }) }
    )
    const payload = await response.json() as { data: { jobId: string; status: string } }

    expect(response.status).toBe(200)
    expect(payload.data.jobId).toBe('job_1')
    expect(payload.data.status).toBe('triggered')
  })

  it('returns unavailable for enable when CLI exits non-zero', async () => {
    mocks.runDynamicCommand.mockResolvedValue({
      exitCode: 1,
      durationMs: 8,
      stdout: '',
      stderr: 'enable failed',
      timedOut: false,
      error: 'enable failed',
    })

    const route = await import('@/app/api/openclaw/cron/[id]/enable/route')
    const response = await route.POST(
      new NextRequest('http://localhost/api/openclaw/cron/job_1/enable', { method: 'POST' }),
      { params: Promise.resolve({ id: 'job_1' }) }
    )
    const payload = await response.json() as { status: string; error: string }

    expect(response.status).toBe(200)
    expect(payload.status).toBe('unavailable')
    expect(payload.error).toContain('enable failed')
  })

  it('edits cron schedule with plain-text success output', async () => {
    mocks.runDynamicCommand.mockResolvedValue({
      exitCode: 0,
      durationMs: 10,
      stdout: 'Updated\n',
      stderr: '',
      timedOut: false,
    })
    mocks.parseJsonFromCommandOutput.mockReturnValue(null)

    const route = await import('@/app/api/openclaw/cron/[id]/edit/route')
    const response = await route.POST(
      new NextRequest('http://localhost/api/openclaw/cron/job_1/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'cron', cron: '0 * * * *' }),
      }),
      { params: Promise.resolve({ id: 'job_1' }) }
    )
    const payload = await response.json() as { status: string; data: { updated: boolean } }

    expect(response.status).toBe(200)
    expect(payload.status).toBe('ok')
    expect(payload.data.updated).toBe(true)
  })
})

describe('openclaw cron list/status/runs normalization routes', () => {
  it('normalizes jobs route from wrapped { jobs: [] } shape', async () => {
    mocks.runCommandJson.mockResolvedValue({
      exitCode: 0,
      data: {
        jobs: [
          {
            id: 'job_1',
            name: 'Job One',
            enabled: true,
            schedule: { kind: 'at', at: '2026-02-18T12:00:00.000Z' },
            sessionTarget: 'main',
            wakeMode: 'now',
            payload: { kind: 'systemEvent', text: 'Ping' },
            state: { lastStatus: 'ok', runCount: 3 },
          },
        ],
      },
    })

    const route = await import('@/app/api/openclaw/cron/jobs/route')
    const response = await route.GET()
    const payload = await response.json() as {
      data: Array<{ id: string; schedule: { atMs?: number }; lastStatus?: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0].id).toBe('job_1')
    expect(typeof payload.data[0].schedule.atMs).toBe('number')
    expect(payload.data[0].lastStatus).toBe('success')
  })

  it('normalizes runs route from wrapped { entries: [] } shape', async () => {
    mocks.runDynamicCommandJson.mockResolvedValue({
      exitCode: 0,
      data: {
        entries: [
          { jobId: 'job_1', ts: 1700000000000, status: 'ok', durationMs: 10 },
          { jobId: 'job_1', ts: 1700000005000, status: 'error', error: 'boom' },
        ],
      },
    })

    const route = await import('@/app/api/openclaw/cron/runs/route')
    const response = await route.GET(
      new NextRequest('http://localhost/api/openclaw/cron/runs?id=job_1')
    )
    const payload = await response.json() as {
      data: Array<{ status: string; error?: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.data).toHaveLength(2)
    expect(payload.data[0].status).toBe('success')
    expect(payload.data[1].status).toBe('failed')
    expect(payload.data[1].error).toBe('boom')
  })

  it('normalizes status route to 2.17 fields', async () => {
    mocks.runCommandJson.mockResolvedValue({
      exitCode: 0,
      data: {
        enabled: true,
        jobs: 9,
        nextWakeAtMs: 1700000010000,
        storePath: '/tmp/cron/jobs.json',
      },
    })

    const route = await import('@/app/api/openclaw/cron/status/route')
    const response = await route.GET()
    const payload = await response.json() as {
      data: {
        enabled: boolean
        jobs: number
        nextWakeAtMs?: number
        storePath?: string
        running?: boolean
        jobCount?: number
      }
    }

    expect(response.status).toBe(200)
    expect(payload.data.enabled).toBe(true)
    expect(payload.data.jobs).toBe(9)
    expect(payload.data.nextWakeAtMs).toBe(1700000010000)
    expect(payload.data.storePath).toBe('/tmp/cron/jobs.json')
    expect(payload.data.running).toBe(true)
    expect(payload.data.jobCount).toBe(9)
  })
})
