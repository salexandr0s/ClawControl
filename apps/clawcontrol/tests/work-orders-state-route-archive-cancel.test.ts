import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getByIdWorkOrder: vi.fn(),
  updateStateWithActivity: vi.fn(),
  updateWorkOrder: vi.fn(),
  enforceGovernor: vi.fn(),
  getRequestActor: vi.fn(),
  verifyOperatorRequest: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    workOrders: {
      getById: mocks.getByIdWorkOrder,
      updateStateWithActivity: mocks.updateStateWithActivity,
      update: mocks.updateWorkOrder,
    },
  }),
}))

vi.mock('@/lib/with-governor', () => ({
  enforceGovernor: mocks.enforceGovernor,
}))

vi.mock('@/lib/request-actor', () => ({
  getRequestActor: mocks.getRequestActor,
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: (result: { error: string; code: string }) => ({
    error: result.error,
    code: result.code,
  }),
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getByIdWorkOrder.mockReset()
  mocks.updateStateWithActivity.mockReset()
  mocks.updateWorkOrder.mockReset()
  mocks.enforceGovernor.mockReset()
  mocks.getRequestActor.mockReset()
  mocks.verifyOperatorRequest.mockReset()

  mocks.getRequestActor.mockReturnValue({
    actor: 'user',
    actorType: 'user',
    actorId: 'operator',
  })
  mocks.verifyOperatorRequest.mockReturnValue({
    ok: true,
    principal: {
      actor: 'user:operator',
      actorType: 'user',
      actorId: 'operator',
      sessionId: 'sess_test',
    },
  })
  mocks.enforceGovernor.mockResolvedValue({ allowed: true })
})

describe('work-order state route archive/cancel behavior', () => {
  it('accepts shipped -> archived via PATCH /api/work-orders/:id', async () => {
    mocks.getByIdWorkOrder.mockResolvedValueOnce({
      id: 'wo_1',
      code: 'WO-001',
      state: 'shipped',
    })
    mocks.updateStateWithActivity.mockResolvedValueOnce({
      workOrder: {
        id: 'wo_1',
        code: 'WO-001',
        state: 'archived',
      },
      previousState: 'shipped',
      activityId: 'act_1',
    })

    const route = await import('@/app/api/work-orders/[id]/route')
    const request = new NextRequest('http://localhost/api/work-orders/wo_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'archived' }),
    })

    const response = await route.PATCH(request, {
      params: Promise.resolve({ id: 'wo_1' }),
    })
    const payload = (await response.json()) as { data?: { state: string } }

    expect(response.status).toBe(200)
    expect(payload.data?.state).toBe('archived')
    expect(mocks.updateStateWithActivity).toHaveBeenCalledWith(
      'wo_1',
      'archived',
      'user',
      'user',
      null
    )
    expect(mocks.enforceGovernor).not.toHaveBeenCalled()
  })

  it('allows blocked -> cancelled with typed confirm without APPROVAL_REQUIRED response', async () => {
    mocks.getByIdWorkOrder.mockResolvedValueOnce({
      id: 'wo_2',
      code: 'WO-002',
      state: 'blocked',
    })
    mocks.enforceGovernor.mockResolvedValueOnce({
      allowed: true,
    })
    mocks.updateStateWithActivity.mockResolvedValueOnce({
      workOrder: {
        id: 'wo_2',
        code: 'WO-002',
        state: 'cancelled',
      },
      previousState: 'blocked',
      activityId: 'act_2',
    })

    const route = await import('@/app/api/work-orders/[id]/route')
    const request = new NextRequest('http://localhost/api/work-orders/wo_2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'cancelled', typedConfirmText: 'WO-002' }),
    })

    const response = await route.PATCH(request, {
      params: Promise.resolve({ id: 'wo_2' }),
    })
    const payload = (await response.json()) as { data?: { state: string }; code?: string }

    expect(response.status).toBe(200)
    expect(payload.code).not.toBe('APPROVAL_REQUIRED')
    expect(payload.data?.state).toBe('cancelled')
    expect(mocks.enforceGovernor).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKind: 'work_order.cancel',
        typedConfirmText: 'WO-002',
      })
    )
  })
})
