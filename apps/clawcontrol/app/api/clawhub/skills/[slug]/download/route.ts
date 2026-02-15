import { NextRequest, NextResponse } from 'next/server'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const normalized = normalizeSlug(slug)
  if (!normalized) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  const version = (request.nextUrl.searchParams.get('version') ?? '').trim()
  if (!version) return NextResponse.json({ error: 'Missing version' }, { status: 400 })

  const adapter = createHttpClawHubAdapter()

  try {
    const zip = await adapter.downloadZip(normalized, version)
    const headers = new Headers()
    headers.set('Content-Type', zip.contentType || 'application/zip')
    headers.set('Content-Disposition', `attachment; filename="${(zip.fileName ?? `${normalized}-${version}.zip`).replace(/"/g, '')}"`)
    headers.set('Cache-Control', 'private, max-age=60')

    return new NextResponse(Buffer.from(zip.bytes), { status: 200, headers })
  } catch (err) {
    console.error('[api/clawhub/skills/:slug/download] GET error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Failed to download zip' }, { status: 500 })
  }
}
