'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { PageHeader, SelectDropdown, Button } from '@clawcontrol/ui'
import { MetricCard } from '@/components/ui/metric-card'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { ProviderLogo } from '@/components/provider-logo'
import { apiPost, agentsApi } from '@/lib/http'
import { cn } from '@/lib/utils'
import { resolveUsageWindowIso } from '@/lib/openclaw/usage-window'
import { usePageReadyTiming } from '@/lib/perf/client-timing'
import {
  Activity,
  CalendarDays,
  Clock3,
  Database,
  DollarSign,
  Info,
  Layers,
  RefreshCw,
  Search,
  Users,
  AlertTriangle,
  Download,
  Filter,
} from 'lucide-react'

type UsageSort = 'cost_desc' | 'tokens_desc' | 'recent_desc'
type UsageScope = 'parity' | 'all'

type UsageSyncApi = {
  ok: boolean
  lockAcquired: boolean
  filesScanned: number
  filesUpdated: number
  sessionsUpdated: number
  toolsUpserted: number
  cursorResets: number
  filesTotal: number
  filesRemaining: number
  coveragePct: number
  indexVersion?: string
  rebuildTriggered?: boolean
  rebuildInProgress?: boolean
  parity?: {
    sessionLimit: number
    sampledCount: number
    sessionsInRangeTotal: number
    missingCoverageCount: number
  } | null
  durationMs: number
}

type UsageSummaryApi = {
  data: {
    from: string
    to: string
    timezone: string
    meta: {
      scope: UsageScope
      sessionSampleLimit: number | null
      sessionSampleCount: number | null
      sessionsInRangeTotal: number | null
      missingCoverageCount: number | null
    }
    totals: {
      inputTokens: string
      outputTokens: string
      cacheReadTokens: string
      cacheWriteTokens: string
      totalTokens: string
      totalCostMicros: string
      cacheEfficiencyPct: number
      sessionCount: number
      avgTokensPerDay: string
      avgCostMicrosPerDay: string
    }
    series: Array<{
      dayStart: string
      inputTokens: string
      outputTokens: string
      cacheReadTokens: string
      cacheWriteTokens: string
      totalTokens: string
      totalCostMicros: string
    }>
  }
}

type UsageActivityApi = {
  data: {
    totals: {
      totalTokens: string
      totalCostMicros: string
    }
    weekdays: Array<{
      weekday: number
      label: string
      totalTokens: string
      totalCostMicros: string
    }>
    hours: Array<{
      hour: number
      totalTokens: string
      totalCostMicros: string
    }>
  }
}

type UsageBreakdownApi = {
  data: {
    groupBy: 'agent' | 'model' | 'provider' | 'source' | 'sessionClass' | 'tool'
    groups: Array<{
      key: string
      totalTokens: string
      totalCostMicros: string
      sessionCount: number
      toolCallCount?: string
    }>
  }
}

type UsageOptionsApi = {
  data: {
    agents: string[]
    sessionClasses: string[]
    sources: string[]
    channels: string[]
    sessionKinds: string[]
    providers: string[]
    models: Array<{ key: string; label: string }>
    tools: string[]
  }
}

type UsageSessionsApi = {
  data: {
    page: number
    pageSize: number
    totalSessions: number
    totalPages: number
    sort: UsageSort
    rows: Array<{
      sessionId: string
      agentId: string
      sessionKey: string | null
      source: string | null
      channel: string | null
      sessionKind: string | null
      sessionClass: string | null
      providerKey: string | null
      operationId: string | null
      workOrderId: string | null
      hasErrors: boolean
      firstSeenAt: string | null
      lastSeenAt: string | null
      totalTokens: string
      totalCostMicros: string
      modelCount: number
      topModels: string[]
    }>
  }
}

type UsageFilters = {
  from: string
  to: string
  timezone: string
  scope: UsageScope
  agentId: string
  sessionClass: string
  source: string
  channel: string
  sessionKind: string
  providerKey: string
  modelKey: string
  toolName: string
  hasErrors: 'all' | 'true' | 'false'
  q: string
  page: number
  pageSize: number
  sort: UsageSort
}

type BreakdownKey = 'agent' | 'model' | 'provider' | 'source' | 'sessionClass' | 'tool'

type BreakdownState = Record<BreakdownKey, UsageBreakdownApi['data'] | null>
type AgentAvatarEntry = { agentId: string; name: string }

const DEFAULT_WINDOW_DAYS = 30
const DEFAULT_PAGE_SIZE = 50
const PARITY_SESSION_LIMIT = 1000
const PARITY_PRIME_MAX_MS = 8000
const PARITY_PRIME_MAX_FILES = 1000

const breakdownKeys: BreakdownKey[] = ['model', 'agent', 'provider', 'source', 'sessionClass', 'tool']

