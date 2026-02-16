import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkflowDefinition: vi.fn(),
  getWorkflowUsageStats: vi.fn(),
  updateCustomWorkflow: vi.fn(),
  deleteCustomWorkflow: vi.fn(),
  verifyOperatorRequest: vi.fn(),
  enforceActionPolicy: vi.fn(),
}))

vi.mock('@/lib/workflows/registry', () => ({
  getWorkflowDefinition: mocks.getWorkflowDefinition,
}))

vi.mock('@/lib/workflows/service', () => ({
  getWorkflowUsageStats: mocks.getWorkflowUsageStats,
  updateCustomWorkflow: mocks.updateCustomWorkflow,
  deleteCustomWorkflow: mocks.deleteCustomWorkflow,
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

function workflowServiceError(
  message: string,
  code: string,
  status: number,
  details?: Record<string, unknown>
): Error {
  const err = new Error(message) as Error & {
    name: string
    code: string
    status: number
    details?: Record<string, unknown>
  }
  err.name = 'WorkflowServiceError'
  err.code = code
  err.status = status
  err.details = details
  return err
}

beforeEach(() => {
  vi.resetModules()
  mocks.getWorkflowDefinition.mockReset()
  mocks.getWorkflowUsageStats.mockReset()
  mocks.updateCustomWorkflow.mockReset()
  mocks.deleteCustomWorkflow.mockReset()
  mocks.verifyOperatorRequest.mockReset()
  mocks.enforceActionPolicy.mockReset()

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
})

describe('workflow [id] route', () => {
  it('updates custom workflow via PATCH', async () => {
    mocks.updateCustomWorkflow.mockResolvedValue({
      id: 'cc_bug_fix',
      description: 'Updated workflow',
      stages: [{ ref: 'plan', agent: 'plan' }],
    })

    const route = await import('@/app/api/workflows/[id]/route')
    const request = new Request('http://localhost/api/workflows/cc_bug_fix', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow: {
          id: 'cc_bug_fix',
          description: 'Updated workflow',
          stages: [{ ref: 'plan', agent: 'plan' }],
        },
        typedConfirmText: 'CONFIRM',
      }),
    })

    const response = await route.PATCH(request as never, {
      params: Promise.resolve({ id: 'cc_bug_fix' }),
    })
    const payload = (await response.json()) as { data: { id: string } }

    expect(response.status).toBe(200)
    expect(payload.data.id).toBe('cc_bug_fix')
    expect(mocks.updateCustomWorkflow).toHaveBeenCalledWith(
      'cc_bug_fix',
      expect.objectContaining({ id: 'cc_bug_fix' })
    )
  })

  it('deletes workflow via DELETE', async () => {
    mocks.deleteCustomWorkflow.mockResolvedValue(undefined)

    const route = await import('@/app/api/workflows/[id]/route')
    const request = new Request('http://localhost/api/workflows/cc_bug_fix', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedConfirmText: 'CONFIRM' }),
    })

    const response = await route.DELETE(request as never, {
      params: Promise.resolve({ id: 'cc_bug_fix' }),
    })
    const payload = (await response.json()) as { success: boolean }

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(mocks.deleteCustomWorkflow).toHaveBeenCalledWith('cc_bug_fix')
  })

  it('returns service error for in-use workflow delete attempts', async () => {
    mocks.deleteCustomWorkflow.mockRejectedValue(
      workflowServiceError(
        'Workflow is in use by active work orders: cc_bug_fix',
        'WORKFLOW_IN_USE',
        409,
        { workflowId: 'cc_bug_fix', activeWorkOrders: 2 }
      )
    )

    const route = await import('@/app/api/workflows/[id]/route')
    const request = new Request('http://localhost/api/workflows/cc_bug_fix', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedConfirmText: 'CONFIRM' }),
    })

    const response = await route.DELETE(request as never, {
      params: Promise.resolve({ id: 'cc_bug_fix' }),
    })
    const payload = (await response.json()) as { code?: string; error: string }

    expect(response.status).toBe(409)
    expect(payload.code).toBe('WORKFLOW_IN_USE')
    expect(payload.error).toContain('in use')
  })
})
