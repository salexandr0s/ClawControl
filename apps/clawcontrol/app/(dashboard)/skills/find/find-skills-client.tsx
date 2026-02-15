'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { PageHeader, EmptyState, Button, SelectDropdown, SegmentedToggle } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { clawhubApi, type ClawHubListSort, type ClawHubMarketplaceSkillListItem, HttpError } from '@/lib/http'
import { cn } from '@/lib/utils'
import { AlertTriangle, ShieldAlert, ShieldCheck, Star, Download, Search, LayoutGrid, List } from 'lucide-react'

type SortOption = { value: ClawHubListSort; label: string }

const SORT_OPTIONS: SortOption[] = [
  { value: 'downloads', label: 'Downloads' },
  { value: 'updated', label: 'Recent' },
  { value: 'stars', label: 'Stars' },
]

function formatCount(value: number | null | undefined): string {
  if (!value || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\\.0$/, '')}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1_000) return `${(value / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  return String(value)
}

function moderationBadge(m: ClawHubMarketplaceSkillListItem['moderation']) {
  if (m?.isMalwareBlocked) {
    return { label: 'Blocked', icon: ShieldAlert, className: 'text-status-error bg-status-error/10 border-status-error/20' }
  }
  if (m?.isSuspicious) {
    return { label: 'Suspicious', icon: AlertTriangle, className: 'text-status-warning bg-status-warning/10 border-status-warning/20' }
  }
  return { label: 'Not flagged', icon: ShieldCheck, className: 'text-status-success bg-status-success/10 border-status-success/20' }
}

export function FindSkillsClient() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ClawHubListSort>('downloads')
  const [nonSuspiciousOnly, setNonSuspiciousOnly] = useState(true)
  const [listViewMode, setListViewMode] = useState<'card' | 'list'>('card')

  const [items, setItems] = useState<ClawHubMarketplaceSkillListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debounceRef = useRef<number | null>(null)

  const fetchPage = useCallback(async (opts: { reset: boolean; cursor?: string | null }) => {
    const isReset = opts.reset
    if (isReset) {
      setIsLoading(true)
    } else {
      setIsLoadingMore(true)
    }
    setError(null)

    try {
      const res = await clawhubApi.listSkills({
        q: query.trim() || undefined,
        sort,
        limit: 24,
        cursor: opts.cursor ?? undefined,
        nonSuspiciousOnly,
      })

      setItems((prev) => (isReset ? res.data : [...prev, ...res.data]))
      setCursor(res.meta.cursor)
      setHasMore(Boolean(res.meta.hasMore))
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Failed to load skills'
      setError(message)
    } finally {
      if (isReset) setIsLoading(false)
      else setIsLoadingMore(false)
    }
  }, [query, sort, nonSuspiciousOnly])

  // Reset & fetch when query/sort/toggle changes (debounced for query)
  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      fetchPage({ reset: true, cursor: null })
    }, query.trim() ? 250 : 0)

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [query, sort, nonSuspiciousOnly, fetchPage])

  const subtitle = useMemo(() => {
    const parts: string[] = []
    parts.push('ClawHub Marketplace')
    parts.push(`Sort: ${SORT_OPTIONS.find((o) => o.value === sort)?.label ?? sort}`)
    parts.push(nonSuspiciousOnly ? 'Non-suspicious only' : 'All skills')
    return parts.join(' • ')
  }, [sort, nonSuspiciousOnly])

  const columns = useMemo<Column<ClawHubMarketplaceSkillListItem>[]>(() => {
    return [
      {
        key: 'name',
        header: 'Skill',
        width: '40%',
        render: (row) => (
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-fg-0 truncate">{row.displayName}</div>
            <div className="text-xs text-fg-2 truncate mt-0.5">{row.summary}</div>
            <div className="text-[11px] text-fg-3 font-mono truncate mt-0.5">{row.slug}</div>
          </div>
        ),
      },
      {
        key: 'author',
        header: 'Author',
        width: '160px',
        render: (row) => (
          <span className="text-xs text-fg-2">
            {row.owner?.handle ? `@${row.owner.handle}` : '—'}
          </span>
        ),
      },
      {
        key: 'moderation',
        header: 'Security',
        width: '140px',
        render: (row) => {
          const badge = moderationBadge(row.moderation)
          const Icon = badge.icon
          return (
            <span className={cn('inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border', badge.className)}>
              <Icon className="w-3.5 h-3.5" />
              {badge.label}
            </span>
          )
        },
      },
      {
        key: 'downloads',
        header: (
          <span className="inline-flex items-center gap-1">
            <Download className="w-3.5 h-3.5" />
            Downloads
          </span>
        ),
        width: '120px',
        align: 'right',
        mono: true,
        render: (row) => <span className="text-fg-2">{formatCount(row.stats?.downloads)}</span>,
      },
      {
        key: 'stars',
        header: (
          <span className="inline-flex items-center gap-1">
            <Star className="w-3.5 h-3.5" />
            Stars
          </span>
        ),
        width: '100px',
        align: 'right',
        mono: true,
        render: (row) => <span className="text-fg-2">{formatCount(row.stats?.stars)}</span>,
      },
      {
        key: 'version',
        header: 'Latest',
        width: '110px',
        mono: true,
        render: (row) => (
          <span className="text-fg-2">{row.tags?.latest ? `v${row.tags.latest}` : '—'}</span>
        ),
      },
      {
        key: 'installed',
        header: 'Installed',
        width: '110px',
        mono: true,
        render: (row) => (
          <span className="text-fg-2">
            {row.installed.global?.version ? `v${row.installed.global.version}` : row.installed.any ? 'yes' : '—'}
          </span>
        ),
      },
    ]
  }, [])

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Find Skills"
        subtitle={subtitle}
        actions={
          <Link href="/skills" className="text-xs text-fg-2 hover:text-fg-1 underline underline-offset-2">
            Back to Installed
          </Link>
        }
      />

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex-1 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ClawHub skills..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-bg-2 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-progress"
            />
          </div>

          <SelectDropdown
            value={sort}
            onChange={(value) => setSort(value as ClawHubListSort)}
            ariaLabel="Sort marketplace skills"
            tone="field"
            size="md"
            options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>

        <div className="flex items-center gap-3">
          <SegmentedToggle
            value={listViewMode}
            onChange={setListViewMode}
            tone="accent"
            size="xs"
            ariaLabel="Marketplace layout"
            items={[
              { value: 'card', label: <LayoutGrid className="w-4 h-4" />, title: 'Card view' },
              { value: 'list', label: <List className="w-4 h-4" />, title: 'Table view' },
            ]}
          />

          <label className="flex items-center gap-2 text-xs text-fg-2 select-none">
            <input
              type="checkbox"
              checked={nonSuspiciousOnly}
              onChange={(e) => setNonSuspiciousOnly(e.target.checked)}
              className="accent-status-info"
            />
            Show only non-suspicious
          </label>
        </div>
      </div>

      {error && (
        <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="py-10 flex items-center justify-center">
          <LoadingSpinner size="md" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0">
          <EmptyState
            icon={<ShieldCheck className="w-8 h-8" />}
            title={query.trim() ? 'No results' : 'No skills found'}
            description={query.trim() ? 'Try a different search term.' : 'ClawHub returned no skills for this filter.'}
          />
        </div>
      ) : (
        <>
          {listViewMode === 'card' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map((item) => (
                <Link
                  key={item.slug}
                  href={{ pathname: `/skills/find/${item.slug}` }}
                  className="group bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 p-4 hover:border-bd-1 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-fg-0 truncate">{item.displayName}</div>
                      <div className="text-xs text-fg-2 truncate mt-0.5">
                        {item.owner?.handle ? `by @${item.owner.handle}` : 'by —'}
                      </div>
                    </div>
                    {item.installed.any && (
                      <span className="shrink-0 text-[11px] px-2 py-1 rounded-full border border-status-info/20 bg-status-info/10 text-status-info">
                        Installed
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-fg-1 mt-2 line-clamp-3">{item.summary}</div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(() => {
                      const badge = moderationBadge(item.moderation)
                      const Icon = badge.icon
                      return (
                        <span className={cn('inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border', badge.className)}>
                          <Icon className="w-3.5 h-3.5" />
                          {badge.label}
                        </span>
                      )
                    })()}

                    {item.tags?.latest && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-bd-0 bg-bg-3 text-fg-2">
                        v{item.tags.latest}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-fg-2">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <Download className="w-3.5 h-3.5" />
                        {formatCount(item.stats?.downloads)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Star className="w-3.5 h-3.5" />
                        {formatCount(item.stats?.stars)}
                      </span>
                    </div>
                    {item.installed.global?.version && (
                      <span className="font-mono text-[11px] text-fg-3 group-hover:text-fg-2 transition-colors">
                        current v{item.installed.global.version}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
              <CanonicalTable
                columns={columns}
                rows={items}
                rowKey={(row) => row.slug}
                onRowClick={(row) => router.push(`/skills/find/${row.slug}` as Route)}
                density="compact"
              />
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                onClick={() => fetchPage({ reset: false, cursor })}
                disabled={isLoadingMore}
                variant="secondary"
                size="md"
              >
                {isLoadingMore && <LoadingSpinner size="sm" />}
                {isLoadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