function defaultFilters(): UsageFilters {
  const { fromIso, toIso } = resolveUsageWindowIso(DEFAULT_WINDOW_DAYS)
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  return {
    from: fromIso,
    to: toIso,
    timezone: localTz,
    scope: 'parity',
    agentId: '',
    sessionClass: '',
    source: '',
    channel: '',
    sessionKind: '',
    providerKey: '',
    modelKey: '',
    toolName: '',
    hasErrors: 'all',
    q: '',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    sort: 'cost_desc',
  }
}

function parseFilters(searchParams: URLSearchParams): UsageFilters {
  const defaults = defaultFilters()
  const hasErrors = searchParams.get('hasErrors')
  const sort = searchParams.get('sort') as UsageSort | null
  const scopeParam = searchParams.get('scope')

  const page = Number.parseInt(searchParams.get('page') ?? `${defaults.page}`, 10)
  const pageSize = Number.parseInt(searchParams.get('pageSize') ?? `${defaults.pageSize}`, 10)

  return {
    from: searchParams.get('from') ?? defaults.from,
    to: searchParams.get('to') ?? defaults.to,
    timezone: searchParams.get('timezone') ?? defaults.timezone,
    scope: scopeParam === 'all' ? 'all' : 'parity',
    agentId: searchParams.get('agentId') ?? '',
    sessionClass: searchParams.get('sessionClass') ?? '',
    source: searchParams.get('source') ?? '',
    channel: searchParams.get('channel') ?? '',
    sessionKind: searchParams.get('sessionKind') ?? '',
    providerKey: searchParams.get('providerKey') ?? '',
    modelKey: searchParams.get('modelKey') ?? '',
    toolName: searchParams.get('toolName') ?? '',
    hasErrors: hasErrors === 'true' || hasErrors === 'false' ? hasErrors : 'all',
    q: searchParams.get('q') ?? '',
    page: Number.isFinite(page) && page > 0 ? page : defaults.page,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, pageSize) : defaults.pageSize,
    sort: sort === 'tokens_desc' || sort === 'recent_desc' || sort === 'cost_desc' ? sort : defaults.sort,
  }
}

function buildSearchParams(filters: UsageFilters): URLSearchParams {
  const params = new URLSearchParams()
  params.set('from', filters.from)
  params.set('to', filters.to)
  params.set('timezone', filters.timezone)
  params.set('scope', filters.scope)

  if (filters.agentId) params.set('agentId', filters.agentId)
  if (filters.sessionClass) params.set('sessionClass', filters.sessionClass)
  if (filters.source) params.set('source', filters.source)
  if (filters.channel) params.set('channel', filters.channel)
  if (filters.sessionKind) params.set('sessionKind', filters.sessionKind)
  if (filters.providerKey) params.set('providerKey', filters.providerKey)
  if (filters.modelKey) params.set('modelKey', filters.modelKey)
  if (filters.toolName) params.set('toolName', filters.toolName)
  if (filters.hasErrors !== 'all') params.set('hasErrors', filters.hasErrors)
  if (filters.q.trim()) params.set('q', filters.q.trim())

  if (filters.page > 1) params.set('page', String(filters.page))
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(filters.pageSize))
  if (filters.sort !== 'cost_desc') params.set('sort', filters.sort)

  return params
}

function toDateInputValue(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function toFromIso(dateInput: string): string {
  return `${dateInput}T00:00:00.000Z`
}

function toToIso(dateInput: string): string {
  return `${dateInput}T23:59:59.999Z`
}

function formatCompactNumber(value: string): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(parsed)
}

