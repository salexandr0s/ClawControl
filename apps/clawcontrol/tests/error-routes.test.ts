import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  withIngestionLease: vi.fn(),
  syncErrorLog: vi.fn(),
  getErrorSummary: vi.fn(),
  listErrorSignatures: vi.fn(),
  autoGenerateErrorInsights: vi.fn(),
  verifyOperatorRequest: vi.fn(),
  createErrorRemediationWorkOrder: vi.fn(),
}))

vi.mock('@/lib/openclaw/ingestion-lease', () => ({
  withIngestionLease: mocks.withIngestionLease,
}))

vi.mock('@/lib/openclaw/error-sync', () => ({
  syncErrorLog: mocks.syncErrorLog,
  getErrorSummary: mocks.getErrorSummary,
  listErrorSignatures: mocks.listErrorSignatures,
}))

vi.mock('@/lib/openclaw/error-insights', () => ({
  autoGenerateErrorInsights: mocks.autoGenerateErrorInsights,
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: (result: { error: string; code: string }) => ({
    error: result.error,
    code: result.code,
  }),
}))

vi.mock('@/lib/openclaw/error-remediation', () => ({
  createErrorRemediationWorkOrder: mocks.createErrorRemediationWorkOrder,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.withIngestionLease.mockReset()
  mocks.syncErrorLog.mockReset()
  mocks.getErrorSummary.mockReset()
  mocks.listErrorSignatures.mockReset()
  mocks.autoGenerateErrorInsights.mockReset()
  mocks.verifyOperatorRequest.mockReset()
  mocks.createErrorRemediationWorkOrder.mockReset()

  mocks.withIngestionLease.mockResolvedValue({
    lockAcquired: true,
    value: {
      processedEvents: 3,
      signaturesUpdated: 2,
      daysUpdated: 2,
      cursorReset: false,
      durationMs: 4,
    },
  })

  mocks.syncErrorLog.mockResolvedValue({
    processedEvents: 3,
    signaturesUpdated: 2,
    daysUpdated: 2,
    cursorReset: false,
    durationMs: 4,
  })

  mocks.getErrorSummary.mockResolvedValue({
    generatedAt: '2026-02-12T00:00:00.000Z',
    from: '2026-01-30T00:00:00.000Z',
    to: '2026-02-12T23:59:59.999Z',
    trend: [{ day: '2026-02-11T00:00:00.000Z', count: '8' }],
    totals: {
      totalErrors: '8',
      uniqueSignatures: 2,
      windowUniqueSignatures: 1,
    },
    topSignatures: [
      {
        signatureHash: 'a'.repeat(40),
        signatureText: 'Config warning signature',
        count: '8',
        windowCount: '8',
        allTimeCount: '20',
        firstSeen: '2026-02-10T00:00:00.000Z',
        lastSeen: '2026-02-11T00:00:00.000Z',
        sample: 'Run: openclaw doctor --fix',
        classification: {
          title: 'Configuration Drift or Plugin Misconfiguration',
          category: 'configuration',
          severity: 'medium',
          detectability: 'deterministic',
          confidence: 0.9,
          actionable: true,
          explanation: 'Known signature pattern.',
          extractedCliCommand: 'openclaw doctor --fix',
          suggestedActions: [],
        },
        insight: null,
      },
    ],
    spike: {
      detected: true,
      yesterdayCount: 8,
      baseline: 3.2,
    },
  })

  mocks.listErrorSignatures.mockResolvedValue({
    generatedAt: '2026-02-12T00:00:00.000Z',
    from: '2026-01-30T00:00:00.000Z',
    to: '2026-02-12T23:59:59.999Z',
    days: 14,
    signatures: [
      {
        signatureHash: 'a'.repeat(40),
        signatureText: 'Config warning signature',
        count: '8',
        windowCount: '8',
        allTimeCount: '20',
        firstSeen: '2026-02-10T00:00:00.000Z',
        lastSeen: '2026-02-11T00:00:00.000Z',
        sample: 'Run: openclaw doctor --fix',
        rawRedactedSample: 'Run: openclaw doctor --fix\nAuthorization: Bearer [REDACTED_TOKEN]',
        classification: {
          title: 'Configuration Drift or Plugin Misconfiguration',
          category: 'configuration',
          severity: 'medium',
          detectability: 'deterministic',
          confidence: 0.9,
          actionable: true,
          explanation: 'Known signature pattern.',
          extractedCliCommand: 'openclaw doctor --fix',
          suggestedActions: [],
        },
        insight: null,
      },
    ],
    meta: {
      limit: 20,
      includeRaw: false,
      windowUniqueSignatures: 1,
    },
  })

  mocks.autoGenerateErrorInsights.mockResolvedValue(new Map())

  mocks.verifyOperatorRequest.mockReturnValue({
    ok: true,
    principal: {
      actor: 'user:operator',
      actorType: 'user',
      actorId: 'operator',
      sessionId: 'sess_1',
    },
  })
})

describe('error routes', () => {
  it('returns summary payload with actionable metadata', async () => {
    const route = await import('@/app/api/openclaw/errors/summary/route')
    const response = await route.GET(
      new Request('http://localhost/api/openclaw/errors/summary?days=14') as unknown as import('next/server').NextRequest
    )
    const payload = (await response.json()) as {
      data: {
        topSignatures: Array<{ classification: { actionable: boolean } }>
        totals: { windowUniqueSignatures: number }
      }
    }

    expect(response.status).toBe(200)
    expect(payload.data.topSignatures[0]?.classification.actionable).toBe(true)
    expect(payload.data.totals.windowUniqueSignatures).toBe(1)
  })

  it('returns safe summary payload when analytics schema is outdated', async () => {
    mocks.withIngestionLease.mockRejectedValueOnce(
      new Error('SQLITE_ERROR: no such table: error_signature_daily_aggregates')
    )

    const route = await import('@/app/api/openclaw/errors/summary/route')
    const response = await route.GET(
      new Request('http://localhost/api/openclaw/errors/summary?days=14') as unknown as import('next/server').NextRequest
    )
    const payload = (await response.json()) as {
      warning?: string
      code?: string
      data: { topSignatures: unknown[]; trend: unknown[] }
    }

    expect(response.status).toBe(200)
    expect(payload.code).toBe('ERROR_ANALYTICS_SCHEMA_OUTDATED')
    expect(payload.warning).toContain('db:migrate')
    expect(payload.data.topSignatures).toEqual([])
    expect(payload.data.trend).toHaveLength(14)
    expect(mocks.getErrorSummary).not.toHaveBeenCalled()
  })

  it('enforces auth for raw toggle on signatures route while allowing sanitized default', async () => {
    const route = await import('@/app/api/openclaw/errors/signatures/route')

    mocks.verifyOperatorRequest.mockReturnValue({
      ok: false,
      status: 401,
      code: 'AUTH_REQUIRED',
      error: 'Operator session is required',
    })

    const rawResponse = await route.GET(
      new Request('http://localhost/api/openclaw/errors/signatures?includeRaw=true') as unknown as import('next/server').NextRequest
    )
    const rawPayload = (await rawResponse.json()) as { code?: string }

    expect(rawResponse.status).toBe(401)
    expect(rawPayload.code).toBe('AUTH_REQUIRED')

    const sanitizedResponse = await route.GET(
      new Request('http://localhost/api/openclaw/errors/signatures?includeRaw=false') as unknown as import('next/server').NextRequest
    )

    expect(sanitizedResponse.status).toBe(200)
  })

  it('returns safe signatures payload when analytics schema is outdated', async () => {
    mocks.listErrorSignatures.mockRejectedValueOnce(
      new Error('P2021: table ErrorSignatureDailyAggregate not found')
    )

    const route = await import('@/app/api/openclaw/errors/signatures/route')
    const response = await route.GET(
      new Request('http://localhost/api/openclaw/errors/signatures?days=14&limit=20') as unknown as import('next/server').NextRequest
    )
    const payload = (await response.json()) as {
      warning?: string
      code?: string
      data: {
        signatures: unknown[]
        meta: { limit: number; includeRaw: boolean; windowUniqueSignatures: number }
      }
    }

    expect(response.status).toBe(200)
    expect(payload.code).toBe('ERROR_ANALYTICS_SCHEMA_OUTDATED')
    expect(payload.warning).toContain('db:migrate')
    expect(payload.data.signatures).toEqual([])
    expect(payload.data.meta.limit).toBe(20)
    expect(payload.data.meta.includeRaw).toBe(false)
    expect(payload.data.meta.windowUniqueSignatures).toBe(0)
  })

  it('returns sanitized signatures when insights fail due schema drift', async () => {
    mocks.autoGenerateErrorInsights.mockRejectedValueOnce(
      new Error('SQLITE_ERROR: no such table: error_signature_insights')
    )

    const route = await import('@/app/api/openclaw/errors/signatures/route')
    const response = await route.GET(
      new Request('http://localhost/api/openclaw/errors/signatures?days=14&limit=20') as unknown as import('next/server').NextRequest
    )
    const payload = (await response.json()) as {
      warning?: string
      code?: string
      data: { signatures: Array<{ signatureHash: string; insight: unknown }> }
    }

    expect(response.status).toBe(200)
    expect(payload.code).toBe('ERROR_ANALYTICS_SCHEMA_OUTDATED')
    expect(payload.warning).toContain('db:migrate')
    expect(payload.data.signatures).toHaveLength(1)
    expect(payload.data.signatures[0]?.signatureHash).toBe('a'.repeat(40))
  })

  it('supports remediation create-only and create+start flows', async () => {
    const hash = 'a'.repeat(40)
    mocks.createErrorRemediationWorkOrder
      .mockResolvedValueOnce({
        workOrderId: 'wo_1',
        code: 'WO-0001',
        mode: 'create',
        started: false,
        operationId: null,
        workflowId: 'default_routing',
        startError: null,
      })
      .mockResolvedValueOnce({
        workOrderId: 'wo_2',
        code: 'WO-0002',
        mode: 'create_and_start',
        started: true,
        operationId: 'op_2',
        workflowId: 'default_routing',
        startError: null,
      })

    const route = await import('@/app/api/openclaw/errors/signatures/[hash]/remediate/route')

    const createResponse = await route.POST(
      new Request(`http://localhost/api/openclaw/errors/signatures/${hash}/remediate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'create' }),
      }),
      { params: Promise.resolve({ hash }) }
    )
    const createPayload = (await createResponse.json()) as { data: { mode: string; started: boolean } }

    const startResponse = await route.POST(
      new Request(`http://localhost/api/openclaw/errors/signatures/${hash}/remediate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'create_and_start' }),
      }),
      { params: Promise.resolve({ hash }) }
    )
    const startPayload = (await startResponse.json()) as { data: { mode: string; started: boolean; operationId: string | null } }

    expect(createResponse.status).toBe(200)
    expect(createPayload.data.mode).toBe('create')
    expect(createPayload.data.started).toBe(false)

    expect(startResponse.status).toBe(200)
    expect(startPayload.data.mode).toBe('create_and_start')
    expect(startPayload.data.started).toBe(true)
    expect(startPayload.data.operationId).toBe('op_2')

    expect(mocks.createErrorRemediationWorkOrder).toHaveBeenNthCalledWith(1, hash, 'create')
    expect(mocks.createErrorRemediationWorkOrder).toHaveBeenNthCalledWith(2, hash, 'create_and_start')
  })

  it('returns structured response when auto-start dispatch fails after work order creation', async () => {
    const hash = 'b'.repeat(40)
    mocks.createErrorRemediationWorkOrder.mockResolvedValueOnce({
      workOrderId: 'wo_3',
      code: 'WO-0003',
      mode: 'create_and_start',
      started: false,
      operationId: null,
      workflowId: 'default_routing',
      startError: 'Dispatch rejected by manager policy',
    })

    const route = await import('@/app/api/openclaw/errors/signatures/[hash]/remediate/route')
    const response = await route.POST(
      new Request(`http://localhost/api/openclaw/errors/signatures/${hash}/remediate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'create_and_start' }),
      }),
      { params: Promise.resolve({ hash }) }
    )

    const payload = (await response.json()) as {
      data: { started: boolean; startError: string | null }
    }

    expect(response.status).toBe(200)
    expect(payload.data.started).toBe(false)
    expect(payload.data.startError).toContain('Dispatch rejected')
  })
})
