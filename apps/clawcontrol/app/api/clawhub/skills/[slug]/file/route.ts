import { NextRequest, NextResponse } from 'next/server'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

function isSafeFilePath(path: string): boolean {
  if (!path) return false
  if (path.length > 200) return false
  if (path.startsWith('/')) return false
  if (path.includes('..')) return false
  if (path.includes('\\')) return false
  if (path.includes('\0')) return false
  return true
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const normalized = normalizeSlug(slug)
  if (!normalized) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  const sp = request.nextUrl.searchParams
  const version = (sp.get('version') ?? '').trim()
  const path = (sp.get('path') ?? '').trim()

  if (!version || !isSafeFilePath(path)) {
    return NextResponse.json({ error: 'Invalid version or path' }, { status: 400 })
  }

  const adapter = createHttpClawHubAdapter()

  try {
    const file = await adapter.getFile(normalized, version, path)
    const headers = new Headers()
    headers.set('Content-Type', file.contentType || 'application/octet-stream')
    if (file.sha256) headers.set('x-content-sha256', file.sha256)
    if (file.size !== null) headers.set('x-content-size', String(file.size))
    if (file.etag) headers.set('etag', file.etag)

    return new NextResponse(Buffer.from(file.bytes), { status: 200, headers })
  } catch (err) {
    console.error('[api/clawhub/skills/:slug/file] GET error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 })
  }
}
