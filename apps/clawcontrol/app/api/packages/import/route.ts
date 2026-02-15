import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import { analyzePackageImport, PackageServiceError } from '@/lib/packages/service'

export const runtime = 'nodejs'

function extractMultipartBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=([^;]+)/i)
  if (!match) return null
  const raw = match[1].trim()
  if (!raw) return null
  // Strip optional quotes.
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
}

function parseContentDisposition(value: string): { name?: string; filename?: string } {
  const parts = value.split(';').map((p) => p.trim()).filter(Boolean)
  const out: { name?: string; filename?: string } = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    let val = part.slice(eq + 1).trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    if (key === 'name') out.name = val
    if (key === 'filename') out.filename = val
  }
  return out
}

async function parseMultipartFallback(request: NextRequest): Promise<{ file: File | null; typedConfirmText?: string }> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  const boundary = extractMultipartBoundary(contentType)
  if (!boundary) {
    return { file: null }
  }

  const rawBytes = Buffer.from(await request.arrayBuffer())
  const boundaryLine = Buffer.from(`--${boundary}`)
  const boundaryMarker = Buffer.from(`\r\n--${boundary}`)

  let pos = rawBytes.indexOf(boundaryLine)
  if (pos === -1) return { file: null }

  let file: File | null = null
  let typedConfirmText: string | undefined

  while (pos !== -1) {
    let cursor = pos + boundaryLine.length

    // Final boundary: `--boundary--`
    if (rawBytes[cursor] === 45 && rawBytes[cursor + 1] === 45) break

    // Skip CRLF after boundary line.
    if (rawBytes[cursor] === 13 && rawBytes[cursor + 1] === 10) cursor += 2

    const headerEnd = rawBytes.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd === -1) break

    const headerText = rawBytes.slice(cursor, headerEnd).toString('utf8')
    const headers = new Map<string, string>()
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      const key = line.slice(0, idx).trim().toLowerCase()
      const value = line.slice(idx + 1).trim()
      if (!key) continue
      headers.set(key, value)
    }

    const disposition = headers.get('content-disposition') ?? ''
    const disp = parseContentDisposition(disposition)
    const fieldName = disp.name

    const contentStart = headerEnd + 4
    const nextMarker = rawBytes.indexOf(boundaryMarker, contentStart)
    const contentEnd = nextMarker === -1 ? rawBytes.length : nextMarker
    const content = rawBytes.slice(contentStart, contentEnd)

    if (fieldName === 'typedConfirmText') {
      typedConfirmText = content.toString('utf8').trim()
    }

    if (fieldName === 'file') {
      const filename = disp.filename || 'package.zip'
      const partType = headers.get('content-type')?.trim() || 'application/octet-stream'
      file = new File([content], filename, { type: partType })
    }

    if (nextMarker === -1) break
    pos = nextMarker + 2 // skip leading CRLF in marker
  }

  return { file, typedConfirmText }
}

/**
 * POST /api/packages/import
 * Stage and analyze a .clawpack.zip package before deployment.
 */
export async function POST(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-data is required' }, { status: 400 })
  }

  let file: unknown = null
  let typedConfirmText: string | undefined

  try {
    const formData = await request.clone().formData()
    file = formData.get('file')
    typedConfirmText = typeof formData.get('typedConfirmText') === 'string'
      ? String(formData.get('typedConfirmText'))
      : undefined
  } catch {
    const parsed = await parseMultipartFallback(request)
    file = parsed.file
    typedConfirmText = parsed.typedConfirmText
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Package file is required' }, { status: 400 })
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'package.import',
    typedConfirmText,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        error: enforcement.errorType,
        policy: enforcement.policy,
      },
      { status: enforcement.status ?? 403 }
    )
  }

  try {
    const analysis = await analyzePackageImport(file)
    return NextResponse.json({ data: analysis }, { status: 201 })
  } catch (error) {
    if (error instanceof PackageServiceError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.status }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze package' },
      { status: 500 }
    )
  }
}