function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function formatUsdFromMicros(micros: string): string {
  const parsed = Number(micros) / 1_000_000
  if (!Number.isFinite(parsed)) return '$0.00'
  return `$${parsed.toFixed(parsed >= 10 ? 2 : 4)}`
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function formatSyncSummary(stats: UsageSyncApi): string {
  if (!stats.lockAcquired) return 'Another usage sync is running'

  const duration = formatDurationMs(stats.durationMs)
  const hasCoverage = Number.isFinite(stats.coveragePct) && stats.filesTotal > 0
  const coverage = hasCoverage ? `${stats.coveragePct.toFixed(1)}% coverage` : 'coverage unknown'
  const remaining = hasCoverage && stats.filesRemaining > 0 ? ` • ${stats.filesRemaining} remaining` : ''

  if (stats.sessionsUpdated > 0) return `Updated ${stats.sessionsUpdated} sessions (${duration}) • ${coverage}${remaining}`
  if (stats.filesUpdated > 0) return `Updated ${stats.filesUpdated} files (${duration}) • ${coverage}${remaining}`
  return `Scanned ${stats.filesScanned} files (${duration}) • ${coverage}${remaining}`
}

function intensityClass(value: number, maxValue: number): string {
  if (maxValue <= 0 || value <= 0) return 'bg-bg-3/60 border-bd-0'
  const ratio = value / maxValue
  if (ratio >= 0.8) return 'bg-status-danger/55 border-status-danger/50'
  if (ratio >= 0.55) return 'bg-status-danger/40 border-status-danger/40'
  if (ratio >= 0.3) return 'bg-status-warning/35 border-status-warning/35'
  return 'bg-status-info/30 border-status-info/30'
}

export function UsageClient() {
  usePageReadyTiming('usage', true)

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  const [summary, setSummary] = useState<UsageSummaryApi['data'] | null>(null)
  const [activity, setActivity] = useState<UsageActivityApi['data'] | null>(null)
  const [options, setOptions] = useState<UsageOptionsApi['data'] | null>(null)
  const [sessions, setSessions] = useState<UsageSessionsApi['data'] | null>(null)
  const [breakdowns, setBreakdowns] = useState<BreakdownState>({
    agent: null,
    model: null,
    provider: null,
    source: null,
    sessionClass: null,
    tool: null,
  })

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMeta, setSyncMeta] = useState<{ at: string; stats: UsageSyncApi } | null>(null)
  const [agentAvatarMap, setAgentAvatarMap] = useState<Record<string, AgentAvatarEntry>>({})
  const [error, setError] = useState<string | null>(null)

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      timezone: filters.timezone,
      scope: filters.scope,
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sort: filters.sort,
    })

    if (filters.agentId) params.set('agentId', filters.agentId)
    if (filters.sessionClass) params.set('sessionClass', filters.sessionClass)
    if (filters.source) params.set('source', filters.source)
    if (filters.channel) params.set('channel', filters.channel)
    if (filters.sessionKind) params.set('sessionKind', filters.sessionKind)
    if (filters.providerKey) params.set('providerKey', filters.providerKey)
    if (filters.modelKey) params.set('modelKey', filters.modelKey)
    if (filters.toolName) params.set('toolName', filters.toolName)
    if (filters.hasErrors !== 'all') params.set('hasErrors', filters.hasErrors)
    if (filters.q.trim()) params.set('q', filters.q.trim())

    return params
  }, [filters])

  const optionsQueryParams = useMemo(() => {
    const params = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      timezone: filters.timezone,
      scope: filters.scope,
    })
    return params.toString()
  }, [filters.from, filters.scope, filters.timezone, filters.to])

  const exportCsvUrl = useMemo(() => {
    const params = new URLSearchParams(queryParams)
    params.set('format', 'csv')
    return `/api/openclaw/usage/explore/export?${params.toString()}`
  }, [queryParams])

  const exportJsonUrl = useMemo(() => {
    const params = new URLSearchParams(queryParams)
    params.set('format', 'json')
    return `/api/openclaw/usage/explore/export?${params.toString()}`
  }, [queryParams])

  const commitFilters = useCallback((patch: Partial<UsageFilters>) => {
    const next: UsageFilters = {
      ...filters,
      ...patch,
    }

    const paginationOnly = Object.keys(patch).every((key) => key === 'page' || key === 'pageSize' || key === 'sort')
    if (!paginationOnly) {
      next.page = 1
    }

    const params = buildSearchParams(next)
    router.replace(`${pathname}?${params.toString()}` as Route)
  }, [filters, pathname, router])

  const applyQuickRange = useCallback((days: number) => {
    const { fromIso, toIso } = resolveUsageWindowIso(days)
    commitFilters({ from: fromIso, to: toIso })
  }, [commitFilters])

  const loadAgentAvatarMap = useCallback(async () => {
    try {
      const result = await agentsApi.list({
        mode: 'light',
        includeSessionOverlay: false,
        includeModelOverlay: false,
        syncSessions: false,
        cacheTtlMs: 60_000,
      })

      const nextMap: Record<string, AgentAvatarEntry> = {}
      for (const agent of result.data) {
        const runtimeAgentId = agent.runtimeAgentId?.trim().toLowerCase()
        if (!runtimeAgentId) continue

        nextMap[runtimeAgentId] = {
          agentId: agent.id,
          name: agent.displayName || agent.name || agent.runtimeAgentId,
        }
      }

      setAgentAvatarMap(nextMap)
    } catch {
      // Non-blocking: usage can still render with identicon fallback.
    }
  }, [])

  const fetchUsage = useCallback(async (options?: { skipPrimeSync?: boolean }) => {
    setLoading(true)
    setError(null)

    try {
      if (filters.scope === 'parity' && !options?.skipPrimeSync) {
        try {
          const prime = await apiPost<UsageSyncApi>('/api/openclaw/usage/sync', {
            mode: 'parity',
            from: filters.from,
            to: filters.to,
            sessionLimit: PARITY_SESSION_LIMIT,
            maxMs: PARITY_PRIME_MAX_MS,
            maxFiles: PARITY_PRIME_MAX_FILES,
          })
          setSyncMeta({ at: new Date().toISOString(), stats: prime })
        } catch {
          // Non-blocking: still render current DB state if prime sync cannot run.
        }
      }

      const [summaryRes, activityRes, sessionsRes, optionsRes, ...breakdownResponses] = await Promise.all([
        fetch(`/api/openclaw/usage/explore/summary?${queryParams.toString()}`),
        fetch(`/api/openclaw/usage/explore/activity?${queryParams.toString()}`),
        fetch(`/api/openclaw/usage/explore/sessions?${queryParams.toString()}`),
        fetch(`/api/openclaw/usage/explore/options?${optionsQueryParams}`),
        ...breakdownKeys.map((groupBy) => fetch(`/api/openclaw/usage/explore/breakdown?groupBy=${groupBy}&${queryParams.toString()}`)),
      ])

      if (!summaryRes.ok || !activityRes.ok || !sessionsRes.ok || !optionsRes.ok) {
        throw new Error('Usage explore APIs returned an error')
      }

      const [summaryJson, activityJson, sessionsJson, optionsJson] = await Promise.all([
        summaryRes.json() as Promise<UsageSummaryApi>,
        activityRes.json() as Promise<UsageActivityApi>,
        sessionsRes.json() as Promise<UsageSessionsApi>,
        optionsRes.json() as Promise<UsageOptionsApi>,
      ])

      const nextBreakdowns: BreakdownState = {
        agent: null,
        model: null,
        provider: null,
        source: null,
        sessionClass: null,
        tool: null,
      }

      for (const response of breakdownResponses) {
        if (!response.ok) continue
        const json = await response.json() as UsageBreakdownApi
        nextBreakdowns[json.data.groupBy] = json.data
      }

      setSummary(summaryJson.data)
      setActivity(activityJson.data)
      setSessions(sessionsJson.data)
      setOptions(optionsJson.data)
      setBreakdowns(nextBreakdowns)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load usage analytics')
    } finally {
      setLoading(false)
    }
  }, [filters.from, filters.scope, filters.to, optionsQueryParams, queryParams])

  useEffect(() => {
    void fetchUsage()
  }, [fetchUsage])

  useEffect(() => {
    void loadAgentAvatarMap()
  }, [loadAgentAvatarMap])

  const handleSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)

    try {
      const sync = await apiPost<UsageSyncApi>('/api/openclaw/usage/sync', {
        maxMs: 15_000,
        maxFiles: 400,
        ...(filters.scope === 'parity'
          ? {
            mode: 'parity',
            from: filters.from,
            to: filters.to,
            sessionLimit: PARITY_SESSION_LIMIT,
          }
          : {}),
      })
      setSyncMeta({ at: new Date().toISOString(), stats: sync })
      await fetchUsage({ skipPrimeSync: true })
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Usage sync failed')
    } finally {
      setSyncing(false)
    }
  }, [fetchUsage, filters.from, filters.scope, filters.to, syncing])

  const maxDailyTokens = useMemo(() => {
    const values = summary?.series.map((point) => Number(point.totalTokens)) ?? []
    return values.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0)
  }, [summary?.series])

  const weekdayMax = useMemo(() => {
    const values = activity?.weekdays.map((point) => Number(point.totalTokens)) ?? []
    return values.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0)
  }, [activity?.weekdays])

  const orderedWeekdays = useMemo(() => {
    const weekdays = activity?.weekdays ?? []
    return [...weekdays].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7))
  }, [activity?.weekdays])

  const hourMax = useMemo(() => {
    const values = activity?.hours.map((point) => Number(point.totalTokens)) ?? []
    return values.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0)
  }, [activity?.hours])

  const sessionColumns = useMemo<Column<UsageSessionsApi['data']['rows'][number]>[]>(() => [
    {
      key: 'session',
      header: 'Session',
      width: '280px',
      render: (row) => (
        <div className="min-w-0">
          <div className="text-fg-0 text-xs font-mono truncate" title={row.sessionKey ?? row.sessionId}>
            {row.sessionKey ?? row.sessionId}
          </div>
          <div className="text-[11px] text-fg-2 truncate">{row.sessionId}</div>
        </div>
      ),
    },
    {
      key: 'agentId',
      header: 'Agent',
      width: '140px',
      mono: true,
    },
    {
      key: 'class',
      header: 'Class',
      width: '130px',
      render: (row) => row.sessionClass ?? 'unknown',
    },
    {
      key: 'source',
      header: 'Source',
      width: '120px',
      render: (row) => row.source ?? 'unknown',
    },
    {
      key: 'models',
      header: 'Models',
      width: '200px',
      render: (row) => (
        <div className="truncate" title={row.topModels.join(', ')}>
          {row.modelCount} • {row.topModels.join(', ') || 'unknown'}
        </div>
      ),
    },
    {
      key: 'totalTokens',
      header: 'Tokens',
      width: '110px',
      align: 'right',
      mono: true,
      render: (row) => formatCompactNumber(row.totalTokens),
    },
    {
      key: 'totalCostMicros',
      header: 'Cost',
      width: '110px',
      align: 'right',
      mono: true,
      render: (row) => formatUsdFromMicros(row.totalCostMicros),
    },
    {
      key: 'lastSeenAt',
      header: 'Last Seen',
      width: '160px',
      render: (row) => row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '—',
    },
    {
      key: 'hasErrors',
      header: 'Errors',
      width: '80px',
      align: 'center',
      render: (row) => (
        <span className={cn('text-xs font-medium', row.hasErrors ? 'text-status-danger' : 'text-status-success')}>
          {row.hasErrors ? 'yes' : 'no'}
        </span>
      ),
    },
  ], [])

  const dailyTypeTotal = summary
    ? Number(summary.totals.inputTokens) + Number(summary.totals.outputTokens) + Number(summary.totals.cacheReadTokens) + Number(summary.totals.cacheWriteTokens)
    : 0

  const tokenTypePct = useMemo(() => {
    if (!summary || !Number.isFinite(dailyTypeTotal) || dailyTypeTotal <= 0) {
      return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      }
    }

    const total = dailyTypeTotal
    return {
      input: (Number(summary.totals.inputTokens) / total) * 100,
      output: (Number(summary.totals.outputTokens) / total) * 100,
      cacheRead: (Number(summary.totals.cacheReadTokens) / total) * 100,
      cacheWrite: (Number(summary.totals.cacheWriteTokens) / total) * 100,
    }
  }, [dailyTypeTotal, summary])

  const sessionKpiValue = useMemo(() => {
    if (!summary) return '—'

    if (summary.meta.scope === 'parity') {
      const total = summary.meta.sessionsInRangeTotal ?? summary.totals.sessionCount
      return formatInteger(total)
    }

    return formatInteger(summary.totals.sessionCount)
  }, [summary])

  const sessionKpiTooltip = useMemo(() => {
    if (!summary || summary.meta.scope !== 'parity') return null
    const sampled = summary.meta.sessionSampleCount ?? summary.totals.sessionCount
    const total = summary.meta.sessionsInRangeTotal ?? sampled
    return `Sampled sessions: ${formatInteger(sampled)}/${formatInteger(total)}`
  }, [summary])

  const parityCoverageWarning = useMemo(() => {
    if (!summary || summary.meta.scope !== 'parity') return null
    const missing = summary.meta.missingCoverageCount ?? 0
    if (missing <= 0) return null
    return `${missing} sampled session${missing === 1 ? '' : 's'} still missing from ingestion.`
  }, [summary])

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Usage Intelligence"
        subtitle="Analyze token and cost flow across agents, models, channels, cron/background, and time"
        actions={
          <>
            <a href={exportCsvUrl} className="no-underline">
              <Button variant="secondary" size="sm">
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </Button>
            </a>
            <a href={exportJsonUrl} className="no-underline">
              <Button variant="secondary" size="sm">
                <Database className="w-3.5 h-3.5" />
                Export JSON
              </Button>
            </a>
            <Button onClick={handleSync} disabled={syncing} variant="primary" size="sm">
              <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
              {syncing ? 'Syncing...' : 'Sync Usage'}
            </Button>
          </>
        }
      />

      <div className="rounded-[var(--radius-lg)] border border-bd-0 bg-bg-2 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => applyQuickRange(1)} className="btn-secondary btn-sm">Today</button>
          <button onClick={() => applyQuickRange(7)} className="btn-secondary btn-sm">7d</button>
          <button onClick={() => applyQuickRange(30)} className="btn-secondary btn-sm">30d</button>

          <SelectDropdown
            value={filters.scope}
            onChange={(value) => commitFilters({ scope: value as UsageScope })}
            options={[
              { value: 'parity', label: 'Official parity' },
              { value: 'all', label: 'All ingested' },
            ]}
            tone="toolbar"
            size="sm"
            ariaLabel="Usage scope"
            className="w-[170px]"
          />

          <div className="h-5 w-px bg-bd-0" />

          <label className="text-xs text-fg-2">From</label>
          <input
            type="date"
            value={toDateInputValue(filters.from)}
            onChange={(event) => {
              const value = event.target.value
              if (!value) return
              commitFilters({ from: toFromIso(value) })
            }}
            className="px-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1"
          />

          <label className="text-xs text-fg-2">To</label>
          <input
            type="date"
            value={toDateInputValue(filters.to)}
            onChange={(event) => {
              const value = event.target.value
              if (!value) return
              commitFilters({ to: toToIso(value) })
            }}
            className="px-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1"
          />

          <SelectDropdown
            value={filters.timezone}
            onChange={(value) => commitFilters({ timezone: value })}
            options={[
              { value: 'UTC', label: 'UTC' },
              { value: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', label: 'Local time zone' },
            ]}
            tone="toolbar"
            size="sm"
            ariaLabel="Timezone"
            className="w-[180px]"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
          <SelectDropdown
            value={filters.agentId}
            onChange={(value) => commitFilters({ agentId: value })}
            options={[{ value: '', label: 'All agents' }, ...(options?.agents ?? []).map((agent) => ({ value: agent, label: agent }))]}
            tone="field"
            size="sm"
            ariaLabel="Agent filter"
          />

          <SelectDropdown
            value={filters.sessionClass}
            onChange={(value) => commitFilters({ sessionClass: value })}
            options={[{ value: '', label: 'All session classes' }, ...(options?.sessionClasses ?? []).map((value) => ({ value, label: value }))]}
            tone="field"
            size="sm"
            ariaLabel="Session class filter"
          />

          <SelectDropdown
            value={filters.source}
            onChange={(value) => commitFilters({ source: value })}
            options={[{ value: '', label: 'All sources' }, ...(options?.sources ?? []).map((value) => ({ value, label: value }))]}
            tone="field"
            size="sm"
            ariaLabel="Source filter"
          />

          <SelectDropdown
            value={filters.channel}
            onChange={(value) => commitFilters({ channel: value })}
            options={[{ value: '', label: 'All channels' }, ...(options?.channels ?? []).map((value) => ({ value, label: value }))]}
            tone="field"
            size="sm"
            ariaLabel="Channel filter"
          />

          <SelectDropdown
            value={filters.sessionKind}
            onChange={(value) => commitFilters({ sessionKind: value })}
            options={[{ value: '', label: 'All session kinds' }, ...(options?.sessionKinds ?? []).map((value) => ({ value, label: value }))]}
            tone="field"
            size="sm"
            ariaLabel="Session kind filter"
          />

          <SelectDropdown
            value={filters.providerKey}
            onChange={(value) => commitFilters({ providerKey: value })}
            options={[{ value: '', label: 'All providers' }, ...(options?.providers ?? []).map((value) => ({ value, label: value }))]}
            tone="field"
            size="sm"
            ariaLabel="Provider filter"
          />

          <SelectDropdown
            value={filters.modelKey}
            onChange={(value) => commitFilters({ modelKey: value })}
            options={[{ value: '', label: 'All models' }, ...(options?.models ?? []).map((model) => ({ value: model.key, label: model.label }))]}
            tone="field"
            size="sm"
            ariaLabel="Model filter"
          />

          <SelectDropdown
            value={filters.toolName}
            onChange={(value) => commitFilters({ toolName: value })}
            options={[{ value: '', label: 'All tools' }, ...(options?.tools ?? []).map((tool) => ({ value: tool, label: tool }))]}
            tone="field"
            size="sm"
            ariaLabel="Tool filter"
          />

          <SelectDropdown
            value={filters.hasErrors}
            onChange={(value) => commitFilters({ hasErrors: value as UsageFilters['hasErrors'] })}
            options={[
              { value: 'all', label: 'Errors: all' },
              { value: 'true', label: 'Errors only' },
              { value: 'false', label: 'No errors only' },
            ]}
            tone="field"
            size="sm"
            ariaLabel="Error filter"
          />

          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-3" />
            <input
              value={filters.q}
              onChange={(event) => commitFilters({ q: event.target.value })}
              placeholder="Search session/model/source..."
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 placeholder:text-fg-3"
            />
          </div>
        </div>

        {syncMeta && (
          <div className="text-xs text-fg-2">
            Last sync: {new Date(syncMeta.at).toLocaleString()} • {formatSyncSummary(syncMeta.stats)}
          </div>
        )}

        {parityCoverageWarning && (
          <div className="inline-flex items-center gap-1 rounded border border-status-warning/40 bg-status-warning/10 px-2 py-1 text-xs text-status-warning">
            <AlertTriangle className="w-3.5 h-3.5" />
            {parityCoverageWarning}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <MetricCard label="Total Tokens" value={summary ? formatCompactNumber(summary.totals.totalTokens) : '—'} icon={Layers} tone="info" size="compact" />
        <MetricCard label="Total Cost" value={summary ? formatUsdFromMicros(summary.totals.totalCostMicros) : '—'} icon={DollarSign} tone="warning" size="compact" />
        <MetricCard label="Avg / day" value={summary ? formatUsdFromMicros(summary.totals.avgCostMicrosPerDay) : '—'} icon={CalendarDays} tone="muted" size="compact" />
        <MetricCard
          label="Sessions"
          value={(
            <span className="inline-flex items-center gap-1">
              <span>{sessionKpiValue}</span>
              {sessionKpiTooltip && (
                <span className="inline-flex items-center text-fg-3" title={sessionKpiTooltip} aria-label={sessionKpiTooltip}>
                  <Info className="w-3 h-3" />
                </span>
              )}
            </span>
          )}
          icon={Users}
          tone="success"
          size="compact"
        />
        <MetricCard label="Cache Efficiency" value={summary ? `${summary.totals.cacheEfficiencyPct.toFixed(2)}%` : '—'} icon={Database} tone="progress" size="compact" />
        <MetricCard label="Input Tokens" value={summary ? formatCompactNumber(summary.totals.inputTokens) : '—'} icon={Filter} tone="muted" size="compact" />
        <MetricCard label="Output Tokens" value={summary ? formatCompactNumber(summary.totals.outputTokens) : '—'} icon={Activity} tone="danger" size="compact" />
        <MetricCard
          label="Error Filter"
          value={filters.hasErrors === 'all' ? 'All' : filters.hasErrors === 'true' ? 'Only errors' : 'No errors'}
          icon={AlertTriangle}
          tone={filters.hasErrors === 'true' ? 'danger' : 'muted'}
          size="compact"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-[var(--radius-lg)] border border-bd-0 bg-bg-2 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="terminal-header">Daily Token Usage</h2>
            <div className="text-xs text-fg-2">{summary?.series.length ?? 0} days in window</div>
          </div>

          {loading ? (
            <div className="text-sm text-fg-2">Loading usage series...</div>
          ) : !summary || summary.series.length === 0 ? (
            <div className="text-sm text-fg-2">No usage in selected range.</div>
          ) : (
            <div className="flex-1 flex flex-col gap-3">
              <div className="min-h-[11rem] flex-1 flex items-end gap-1 rounded border border-bd-0 bg-bg-3/50 p-2">
                {summary.series.map((point) => {
                  const value = Number(point.totalTokens)
                  const height = maxDailyTokens > 0 && Number.isFinite(value)
                    ? Math.max(3, (value / maxDailyTokens) * 100)
                    : 0

                  return (
                    <div key={point.dayStart} className="group/bar relative flex-1 h-full flex items-end">
                      <div className="w-full rounded-sm bg-status-info/90 hover:bg-status-info" style={{ height: `${height}%` }} />
                      <div className="absolute hidden group-hover/bar:block bottom-full mb-2 left-1/2 -translate-x-1/2 z-10">
                        <div className="rounded border border-bd-0 bg-bg-2 px-2 py-1 text-[11px] min-w-[150px]">
                          <div className="text-fg-2">{new Date(point.dayStart).toLocaleDateString()}</div>
                          <div className="font-mono text-fg-1">Tokens: {formatCompactNumber(point.totalTokens)}</div>
                          <div className="font-mono text-fg-1">Cost: {formatUsdFromMicros(point.totalCostMicros)}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="space-y-2">
                <div className="text-xs text-fg-2">Token mix</div>
                <div className="h-4 rounded overflow-hidden border border-bd-0 flex">
                  <div style={{ width: `${tokenTypePct.input}%` }} className="bg-status-warning/80" title={`Input ${tokenTypePct.input.toFixed(1)}%`} />
                  <div style={{ width: `${tokenTypePct.output}%` }} className="bg-status-danger/80" title={`Output ${tokenTypePct.output.toFixed(1)}%`} />
                  <div style={{ width: `${tokenTypePct.cacheWrite}%` }} className="bg-status-success/70" title={`Cache write ${tokenTypePct.cacheWrite.toFixed(1)}%`} />
                  <div style={{ width: `${tokenTypePct.cacheRead}%` }} className="bg-status-info/70" title={`Cache read ${tokenTypePct.cacheRead.toFixed(1)}%`} />
                </div>
                <div className="text-xs text-fg-2 flex flex-wrap gap-3">
                  <span>Input {summary ? formatCompactNumber(summary.totals.inputTokens) : '—'}</span>
                  <span>Output {summary ? formatCompactNumber(summary.totals.outputTokens) : '—'}</span>
                  <span>Cache write {summary ? formatCompactNumber(summary.totals.cacheWriteTokens) : '—'}</span>
                  <span>Cache read {summary ? formatCompactNumber(summary.totals.cacheReadTokens) : '—'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[var(--radius-lg)] border border-bd-0 bg-bg-2 p-4 space-y-3">
          <h2 className="terminal-header">Activity By Time</h2>

          <div className="space-y-2">
            <div className="text-xs text-fg-2">Day of week</div>
            <div className="grid grid-cols-2 gap-2">
              {orderedWeekdays.map((day) => {
                const tokens = Number(day.totalTokens)
                return (
                  <div key={day.weekday} className={cn('rounded border px-2 py-1.5', intensityClass(tokens, weekdayMax))}>
                    <div className="text-xs text-fg-1">{day.label}</div>
                    <div className="text-sm font-mono text-fg-0">{formatCompactNumber(day.totalTokens)}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-fg-2 flex items-center justify-between">
              <span>Hours</span>
              <span className="inline-flex items-center gap-1"><Clock3 className="w-3.5 h-3.5" />0 → 23</span>
            </div>
            <div className="grid grid-cols-12 gap-1">
              {(activity?.hours ?? []).map((hour) => {
                const tokens = Number(hour.totalTokens)
                return (
                  <div
                    key={hour.hour}
                    title={`${hour.hour}:00 • ${formatCompactNumber(hour.totalTokens)} tokens`}
                    className={cn('h-7 rounded border', intensityClass(tokens, hourMax))}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {breakdownKeys.map((key) => (
          <BreakdownCard
            key={key}
            groupBy={key}
            title={
              key === 'model' ? 'Top Models' :
                key === 'agent' ? 'Top Agents' :
                  key === 'provider' ? 'Top Providers' :
                    key === 'source' ? 'Top Sources' :
                      key === 'sessionClass' ? 'Session Classes' : 'Top Tools'
            }
            breakdown={breakdowns[key]}
            agentAvatarMap={agentAvatarMap}
            loading={loading}
          />
        ))}
      </div>

      <div className="rounded-[var(--radius-lg)] border border-bd-0 bg-bg-2 overflow-hidden">
        <div className="px-4 py-3 border-b border-bd-0 flex flex-wrap items-center justify-between gap-2">
          <h2 className="terminal-header">Session Explorer</h2>
          <div className="flex items-center gap-2">
            <SelectDropdown
              value={filters.sort}
              onChange={(value) => commitFilters({ sort: value as UsageSort })}
              options={[
                { value: 'cost_desc', label: 'Sort: cost' },
                { value: 'tokens_desc', label: 'Sort: tokens' },
                { value: 'recent_desc', label: 'Sort: recent' },
              ]}
              tone="toolbar"
              size="sm"
              ariaLabel="Session sort"
            />

            <SelectDropdown
              value={String(filters.pageSize)}
              onChange={(value) => commitFilters({ pageSize: Number.parseInt(value, 10) || DEFAULT_PAGE_SIZE })}
              options={[
                { value: '25', label: '25 / page' },
                { value: '50', label: '50 / page' },
                { value: '100', label: '100 / page' },
              ]}
              tone="toolbar"
              size="sm"
              ariaLabel="Session page size"
            />
          </div>
        </div>

        <div className="p-3">
          <CanonicalTable
            columns={sessionColumns}
            rows={sessions?.rows ?? []}
            rowKey={(row) => row.sessionId}
            density="compact"
            emptyState={loading ? 'Loading sessions…' : 'No sessions in this range'}
          />

          <div className="mt-3 flex items-center justify-between text-xs text-fg-2">
            <span>
              {sessions ? `${sessions.totalSessions} sessions • page ${sessions.page}/${sessions.totalPages}` : '—'}
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => commitFilters({ page: Math.max(1, filters.page - 1) })}
                disabled={filters.page <= 1}
                className="btn-secondary btn-sm disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => commitFilters({ page: Math.min(sessions?.totalPages ?? filters.page, filters.page + 1) })}
                disabled={!sessions || filters.page >= sessions.totalPages}
                className="btn-secondary btn-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BreakdownCard({
  groupBy,
  title,
  breakdown,
  agentAvatarMap,
  loading,
}: {
  groupBy: BreakdownKey
  title: string
  breakdown: UsageBreakdownApi['data'] | null
  agentAvatarMap: Record<string, AgentAvatarEntry>
  loading: boolean
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-bd-0 bg-bg-2 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="terminal-header">{title}</h3>
      </div>

      {loading ? (
        <div className="text-sm text-fg-2">Loading…</div>
      ) : !breakdown || breakdown.groups.length === 0 ? (
        <div className="text-sm text-fg-2">No data</div>
      ) : (
        <div className="space-y-1.5">
          {breakdown.groups.slice(0, 8).map((group) => (
            <div key={group.key} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="min-w-0 flex items-center gap-1.5">
                  {groupBy === 'provider' && (
                    <ProviderLogo provider={group.key} size="xs" className="opacity-80" />
                  )}
                  {groupBy === 'agent' && (
                    <AgentAvatar
                      agentId={agentAvatarMap[group.key.trim().toLowerCase()]?.agentId ?? group.key}
                      name={agentAvatarMap[group.key.trim().toLowerCase()]?.name ?? group.key}
                      size="xs"
                      className="opacity-85"
                    />
                  )}
                  <div className="text-xs text-fg-0 truncate" title={group.key}>{group.key}</div>
                </div>
                <div className="text-[11px] text-fg-2">
                  {formatCompactNumber(group.totalTokens)} tok • {group.sessionCount} sessions
                  {group.toolCallCount ? ` • ${formatCompactNumber(group.toolCallCount)} calls` : ''}
                </div>
              </div>
              <div className="text-xs font-mono text-fg-1 whitespace-nowrap">{formatUsdFromMicros(group.totalCostMicros)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
