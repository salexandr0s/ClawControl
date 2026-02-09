import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { NextRequest } from 'next/server'

interface MockRepos {
  receipts: {
    create: ReturnType<typeof vi.fn>
    append: ReturnType<typeof vi.fn>
    finalize: ReturnType<typeof vi.fn>
  }
  activities: {
    create: ReturnType<typeof vi.fn>
  }
}

interface RouteModule {
  POST: (request: NextRequest) => Promise<Response>
}

const originalOpenClawWorkspace = process.env.OPENCLAW_WORKSPACE
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

function buildTemplateConfig(
  id: string,
  options?: {
    name?: string
    renderTargets?: Array<{ source: string; destination: string }>
  }
): string {
  const config = {
    id,
    name: options?.name ?? id,
    description: `Template for ${id}`,
    version: '1.0.0',
    role: 'BUILD',
    render: options?.renderTargets
      ? {
          engine: 'mustache',
          targets: options.renderTargets,
        }
      : undefined,
  }

  return JSON.stringify(config, null, 2)
}

function buildTemplateFiles(
  id: string,
  options?: {
    includeSoul?: boolean
    includeOverlay?: boolean
    renderTargets?: Array<{ source: string; destination: string }>
  }
): Record<string, string> {
  const includeSoul = options?.includeSoul ?? true
  const includeOverlay = options?.includeOverlay ?? true

  const files: Record<string, string> = {
    'template.json': buildTemplateConfig(id, {
      renderTargets: options?.renderTargets,
    }),
  }

  if (includeSoul) {
    files['SOUL.md'] = `# ${id} SOUL`
  }

  if (includeOverlay) {
    files['overlay.md'] = `# ${id} overlay`
  }

  return files
}

async function createZipFile(
  entries: Record<string, string>,
  name = 'bundle.zip'
): Promise<File> {
  const zip = new JSZip()

  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content)
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return new File([Buffer.from(bytes)], name, { type: 'application/zip' })
}

function createTemplateJsonPayload(id: string, overrides?: Partial<Record<string, unknown>>) {
  return {
    templateId: id,
    name: `${id} Template`,
    version: '1.0.0',
    exportedAt: '2026-02-09T00:00:00.000Z',
    files: buildTemplateFiles(id),
    ...overrides,
  }
}

async function loadRouteModule(): Promise<{ route: RouteModule; repos: MockRepos }> {
  receiptCounter += 1

  const repos: MockRepos = {
    receipts: {
      create: vi.fn(async () => ({ id: `receipt-${receiptCounter}` })),
      append: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
    },
    activities: {
      create: vi.fn(async () => undefined),
    },
  }

  vi.doMock('@/lib/repo', () => ({
    getRepos: () => repos,
  }))

  vi.doMock('@/lib/with-governor', () => ({
    enforceTypedConfirm: vi.fn(async ({ typedConfirmText }: { typedConfirmText?: string }) => {
      if (typedConfirmText === 'CONFIRM') {
        return { allowed: true, policy: {} }
      }
      return { allowed: false, errorType: 'TYPED_CONFIRM_REQUIRED', policy: {} }
    }),
  }))

  const route = await import('@/app/api/agent-templates/import/route')
  return {
    route,
    repos,
  }
}

async function postJson(route: RouteModule, body: unknown): Promise<Response> {
  const request = new NextRequest('http://localhost/api/agent-templates/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return route.POST(request)
}

async function postMultipart(route: RouteModule, file: File, typedConfirmText = 'CONFIRM'): Promise<Response> {
  const formData = new FormData()
  formData.set('file', file)
  formData.set('typedConfirmText', typedConfirmText)

  const request = new NextRequest('http://localhost/api/agent-templates/import', {
    method: 'POST',
    body: formData,
  })

  return route.POST(request)
}

beforeEach(async () => {
  tempWorkspace = join(tmpdir(), `template-import-test-${randomUUID()}`)
  await fsp.mkdir(tempWorkspace, { recursive: true })

  process.env.OPENCLAW_WORKSPACE = tempWorkspace
  delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  delete process.env.WORKSPACE_ROOT

  vi.resetModules()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()

  restoreEnv('OPENCLAW_WORKSPACE', originalOpenClawWorkspace)
  restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
  restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)

  if (tempWorkspace) {
    await fsp.rm(tempWorkspace, { recursive: true, force: true })
  }
})

