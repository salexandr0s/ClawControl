import { NextRequest, NextResponse } from 'next/server'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'
import { scanClawHubSkillVersion } from '@/lib/clawhub/scan'

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
    const result = await scanClawHubSkillVersion({ adapter, slug: normalized, version })
    return NextResponse.json({ data: result })
  } catch (err) {
    console.error('[api/clawhub/skills/:slug/scan] GET error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Failed to scan skill version' }, { status: 500 })
  }
}

