import { NextRequest, NextResponse } from 'next/server'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'
import { computeManifestHash } from '@/lib/clawhub/install'

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; version: string }> }
) {
  const { slug, version } = await params
  const normalized = normalizeSlug(slug)
  const v = (version ?? '').trim()

  if (!normalized || !v) {
    return NextResponse.json({ error: 'Missing slug or version' }, { status: 400 })
  }

  const adapter = createHttpClawHubAdapter()

  try {
    const data = await adapter.getSkillVersion(normalized, v)
    const files = Array.isArray(data.version.files) ? data.version.files : []
    const manifestHash = computeManifestHash(files.map((f) => ({ path: f.path, sha256: f.sha256 })))

    return NextResponse.json({
      data: {
        ...data,
        manifestHash,
      },
    })
  } catch (err) {
    console.error('[api/clawhub/skills/:slug/versions/:version] GET error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Failed to fetch version' }, { status: 500 })
  }
}