describe('template import route', () => {
  it('imports a valid single-template zip at archive root', async () => {
    const { route } = await loadRouteModule()

    const zip = await createZipFile(buildTemplateFiles('root-template'))
    const response = await postMultipart(route, zip)
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect((body.importSummary as { templateCount: number }).templateCount).toBe(1)
    expect((body.importSummary as { templateIds: string[] }).templateIds).toEqual(['root-template'])

    const soul = await fsp.readFile(
      join(tempWorkspace, 'agent-templates', 'root-template', 'SOUL.md'),
      'utf8'
    )
    expect(soul).toContain('root-template')
  })

  it('imports a valid single-template zip in one top-level folder', async () => {
    const { route } = await loadRouteModule()

    const files = buildTemplateFiles('folder-template')
    const entries: Record<string, string> = {}
    for (const [name, content] of Object.entries(files)) {
      entries[`folder-template/${name}`] = content
    }

    const zip = await createZipFile(entries)
    const response = await postMultipart(route, zip)
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect((body.importSummary as { templateIds: string[] }).templateIds).toEqual(['folder-template'])

    const overlay = await fsp.readFile(
      join(tempWorkspace, 'agent-templates', 'folder-template', 'overlay.md'),
      'utf8'
    )
    expect(overlay).toContain('folder-template')
  })

  it('imports a valid multi-template bundle zip', async () => {
    const { route } = await loadRouteModule()

    const alpha = buildTemplateFiles('alpha')
    const bravo = buildTemplateFiles('bravo')

    const entries: Record<string, string> = {}
    for (const [name, content] of Object.entries(alpha)) {
      entries[`alpha/${name}`] = content
    }
    for (const [name, content] of Object.entries(bravo)) {
      entries[`bravo/${name}`] = content
    }

    const zip = await createZipFile(entries)
    const response = await postMultipart(route, zip)
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect((body.importSummary as { templateCount: number }).templateCount).toBe(2)
    expect((body.importSummary as { templateIds: string[] }).templateIds).toEqual(['alpha', 'bravo'])

    await expect(
      fsp.access(join(tempWorkspace, 'agent-templates', 'alpha', 'template.json'))
    ).resolves.toBeUndefined()
    await expect(
      fsp.access(join(tempWorkspace, 'agent-templates', 'bravo', 'template.json'))
    ).resolves.toBeUndefined()
  })

  it('rejects zip missing template.json', async () => {
    const { route } = await loadRouteModule()

    const zip = await createZipFile({
      'alpha/SOUL.md': '# alpha',
      'alpha/overlay.md': '# overlay',
    })

    const response = await postMultipart(route, zip)
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error.toLowerCase()).toContain('missing')
    expect(body.error.toLowerCase()).toContain('template.json')
  })

  it('rejects folder/id mismatch', async () => {
    const { route } = await loadRouteModule()

    const files = buildTemplateFiles('actual-id')
    const entries: Record<string, string> = {}
    for (const [name, content] of Object.entries(files)) {
      entries[`folder-name/${name}`] = content
    }

    const zip = await createZipFile(entries)
    const response = await postMultipart(route, zip)
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('Template validation failed')
  })

  it('rejects missing required source files', async () => {
    const { route } = await loadRouteModule()

    const files = buildTemplateFiles('missing-source', {
      includeSoul: true,
      includeOverlay: false,
      renderTargets: [
        { source: 'SOUL.md', destination: 'workspace/agents/{{agentSlug}}/SOUL.md' },
        { source: 'overlay.md', destination: 'workspace/agents/{{agentSlug}}.md' },
      ],
    })

    const zip = await createZipFile(files)
    const response = await postMultipart(route, zip)
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('missing required source file')
    expect(body.error).toContain('overlay.md')
  })

  it('rejects duplicate template IDs in one bundle', async () => {
    const { route } = await loadRouteModule()

    const response = await postJson(route, {
      templates: [
        createTemplateJsonPayload('duplicate-id'),
        createTemplateJsonPayload('duplicate-id'),
      ],
      typedConfirmText: 'CONFIRM',
    })

    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('Duplicate template ID')
  })

  it('rejects zip-slip/path traversal entries', async () => {
    const { route } = await loadRouteModule()

    const zip = new JSZip()
    const files = buildTemplateFiles('safe-template')
    zip.file('../evil.txt', 'malicious')
    for (const [path, content] of Object.entries(files)) {
      zip.file(path, content)
    }

    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const file = new File([Buffer.from(bytes)], 'unsafe.zip', { type: 'application/zip' })

    const response = await postMultipart(route, file)
    const body = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toContain('Invalid ZIP entry name')
  })

  it('rejects existing-template conflict', async () => {
    const { route } = await loadRouteModule()

    await fsp.mkdir(join(tempWorkspace, 'agent-templates', 'conflict-id'), { recursive: true })

    const zip = await createZipFile(buildTemplateFiles('conflict-id'))
    const response = await postMultipart(route, zip)
    const body = await response.json() as { error: string; existingTemplateIds: string[] }

    expect(response.status).toBe(409)
    expect(body.error).toContain('already exists')
    expect(body.existingTemplateIds).toEqual(['conflict-id'])
  })

  it('keeps JSON wrapper import backward-compatible', async () => {
    const { route } = await loadRouteModule()

    const response = await postJson(route, {
      template: createTemplateJsonPayload('json-regression'),
      typedConfirmText: 'CONFIRM',
    })

    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect((body.importSummary as { templateIds: string[] }).templateIds).toEqual(['json-regression'])

    await expect(
      fsp.access(join(tempWorkspace, 'agent-templates', 'json-regression', 'template.json'))
    ).resolves.toBeUndefined()
  })

  it('keeps bundle imports all-or-nothing on conflict', async () => {
    const { route } = await loadRouteModule()

    await fsp.mkdir(join(tempWorkspace, 'agent-templates', 'existing-template'), { recursive: true })

    const freshFiles = buildTemplateFiles('fresh-template')
    const existingFiles = buildTemplateFiles('existing-template')

    const entries: Record<string, string> = {}
    for (const [name, content] of Object.entries(freshFiles)) {
      entries[`fresh-template/${name}`] = content
    }
    for (const [name, content] of Object.entries(existingFiles)) {
      entries[`existing-template/${name}`] = content
    }

    const zip = await createZipFile(entries)
    const response = await postMultipart(route, zip)

    expect(response.status).toBe(409)

    await expect(
      fsp.access(join(tempWorkspace, 'agent-templates', 'fresh-template'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
