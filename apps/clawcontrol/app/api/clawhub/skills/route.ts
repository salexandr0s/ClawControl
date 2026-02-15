import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { createHttpClawHubAdapter } from '@/lib/clawhub/http-adapter'
import { mapWithConcurrency } from '@/lib/clawhub/utils'
import type { ClawHubListSort, ClawHubSkillDetailResponse } from '@/lib/clawhub/types'

const DEFAULT_LIMIT = 24

function parseSort(value: string | null): ClawHubListSort {
  if (value === 'downloads' || value === 'stars' || value === 'updated') return value
  return 'downloads'
}

function parseBool(value: string | null, defaultValue: boolean): boolean {
  if (value === null) return defaultValue
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  return defaultValue
}

function parseLimit(value: string | null): number {
  const raw = value ? Number(value) : NaN
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(50, Math.floor(raw)))
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const sort = parseSort(sp.get('sort'))
  const limit = parseLimit(sp.get('limit'))
  const cursor = sp.get('cursor')
  const nonSuspiciousOnly = parseBool(sp.get('nonSuspiciousOnly'), true)

  const adapter = createHttpClawHubAdapter()
  const repos = getRepos()

  try {
    const base = await adapter.searchSkills({
      query: q || undefined,
      sort,
      limit,
      cursor: cursor || null,
      highlightedOnly: false,
    })

    const slugs: string[] =
      base.source === 'skills'
        ? base.data.items.map((item) => item.slug)
        : base.data.results.map((item) => item.slug)

    const normalizedSlugs = slugs.map(normalizeSlug).filter(Boolean)

    // Enrich with owner + moderation via detail endpoint (rate-limited; cached)
    const details = await mapWithConcurrency(
      normalizedSlugs,
      4,
      async (slug): Promise<ClawHubSkillDetailResponse | null> => {
        try {
          return await adapter.getSkill(slug)
        } catch {
          return null
        }
      }
    )

    const detailBySlug = new Map<string, ClawHubSkillDetailResponse>()
    for (const detail of details) {
      if (!detail?.skill?.slug) continue
      detailBySlug.set(normalizeSlug(detail.skill.slug), detail)
    }

    const installs = await repos.clawhubInstalls.listActiveBySlugs(normalizedSlugs)
    const installsBySlug = new Map<string, typeof installs>()
    for (const install of installs) {
      const key = normalizeSlug(install.slug)
      const list = installsBySlug.get(key) ?? []
      list.push(install)
      installsBySlug.set(key, list)
    }

    const items =
      base.source === 'skills'
        ? base.data.items.map((item) => {
            const slug = normalizeSlug(item.slug)
            const detail = detailBySlug.get(slug) ?? null
            const installed = installsBySlug.get(slug) ?? []
            return {
              slug,
              displayName: item.displayName,
              summary: item.summary,
              stats: item.stats,
              tags: item.tags,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
              latestVersion: item.latestVersion ?? null,
              owner: detail?.owner ?? null,
              moderation: detail?.moderation ?? null,
              installed: summarizeInstalls(installed),
            }
          })
        : base.data.results.map((result) => {
            const slug = normalizeSlug(result.slug)
            const detail = detailBySlug.get(slug) ?? null
            const installed = installsBySlug.get(slug) ?? []
            return {
              slug,
              displayName: detail?.skill.displayName ?? result.displayName,
              summary: detail?.skill.summary ?? result.summary,
              stats: detail?.skill.stats ?? null,
              tags: detail?.skill.tags ?? { latest: result.version },
              createdAt: detail?.skill.createdAt ?? result.updatedAt,
              updatedAt: detail?.skill.updatedAt ?? result.updatedAt,
              latestVersion: detail?.latestVersion ?? (result.version ? { version: result.version, createdAt: result.updatedAt, changelog: '' } : null),
              owner: detail?.owner ?? null,
              moderation: detail?.moderation ?? null,
              installed: summarizeInstalls(installed),
            }
          })

    const filtered = nonSuspiciousOnly
      ? items.filter((item) => !item.moderation?.isSuspicious && !item.moderation?.isMalwareBlocked)
      : items

    const nextCursor = base.source === 'skills' ? base.data.nextCursor : null

    return NextResponse.json({
      data: filtered,
      meta: {
        cursor: nextCursor,
        hasMore: Boolean(nextCursor),
      },
    })
  } catch (err) {
    console.error('[api/clawhub/skills] GET error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Failed to fetch marketplace skills' }, { status: 500 })
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
