import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('cron-health', () => {
  const originalHome = process.env.OPENCLAW_HOME
  let tempHome = ''

  beforeEach(async () => {
    tempHome = join(tmpdir(), `openclaw-test-${randomUUID()}`)
    await fsp.mkdir(join(tempHome, 'cron', 'runs'), { recursive: true })
    process.env.OPENCLAW_HOME = tempHome
    vi.resetModules()
  })

  afterEach(() => {
    process.env.OPENCLAW_HOME = originalHome
  })

  it('computes per-job success/failure metrics', async () => {
    const jobId = 'job-1'
    const now = Date.now()

    await fsp.writeFile(
      join(tempHome, 'cron', 'jobs.json'),
      JSON.stringify({ jobs: [{ id: jobId, name: 'health-check', enabled: true, state: { lastStatus: 'ok' } }] }, null, 2)
    )

    const lines = [
      { runAtMs: now - 2 * 3600_000, status: 'ok' },
      { runAtMs: now - 90 * 60_000, status: 'error', error: 'timeout' },
      { runAtMs: now - 60 * 60_000, status: 'ok' },
      { runAtMs: now - 30 * 60_000, status: 'error', error: 'boom' },
    ]

    await fsp.writeFile(
      join(tempHome, 'cron', 'runs', `${jobId}.jsonl`),
      lines.map((line) => JSON.stringify(line)).join('\n')
    )

    const { getCronHealth } = await import('@/lib/openclaw/cron-health')
    const report = await getCronHealth(7)

    expect(report.jobs).toHaveLength(1)
    expect(report.jobs[0].failureCount).toBe(2)
    expect(report.jobs[0].successCount).toBe(2)
    expect(report.jobs[0].successRatePct).toBe(50)
    expect(report.jobs[0].lastFailureReason).toBe('boom')
  })
})
