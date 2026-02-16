import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listWorkflowDefinitions: vi.fn(),
  createCustomWorkflow: vi.fn(),
  verifyOperatorRequest: vi.fn(),
  enforceActionPolicy: vi.fn(),
  workOrderCount: vi.fn(),
  workflowScanFindMany: vi.fn(),
}))

vi.mock('@/lib/workflows/registry', () => ({
  listWorkflowDefinitions: mocks.listWorkflowDefinitions,
}))

vi.mock('@/lib/workflows/service', () => ({
  createCustomWorkflow: mocks.createCustomWorkflow,
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: (result: { error: string; code: string }) => ({
    error: result.error,
    code: result.code,
  }),
}))

vi.mock('@/lib/with-governor', () => ({
  enforceActionPolicy: mocks.enforceActionPolicy,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    workOrder: {
      count: mocks.workOrderCount,
    },
    artifactScanRecord: {
      findMany: mocks.workflowScanFindMany,
    },
  },
}))

beforeEach(() => {
  vi.resetModules()
  mocks.listWorkflowDefinitions.mockReset()
  mocks.createCustomWorkflow.mockReset()
  mocks.verifyOperatorRequest.mockReset()
  mocks.enforceActionPolicy.mockReset()
  mocks.workOrderCount.mockReset()
  mocks.workflowScanFindMany.mockReset()

  mocks.verifyOperatorRequest.mockReturnValue({
    ok: true,
    principal: {
      actor: 'user:operator',
      actorType: 'user',
      actorId: 'operator',
      sessionId: 'sess_test',
    },
  })

  mocks.enforceActionPolicy.mockResolvedValue({
    allowed: true,
    policy: { requiresApproval: false, confirmMode: 'CONFIRM' },
  })
  mocks.workflowScanFindMany.mockResolvedValue([])
})

describe('workflows routes', () => {
  it('lists workflow summaries with usage counts', async () => {
    mocks.listWorkflowDefinitions.mockResolvedValue([
      {
        id: 'cc_greenfield_project',
        source: 'custom',
        sourcePath: '/workflows/cc_greenfield_project.yaml',
        editable: true,
        stages: 4,
        loops: 1,
        updatedAt: '2026-02-12T00:00:00.000Z',
        workflow: {
          id: 'cc_greenfield_project',
          description: 'Greenfield workflow',
          stages: [],
        },
      },
    ])
    mocks.workOrderCount.mockResolvedValue(3)

    const route = await import('@/app/api/workflows/route')
    const response = await route.GET()
    const payload = (await response.json()) as {
      data: Array<{ id: string; inUse: number; source: string; trustLevel: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0].id).toBe('cc_greenfield_project')
    expect(payload.data[0].inUse).toBe(3)
    expect(payload.data[0].source).toBe('custom')
    expect(payload.data[0].trustLevel).toBe('unscanned')
  })

  it('rejects create without operator auth', async () => {
    mocks.verifyOperatorRequest.mockReturnValue({
      ok: false,
      status: 401,
      code: 'AUTH_REQUIRED',
      error: 'Operator session is required',
    })

    const route = await import('@/app/api/workflows/route')
    const request = new Request('http://localhost/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: { id: 'custom_flow' } }),
    })

    const response = await route.POST(request as never)
    const payload = (await response.json()) as { code: string }

    expect(response.status).toBe(401)
    expect(payload.code).toBe('AUTH_REQUIRED')
  })

  it('creates custom workflow through service', async () => {
    mocks.createCustomWorkflow.mockResolvedValue({
      id: 'custom_flow',
      description: 'Custom flow',
      stages: [{ ref: 'plan', agent: 'plan' }],
    })

    const route = await import('@/app/api/workflows/route')
    const request = new Request('http://localhost/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow: {
          id: 'custom_flow',
          description: 'Custom flow',
          stages: [{ ref: 'plan', agent: 'plan' }],
        },
        typedConfirmText: 'CONFIRM',
      }),
    })

    const response = await route.POST(request as never)
    const payload = (await response.json()) as { data: { id: string } }

    expect(response.status).toBe(201)
    expect(payload.data.id).toBe('custom_flow')
    expect(mocks.createCustomWorkflow).toHaveBeenCalled()
  })
})
