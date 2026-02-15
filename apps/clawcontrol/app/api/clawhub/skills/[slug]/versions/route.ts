import { NextRequest, NextResponse } from 'next/server'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

function parseLimit(value: string | null): number {
  const raw = value ? Number(value) : NaN
  if (!Number.isFinite(raw)) return 25
  return Math.max(1, Math.min(50, Math.floor(raw)))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const normalized = normalizeSlug(slug)
  if (!normalized) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
  }

  const sp = request.nextUrl.searchParams
  const limit = parseLimit(sp.get('limit'))
  const cursor = sp.get('cursor')

  const adapter = createHttpClawHubAdapter()

  try {
    const data = await adapter.listVersions(normalized, { limit, cursor: cursor || null })
    return NextResponse.json({
      data: data.items,
      meta: {
        cursor: data.nextCursor,
        hasMore: Boolean(data.nextCursor),
      },
    })
  } catch (err) {
    console.error('[api/clawhub/skills/:slug/versions] GET error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 })
  }
}

