import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const normalized = normalizeSlug(slug)
  if (!normalized) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
  }

  const adapter = createHttpClawHubAdapter()
  const repos = getRepos()

  try {
    const detail = await adapter.getSkill(normalized)
    const installs = await repos.clawhubInstalls.listActiveBySlug(normalized)

    return NextResponse.json({
      data: {
        ...detail,
        installed: summarizeInstalls(installs),
      },
    })
  } catch (err) {
    console.error('[api/clawhub/skills/:slug] GET error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Failed to fetch skill detail' }, { status: 500 })
  }
}

function summarizeInstalls(installs: Array<{
  scope: 'global' | 'agent'
  scopeKey: string
  version: string
  installedAt: Date
  lastReceiptId: string | null
}>) {
  const global = installs.find((i) => i.scope === 'global') ?? null
  const agents = installs
    .filter((i) => i.scope === 'agent')
    .map((i) => ({
      agentSlug: i.scopeKey,
      version: i.version,
      installedAt: i.installedAt,
      lastReceiptId: i.lastReceiptId,
    }))

  return {
    any: installs.length > 0,
    global: global
      ? {
          version: global.version,
          installedAt: global.installedAt,
          lastReceiptId: global.lastReceiptId,
        }
      : null,
    agents,
    agentCount: agents.length,
  }
}

