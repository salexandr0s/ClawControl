import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyOperatorRequest: vi.fn(),
  enforceActionPolicy: vi.fn(),
  analyzePackageImport: vi.fn(),
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

vi.mock('@/lib/packages/service', () => ({
  analyzePackageImport: mocks.analyzePackageImport,
  PackageServiceError: class PackageServiceError extends Error {
    constructor(
      message: string,
      public code: string,
      public status: number,
      public details?: Record<string, unknown>
    ) {
      super(message)
      this.name = 'PackageServiceError'
    }
  },
}))

beforeEach(() => {
  vi.resetModules()
  mocks.verifyOperatorRequest.mockReset()
  mocks.enforceActionPolicy.mockReset()
  mocks.analyzePackageImport.mockReset()

  mocks.verifyOperatorRequest.mockReturnValue({ ok: true, principal: { actor: 'user:operator' } })
  mocks.enforceActionPolicy.mockResolvedValue({ allowed: true, policy: { confirmMode: 'CONFIRM', requiresApproval: false } })
})

describe('packages import route', () => {
  it('returns scan report and sha256 in analysis response', async () => {
    mocks.analyzePackageImport.mockResolvedValue({
      packageId: 'pkg_1',
      fileName: 'x.clawpack.zip',
      sha256: 'sha256_test',
      manifest: { id: 'x', name: 'X', version: '1.0.0', kind: 'workflow' },
      scan: {
        outcome: 'pass',
        blocked: false,
        summaryCounts: { danger: 0, warning: 0, info: 0 },
        findings: [],
        scannerVersion: 'v1',
      },
      blockedByScan: false,
      alertWorkOrderId: null,
      summary: { templates: 0, workflows: 1, teams: 0, hasSelection: false },
      conflicts: { templates: [], workflows: [], teams: [] },
      installDoc: null,
      stagedUntil: new Date().toISOString(),
    })

    const route = await import('@/app/api/packages/import/route')
    const file = new File([new Blob(['zip'])], 'x.clawpack.zip', { type: 'application/zip' })
    const form = new FormData()
    form.set('file', file)
    form.set('typedConfirmText', 'CONFIRM')

    const request = new Request('http://localhost/api/packages/import', {
      method: 'POST',
      body: form as never,
    })

    const response = await route.POST(request as never)
    const payload = (await response.json()) as { data: { sha256: string; scan: { outcome: string } } }

    expect(response.status).toBe(201)
    expect(payload.data.sha256).toBe('sha256_test')
    expect(payload.data.scan.outcome).toBe('pass')
  })

  it('falls back to raw multipart parsing when formData has no file', async () => {
    mocks.analyzePackageImport.mockResolvedValue({
      packageId: 'pkg_fallback',
      fileName: 'x.clawpack.zip',
      sha256: 'sha256_fallback',
      manifest: { id: 'x', name: 'X', version: '1.0.0', kind: 'workflow' },
      scan: {
        outcome: 'pass',
        blocked: false,
        summaryCounts: { danger: 0, warning: 0, info: 0 },
        findings: [],
        scannerVersion: 'v1',
      },
      blockedByScan: false,
      alertWorkOrderId: null,
      summary: { templates: 0, workflows: 1, teams: 0, hasSelection: false },
      conflicts: { templates: [], workflows: [], teams: [] },
      installDoc: null,
      stagedUntil: new Date().toISOString(),
    })

    const boundary = '----ClawControl-Test-Boundary'
    const multipart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="x.clawpack.zip"',
      'Content-Type: application/zip',
      '',
      'zip-bytes',
      `--${boundary}`,
      'Content-Disposition: form-data; name="typedConfirmText"',
      '',
      'CONFIRM',
      `--${boundary}--`,
      '',
    ].join('\r\n')
    const body = new TextEncoder().encode(multipart)

    const route = await import('@/app/api/packages/import/route')
    const request = {
      headers: new Headers({
        'content-type': `multipart/form-data; boundary=${boundary}`,
      }),
      clone: () => ({
        formData: async () => new FormData(),
        arrayBuffer: async () => body.buffer,
      }),
      arrayBuffer: async () => body.buffer,
    } as unknown as Request

    const response = await route.POST(request as never)
    const payload = (await response.json()) as { data: { sha256: string } }

    expect(response.status).toBe(201)
    expect(payload.data.sha256).toBe('sha256_fallback')
    expect(mocks.analyzePackageImport).toHaveBeenCalledOnce()
  })
})
