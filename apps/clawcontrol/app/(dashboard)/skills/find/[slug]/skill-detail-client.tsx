'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Button,
  EmptyState,
  PageHeader,
  PageSection,
  SelectDropdown,
  TypedConfirmModal,
} from '@clawcontrol/ui'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { Markdown } from '@/components/prompt-kit/markdown'
import { useSettings } from '@/lib/settings-context'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import {
  clawhubApi,
  receiptsApi,
  type ClawHubLocalScanResult,
  type ClawHubMarketplaceSkillDetail,
  type ClawHubSkillVersionDetail,
  type ClawHubVersionsListItem,
  HttpError,
} from '@/lib/http'
import type { AgentDTO, ReceiptDTO } from '@/lib/repo'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react'

type TabId = 'files' | 'compare' | 'versions'

type InstallScope = 'global' | 'agent'

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

function formatCount(value: number | null | undefined): string {
  if (!value || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\\.0$/, '')}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1_000) return `${(value / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  return String(value)
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx++
  }
  const rounded = idx === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded}${units[idx]}`
}

function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleDateString()
  } catch {
    return '—'
  }
}

function moderationBadge(m: ClawHubMarketplaceSkillDetail['moderation']) {
  if (m?.isMalwareBlocked) {
    return { label: 'Blocked', icon: ShieldAlert, className: 'text-status-error bg-status-error/10 border-status-error/20' }
  }
  if (m?.isSuspicious) {
    return { label: 'Suspicious', icon: AlertTriangle, className: 'text-status-warning bg-status-warning/10 border-status-warning/20' }
  }
  return { label: 'Not flagged', icon: ShieldCheck, className: 'text-status-success bg-status-success/10 border-status-success/20' }
}

function extractEnvVarsFromText(text: string): string[] {
  if (!text) return []
  const matches = text.match(/\\b[A-Z][A-Z0-9_]{2,80}\\b/g) ?? []
  const filtered = matches.filter((m) => {
    if (!m.includes('_')) return false
    return (
      m.endsWith('_API_KEY')
      || m.endsWith('_TOKEN')
      || m.endsWith('_SECRET')
      || m.endsWith('_KEY')
    )
  })
  return Array.from(new Set(filtered)).sort((a, b) => a.localeCompare(b))
}

function inferBinsFromFiles(files: Array<{ path: string }>): string[] {
  const lowerPaths = files.map((f) => f.path.toLowerCase())
  const bins: string[] = []

  const needsNode = lowerPaths.some((p) =>
    p === 'package.json' || p.endsWith('.mjs') || p.endsWith('.js') || p.endsWith('.ts')
  )
  const needsPython = lowerPaths.some((p) =>
    p === 'pyproject.toml' || p === 'requirements.txt' || p.endsWith('.py')
  )
  const needsBash = lowerPaths.some((p) => p.endsWith('.sh'))

  if (needsNode) bins.push('node')
  if (needsPython) bins.push('python')
  if (needsBash) bins.push('bash')

  return bins
}

function pickSkillMdPath(files: Array<{ path: string }>): string | null {
  const direct = files.find((f) => f.path === 'SKILL.md' || f.path === 'skill.md')
  return direct?.path ?? null
}

function diffFileManifests(
  a: Array<{ path: string; sha256: string }>,
  b: Array<{ path: string; sha256: string }>
) {
  const aByPath = new Map(a.map((f) => [f.path, f.sha256]))
  const bByPath = new Map(b.map((f) => [f.path, f.sha256]))

  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []

  for (const [path, sha] of bByPath.entries()) {
    if (!aByPath.has(path)) {
      added.push(path)
      continue
    }
    if (aByPath.get(path) !== sha) changed.push(path)
  }

  for (const path of aByPath.keys()) {
    if (!bByPath.has(path)) removed.push(path)
  }

  added.sort((x, y) => x.localeCompare(y))
  removed.sort((x, y) => x.localeCompare(y))
  changed.sort((x, y) => x.localeCompare(y))

  return { added, removed, changed }
}

export function SkillDetailClient({ slug, agents }: { slug: string; agents: AgentDTO[] }) {
  const normalizedSlug = useMemo(() => normalizeSlug(slug), [slug])
  const { skipTypedConfirm } = useSettings()
  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const [detail, setDetail] = useState<ClawHubMarketplaceSkillDetail | null>(null)
  const [versions, setVersions] = useState<ClawHubVersionsListItem[]>([])
  const [versionsCursor, setVersionsCursor] = useState<string | null>(null)
  const [versionsHasMore, setVersionsHasMore] = useState(false)

  const [selectedVersion, setSelectedVersion] = useState<string>('')
  const [versionDetail, setVersionDetail] = useState<ClawHubSkillVersionDetail | null>(null)

  const [skillMd, setSkillMd] = useState<string>('')
  const [skillMdError, setSkillMdError] = useState<string | null>(null)
  const [loadingSkillMd, setLoadingSkillMd] = useState(false)

  const [scan, setScan] = useState<ClawHubLocalScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)

  const [activeTab, setActiveTab] = useState<TabId>('files')

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showInstallModal, setShowInstallModal] = useState(false)
  const [showUninstallModal, setShowUninstallModal] = useState(false)

  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installApprovalId, setInstallApprovalId] = useState<string | null>(null)

  const [uninstalling, setUninstalling] = useState(false)
  const [uninstallError, setUninstallError] = useState<string | null>(null)
  const [uninstallApprovalId, setUninstallApprovalId] = useState<string | null>(null)

  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null)
  const [lastReceipt, setLastReceipt] = useState<ReceiptDTO | null>(null)

  const versionSelectOptions = useMemo(
    () => {
      const list = versions.map((v) => ({ value: v.version, label: v.version }))
      return list.length > 0
        ? list
        : selectedVersion
          ? [{ value: selectedVersion, label: selectedVersion }]
          : []
    },
    [versions, selectedVersion]
  )

  const runtimeReqs = useMemo(() => {
    const files = versionDetail?.version?.files ?? []
    const bins = inferBinsFromFiles(files)
    const envVars = extractEnvVarsFromText(skillMd)
    const primaryEnv = envVars[0] ?? null
    return { bins, envVars, primaryEnv }
  }, [versionDetail?.version?.files, skillMd])

  const moderation = detail?.moderation ?? null
  const moderationUi = useMemo(() => moderationBadge(moderation), [moderation])

  const fetchInitial = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setDetail(null)
    setVersions([])
    setVersionsCursor(null)
    setVersionsHasMore(false)
    setSelectedVersion('')
    setVersionDetail(null)
    setSkillMd('')
    setScan(null)

    try {
      const [detailRes, versionsRes] = await Promise.all([
        clawhubApi.getSkill(normalizedSlug),
        clawhubApi.listVersions(normalizedSlug, { limit: 50 }),
      ])

      setDetail(detailRes.data)
      setVersions(versionsRes.data)
      setVersionsCursor(versionsRes.meta.cursor)
      setVersionsHasMore(Boolean(versionsRes.meta.hasMore))

      const latest =
        detailRes.data.latestVersion?.version
        ?? detailRes.data.skill.tags?.latest
        ?? versionsRes.data[0]?.version
        ?? ''

      setSelectedVersion(latest)

      const receiptFromInstall = detailRes.data.installed.global?.lastReceiptId
        ?? detailRes.data.installed.agents[0]?.lastReceiptId
        ?? null
      setLastReceiptId(receiptFromInstall)
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Failed to load skill'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [normalizedSlug])

  const fetchMoreVersions = useCallback(async () => {
    if (!versionsHasMore || !versionsCursor) return
    try {
      const res = await clawhubApi.listVersions(normalizedSlug, { limit: 50, cursor: versionsCursor })
      setVersions((prev) => {
        const merged = [...prev, ...res.data]
        const seen = new Set<string>()
        return merged.filter((v) => {
          if (seen.has(v.version)) return false
          seen.add(v.version)
          return true
        })
      })
      setVersionsCursor(res.meta.cursor)
      setVersionsHasMore(Boolean(res.meta.hasMore))
    } catch {
      // ignore
    }
  }, [normalizedSlug, versionsHasMore, versionsCursor])

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  // Fetch version detail + SKILL.md + local scan when selectedVersion changes
  useEffect(() => {
    let cancelled = false
    if (!selectedVersion) return

    async function run() {
      setSkillMdError(null)
      setLoadingSkillMd(true)
      setScanError(null)
      setIsScanning(true)

      try {
        const vRes = await clawhubApi.getVersion(normalizedSlug, selectedVersion)
        if (cancelled) return
        setVersionDetail(vRes.data)

        const files = vRes.data.version.files ?? []
        const skillMdPath = pickSkillMdPath(files)

        try {
          const text = await clawhubApi.getFileText(normalizedSlug, selectedVersion, skillMdPath ?? 'SKILL.md')
          if (cancelled) return
          setSkillMd(text)
        } catch (err) {
          if (cancelled) return
          setSkillMd('')
          setSkillMdError(err instanceof HttpError ? err.message : 'Failed to load SKILL.md')
        }
      } catch {
        if (cancelled) return
        setVersionDetail(null)
      } finally {
        if (!cancelled) setLoadingSkillMd(false)
      }

      try {
        const scanRes = await clawhubApi.scan(normalizedSlug, selectedVersion)
        if (cancelled) return
        setScan(scanRes.data)
      } catch (err) {
        if (cancelled) return
        setScan(null)
        setScanError(err instanceof HttpError ? err.message : 'Local scan unavailable')
      } finally {
        if (!cancelled) setIsScanning(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [normalizedSlug, selectedVersion])

  // Fetch receipt details
  useEffect(() => {
    let cancelled = false
    if (!lastReceiptId) {
      setLastReceipt(null)
      return
    }

    receiptsApi.get(lastReceiptId)
      .then((res) => {
        if (cancelled) return
        setLastReceipt(res.data)
      })
      .catch(() => {
        if (cancelled) return
        setLastReceipt(null)
      })

    return () => {
      cancelled = true
    }
  }, [lastReceiptId])

  const openInstall = useCallback(() => {
    setInstallError(null)
    setInstallApprovalId(null)
    setShowInstallModal(true)
  }, [])

  const openUninstall = useCallback(() => {
    setUninstallError(null)
    setUninstallApprovalId(null)
    setShowUninstallModal(true)
  }, [])

  const handleInstallRequested = useCallback((payload: {
    version: string
    scope: InstallScope
    agentSlugs: string[]
    overwrite: boolean
  }) => {
    setInstallError(null)
    setInstallApprovalId(null)

    const destination = payload.scope === 'global'
      ? `/skills/${normalizedSlug}`
      : payload.agentSlugs.map((s) => `/agents/${s}/skills/${normalizedSlug}`).join(', ')

    const warningSummary = scan?.warnings?.length
      ? `Local scan warnings: ${scan.warnings.length}.`
      : 'Local scan: no warnings.'

    protectedAction.trigger({
      actionKind: 'skill.install',
      actionTitle: 'Install Skill',
      actionDescription: `Install ${normalizedSlug}@${payload.version} (${payload.scope}) to ${destination}. ${warningSummary}`,
      onConfirm: async (typedConfirmText) => {
        setInstalling(true)
        setInstallError(null)
        setInstallApprovalId(null)
        try {
          const res = await clawhubApi.install(normalizedSlug, {
            version: payload.version,
            scope: payload.scope,
            agentSlugs: payload.scope === 'agent' ? payload.agentSlugs : undefined,
            overwrite: payload.overwrite,
            typedConfirmText,
          })
          setLastReceiptId(res.receiptId)
          setShowInstallModal(false)
          await fetchInitial()
        } catch (err) {
          if (err instanceof HttpError) {
            const approvalId = (err.details?.approvalId as string | undefined) ?? null
            const receiptId = (err.details?.receiptId as string | undefined) ?? null
            if (receiptId) setLastReceiptId(receiptId)
            setInstallApprovalId(approvalId)
            setInstallError(err.message)
            return
          }
          setInstallError(err instanceof Error ? err.message : 'Install failed')
        } finally {
          setInstalling(false)
        }
      },
      onError: (err) => setInstallError(err.message),
    })
  }, [normalizedSlug, protectedAction, scan?.warnings, fetchInitial])

  const handleUninstallRequested = useCallback((payload: {
    scope: InstallScope
    agentSlugs: string[]
  }) => {
    setUninstallError(null)
    setUninstallApprovalId(null)

    const destination = payload.scope === 'global'
      ? `/skills/${normalizedSlug}`
      : payload.agentSlugs.map((s) => `/agents/${s}/skills/${normalizedSlug}`).join(', ')

    protectedAction.trigger({
      actionKind: 'skill.uninstall',
      actionTitle: 'Uninstall Skill',
      actionDescription: `Uninstall ${normalizedSlug} (${payload.scope}) from ${destination}.`,
      onConfirm: async (typedConfirmText) => {
        setUninstalling(true)
        setUninstallError(null)
        setUninstallApprovalId(null)
        try {
          const res = await clawhubApi.uninstall(normalizedSlug, {
            scope: payload.scope,
            agentSlugs: payload.scope === 'agent' ? payload.agentSlugs : undefined,
            typedConfirmText,
          })
          setLastReceiptId(res.receiptId)
          setShowUninstallModal(false)
          await fetchInitial()
        } catch (err) {
          if (err instanceof HttpError) {
            const approvalId = (err.details?.approvalId as string | undefined) ?? null
            const receiptId = (err.details?.receiptId as string | undefined) ?? null
            if (receiptId) setLastReceiptId(receiptId)
            setUninstallApprovalId(approvalId)
            setUninstallError(err.message)
            return
          }
          setUninstallError(err instanceof Error ? err.message : 'Uninstall failed')
        } finally {
          setUninstalling(false)
        }
      },
      onError: (err) => setUninstallError(err.message),
    })
  }, [normalizedSlug, protectedAction, fetchInitial])

  const tabs = useMemo(() => ([
    { id: 'files' as const, label: 'Files', icon: FileText },
    { id: 'compare' as const, label: 'Compare', icon: Wrench },
    { id: 'versions' as const, label: 'Versions', icon: Info },
  ]), [])

  if (isLoading) return <LoadingState height="viewport" />

  if (error || !detail) {
    return (
      <div className="max-w-[1000px] space-y-4">
        <Link
          href={{ pathname: '/skills/find' }}
          className="inline-flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Find Skills
        </Link>
        <EmptyState
          icon={<ShieldAlert className="w-8 h-8" />}
          title="Skill not found"
          description={error || 'The requested skill could not be loaded.'}
        />
      </div>
    )
  }

  const stats = detail.skill.stats

  const installedGlobal = detail.installed.global?.version ?? null
  const installedAgentCount = detail.installed.agentCount ?? 0
  const currentVersionLabel = installedGlobal ?? (detail.installed.agents[0]?.version ?? null)

  return (
    <>
      <div className="w-full space-y-4 max-w-[1100px]">
        <PageHeader
          title={detail.skill.displayName}
          subtitle={
            [
              detail.owner?.handle ? `by @${detail.owner.handle}` : 'by —',
              `${formatCount(stats?.downloads)} downloads`,
              `${formatCount(stats?.stars)} stars`,
            ].join(' • ')
          }
          actions={
            <div className="flex items-center gap-2">
              <Link
                href={{ pathname: '/skills/find' }}
                className="text-xs text-fg-2 hover:text-fg-1 underline underline-offset-2"
              >
                Back to Browse
              </Link>
              <a
                href={`https://clawhub.ai/skills/${encodeURIComponent(normalizedSlug)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-fg-2 hover:text-fg-1 underline underline-offset-2 inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on ClawHub
              </a>
              <Button onClick={openInstall} variant="primary" size="md">
                Install
              </Button>
              {detail.installed.any && (
                <Button onClick={openUninstall} variant="secondary" size="md">
                  <Trash2 className="w-3.5 h-3.5" />
                  Uninstall
                </Button>
              )}
            </div>
          }
        />

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="text-sm text-fg-1 leading-relaxed">{detail.skill.summary}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(() => {
                  const Icon = moderationUi.icon
                  return (
                    <span className={cn('inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border', moderationUi.className)}>
                      <Icon className="w-3.5 h-3.5" />
                      {moderationUi.label}
                    </span>
                  )
                })()}
                {detail.latestVersion?.version && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-bd-0 bg-bg-3 text-fg-2">
                    latest v{detail.latestVersion.version}
                  </span>
                )}
                {currentVersionLabel && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-status-info/20 bg-status-info/10 text-status-info">
                    current v{currentVersionLabel}
                  </span>
                )}
              </div>
            </div>

            <div className="shrink-0 text-xs text-fg-2">
              {detail.installed.any ? (
                <div className="space-y-1">
                  <div>
                    Installed: {installedGlobal ? `global v${installedGlobal}` : 'not global'}
                  </div>
                  <div>
                    Agents: {installedAgentCount}
                  </div>
                </div>
              ) : (
                <div>Not installed</div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 p-4 lg:col-span-1">
            <div className="text-sm font-semibold text-fg-0">Security Scan</div>
            <div className="text-xs text-fg-2 mt-1">
              ClawHub UI scan verdicts are not available via the public API. ClawControl runs local checks before installation.
            </div>

            <dl className="mt-3 grid grid-cols-1 gap-2 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-fg-2">VirusTotal</dt>
                <dd className="text-fg-1">Not available</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-fg-2">OpenClaw scan</dt>
                <dd className="text-fg-1">Not available</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-fg-2">Moderation</dt>
                <dd className="text-fg-1">{moderationUi.label}</dd>
              </div>
            </dl>

            <div className="mt-3 border-t border-bd-0 pt-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-fg-1">Local checks (this version)</div>
                {isScanning ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-fg-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    scanning
                  </span>
                ) : null}
              </div>

              {scanError ? (
                <div className="mt-2 text-[11px] text-fg-2">{scanError}</div>
              ) : scan ? (
                <div className="mt-2 space-y-2">
                  <div className="text-[11px] text-fg-2">
                    Files: {scan.stats.fileCount} • Size: {formatBytes(scan.stats.totalBytes)}
                  </div>
                  {scan.warnings.length === 0 ? (
                    <div className="text-[11px] text-status-success">No warnings.</div>
                  ) : (
                    <ul className="space-y-1">
                      {scan.warnings.map((w) => (
                        <li
                          key={`${w.code}:${w.message}`}
                          className={cn(
                            'text-[11px] rounded-[var(--radius-md)] px-2 py-1 border',
                            w.severity === 'danger'
                              ? 'text-status-danger bg-status-danger/10 border-status-danger/20'
                              : w.severity === 'warning'
                                ? 'text-status-warning bg-status-warning/10 border-status-warning/20'
                                : 'text-fg-2 bg-bg-3 border-bd-0'
                          )}
                        >
                          <span className="font-mono">{w.code}</span>
                          {': '}
                          {w.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-fg-2">Not available</div>
              )}
            </div>
          </div>

          <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 p-4 lg:col-span-1">
            <div className="text-sm font-semibold text-fg-0">Version</div>
            <div className="text-xs text-fg-2 mt-1">
              Select a pinned version for installation. Downloads are proxied via localhost.
            </div>

            <div className="mt-3">
              <div className="text-[11px] text-fg-2 mb-1">CURRENT VERSION</div>
              <div className="text-sm font-mono text-fg-0">
                {currentVersionLabel ? `v${currentVersionLabel}` : '—'}
              </div>
            </div>

            <div className="mt-3">
              <div className="text-[11px] text-fg-2 mb-1">Select version</div>
              <SelectDropdown
                value={selectedVersion}
                onChange={(v) => setSelectedVersion(String(v))}
                ariaLabel="Select skill version"
                tone="field"
                size="md"
                options={versionSelectOptions}
                placeholder="Select a version..."
              />
            </div>

            <div className="mt-3 flex items-center justify-between">
              <a
                href={`/api/clawhub/skills/${encodeURIComponent(normalizedSlug)}/download?version=${encodeURIComponent(selectedVersion || detail.latestVersion?.version || '')}`}
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg-1 underline underline-offset-2',
                  !selectedVersion && 'pointer-events-none opacity-50'
                )}
              >
                <Download className="w-3.5 h-3.5" />
                Download zip
              </a>
              {versionsHasMore ? (
                <button
                  type="button"
                  onClick={fetchMoreVersions}
                  className="text-[11px] text-fg-2 hover:text-fg-1 underline underline-offset-2"
                >
                  Load more versions
                </button>
              ) : null}
            </div>
          </div>

          <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 p-4 lg:col-span-1">
            <div className="text-sm font-semibold text-fg-0">Runtime Requirements</div>
            <div className="text-xs text-fg-2 mt-1">
              Best-effort extraction from bundle files and SKILL.md.
            </div>

            <dl className="mt-3 grid grid-cols-1 gap-3 text-xs">
              <div>
                <dt className="text-fg-2 mb-1">Bins</dt>
                <dd className="text-fg-1 font-mono">
                  {runtimeReqs.bins.length > 0 ? runtimeReqs.bins.join(', ') : 'Not available'}
                </dd>
              </div>
              <div>
                <dt className="text-fg-2 mb-1">Env vars</dt>
                <dd className="text-fg-1 font-mono">
                  {runtimeReqs.envVars.length > 0 ? runtimeReqs.envVars.join(', ') : 'Not available'}
                </dd>
              </div>
              <div>
                <dt className="text-fg-2 mb-1">Primary env</dt>
                <dd className="text-fg-1 font-mono">
                  {runtimeReqs.primaryEnv ?? 'Not available'}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {lastReceiptId && (
          <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-fg-0">Latest Receipt</div>
                <div className="text-xs text-fg-2 mt-0.5 font-mono">{lastReceiptId}</div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/work-orders/system"
                  className="text-xs text-fg-2 hover:text-fg-1 underline underline-offset-2"
                >
                  View in System Work Order
                </Link>
              </div>
            </div>
            {lastReceipt ? (
              <div className="mt-3 text-xs text-fg-2">
                <span className="font-mono">{lastReceipt.commandName}</span>
                {' • '}
                {lastReceipt.exitCode === null ? 'running' : lastReceipt.exitCode === 0 ? 'success' : `failed (${lastReceipt.exitCode})`}
                {lastReceipt.durationMs !== null ? ` • ${Math.round(lastReceipt.durationMs)}ms` : ''}
              </div>
            ) : null}
          </div>
        )}

        <PageSection
          title="Bundle"
          description="Inspect files, compare versions, and view SKILL.md."
        >
          <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
            <div className="flex items-center gap-1 px-2 py-2 border-b border-bd-0">
              {tabs.map((t) => {
                const Icon = t.icon
                const isActive = activeTab === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-[var(--radius-md)] text-xs inline-flex items-center gap-1.5 border transition-colors',
                      isActive
                        ? 'bg-status-info/10 text-status-info border-status-info/30'
                        : 'bg-transparent text-fg-2 border-transparent hover:bg-bg-3 hover:text-fg-1'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                )
              })}
            </div>

            {activeTab === 'files' ? (
              <FilesTab
                versionDetail={versionDetail}
                loadingSkillMd={loadingSkillMd}
                skillMd={skillMd}
                skillMdError={skillMdError}
              />
            ) : activeTab === 'compare' ? (
              <CompareTab
                slug={normalizedSlug}
                versions={versions}
                defaultA={selectedVersion}
              />
            ) : (
              <VersionsTab
                versions={versions}
                selectedVersion={selectedVersion}
                onSelect={(v) => {
                  setSelectedVersion(v)
                  setActiveTab('files')
                }}
                hasMore={versionsHasMore}
                onLoadMore={fetchMoreVersions}
              />
            )}
          </div>
        </PageSection>
      </div>

      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        riskLevel={protectedAction.riskLevel}
        workOrderCode={protectedAction.state.workOrderCode}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />

      <InstallSkillModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
        slug={normalizedSlug}
        displayName={detail.skill.displayName}
        versions={versions}
        defaultVersion={selectedVersion || detail.latestVersion?.version || ''}
        agents={agents}
        scan={scan}
        moderation={moderation}
        isSubmitting={installing}
        error={installError}
        approvalId={installApprovalId}
        onInstall={handleInstallRequested}
      />

      <UninstallSkillModal
        isOpen={showUninstallModal}
        onClose={() => setShowUninstallModal(false)}
        slug={normalizedSlug}
        displayName={detail.skill.displayName}
        agents={agents}
        installedAgentSlugs={detail.installed.agents.map((a) => a.agentSlug)}
        isSubmitting={uninstalling}
        error={uninstallError}
        approvalId={uninstallApprovalId}
        onUninstall={handleUninstallRequested}
      />
    </>
  )
}

// ============================================================================
// TABS
// ============================================================================

function FilesTab(props: {
  versionDetail: ClawHubSkillVersionDetail | null
  loadingSkillMd: boolean
  skillMd: string
  skillMdError: string | null
}) {
  const files = props.versionDetail?.version?.files ?? []
  const totalBytes = files.reduce((sum, f) => sum + (typeof f.size === 'number' ? f.size : 0), 0)

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between text-xs text-fg-2">
        <div>{files.length} files</div>
        <div>{formatBytes(totalBytes)}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-bg-1 rounded-[var(--radius-md)] border border-bd-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-bd-0 text-xs font-medium text-fg-1">
            Files
          </div>
          <div className="max-h-[420px] overflow-auto">
            {files.length === 0 ? (
              <div className="px-3 py-3 text-xs text-fg-2">No manifest available.</div>
            ) : (
              <ul className="divide-y divide-bd-0">
                {files.map((f) => (
                  <li key={f.path} className="px-3 py-2 flex items-center justify-between gap-3">
                    <span className="text-[12px] font-mono text-fg-1 truncate">{f.path}</span>
                    <span className="text-[11px] text-fg-3 font-mono shrink-0">{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="bg-bg-1 rounded-[var(--radius-md)] border border-bd-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-bd-0 text-xs font-medium text-fg-1">
            SKILL.md
          </div>
          <div className="max-h-[420px] overflow-auto p-3">
            {props.loadingSkillMd ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner size="md" />
              </div>
            ) : props.skillMdError ? (
              <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2">
                {props.skillMdError}
              </div>
            ) : props.skillMd ? (
              <Markdown content={props.skillMd} />
            ) : (
              <div className="text-xs text-fg-2">Not available</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CompareTab(props: {
  slug: string
  versions: ClawHubVersionsListItem[]
  defaultA: string
}) {
  const [a, setA] = useState<string>(props.defaultA || props.versions[0]?.version || '')
  const [b, setB] = useState<string>(() => {
    const second = props.versions.find((v) => v.version !== (props.defaultA || props.versions[0]?.version))
    return second?.version ?? ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: string[]; removed: string[]; changed: string[] } | null>(null)

  const options = useMemo(
    () => props.versions.map((v) => ({ value: v.version, label: v.version })),
    [props.versions]
  )

  const runCompare = async () => {
    setError(null)
    setResult(null)
    if (!a || !b || a === b) {
      setError('Select two different versions.')
      return
    }

    setLoading(true)
    try {
      const [aRes, bRes] = await Promise.all([
        clawhubApi.getVersion(props.slug, a),
        clawhubApi.getVersion(props.slug, b),
      ])
      const diff = diffFileManifests(
        (aRes.data.version.files ?? []).map((f) => ({ path: f.path, sha256: f.sha256 })),
        (bRes.data.version.files ?? []).map((f) => ({ path: f.path, sha256: f.sha256 }))
      )
      setResult(diff)
    } catch (err) {
      setError(err instanceof HttpError ? err.message : 'Failed to compare versions')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
        <div>
          <div className="text-[11px] text-fg-2 mb-1">Base</div>
          <SelectDropdown
            value={a}
            onChange={(v) => setA(String(v))}
            ariaLabel="Select base version"
            tone="field"
            size="md"
            options={options}
          />
        </div>
        <div>
          <div className="text-[11px] text-fg-2 mb-1">Compare to</div>
          <SelectDropdown
            value={b}
            onChange={(v) => setB(String(v))}
            ariaLabel="Select compare version"
            tone="field"
            size="md"
            options={options}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={runCompare} disabled={loading} variant="secondary" size="md">
            {loading && <LoadingSpinner size="sm" />}
            Compare
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2">
          {error}
        </div>
      )}

      {result ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <DiffList title={`Added (${result.added.length})`} items={result.added} tone="success" />
          <DiffList title={`Removed (${result.removed.length})`} items={result.removed} tone="danger" />
          <DiffList title={`Changed (${result.changed.length})`} items={result.changed} tone="warning" />
        </div>
      ) : (
        <div className="text-xs text-fg-2">Select versions and compare manifests.</div>
      )}
    </div>
  )
}

function DiffList(props: { title: string; items: string[]; tone: 'success' | 'warning' | 'danger' }) {
  const toneClass =
    props.tone === 'success'
      ? 'text-status-success bg-status-success/10 border-status-success/20'
      : props.tone === 'warning'
        ? 'text-status-warning bg-status-warning/10 border-status-warning/20'
        : 'text-status-danger bg-status-danger/10 border-status-danger/20'

  return (
    <div className="bg-bg-1 rounded-[var(--radius-md)] border border-bd-0 overflow-hidden">
      <div className="px-3 py-2 border-b border-bd-0 text-xs font-medium text-fg-1">{props.title}</div>
      <div className="max-h-[360px] overflow-auto">
        {props.items.length === 0 ? (
          <div className="px-3 py-3 text-xs text-fg-2">None</div>
        ) : (
          <ul className="divide-y divide-bd-0">
            {props.items.map((p) => (
              <li key={p} className="px-3 py-2">
                <span className={cn('text-[11px] px-2 py-1 rounded-[var(--radius-md)] border inline-flex font-mono', toneClass)}>
                  {p}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function VersionsTab(props: {
  versions: ClawHubVersionsListItem[]
  selectedVersion: string
  onSelect: (version: string) => void
  hasMore: boolean
  onLoadMore: () => void
}) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-fg-2">{props.versions.length} versions</div>
        {props.hasMore ? (
          <button
            type="button"
            onClick={props.onLoadMore}
            className="text-[11px] text-fg-2 hover:text-fg-1 underline underline-offset-2"
          >
            Load more
          </button>
        ) : null}
      </div>

      <div className="bg-bg-1 rounded-[var(--radius-md)] border border-bd-0 overflow-hidden">
        <ul className="divide-y divide-bd-0">
          {props.versions.map((v) => (
            <li key={v.version} className="px-3 py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-mono text-fg-0">{v.version}</div>
                <div className="text-[11px] text-fg-2 mt-0.5">{formatDate(v.createdAt)}</div>
                {v.changelog ? (
                  <div className="text-xs text-fg-1 mt-1 line-clamp-2">{v.changelog}</div>
                ) : null}
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {props.selectedVersion === v.version ? (
                  <span className="text-[11px] text-status-info bg-status-info/10 border border-status-info/20 px-2 py-1 rounded-full">
                    selected
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => props.onSelect(v.version)}
                    className="text-[11px] text-fg-2 hover:text-fg-1 underline underline-offset-2"
                  >
                    Use
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ============================================================================
// MODALS
// ============================================================================

function InstallSkillModal(props: {
  isOpen: boolean
  onClose: () => void
  slug: string
  displayName: string
  versions: ClawHubVersionsListItem[]
  defaultVersion: string
  agents: AgentDTO[]
  moderation: ClawHubMarketplaceSkillDetail['moderation'] | null
  scan: ClawHubLocalScanResult | null
  isSubmitting: boolean
  error: string | null
  approvalId: string | null
  onInstall: (payload: { version: string; scope: InstallScope; agentSlugs: string[]; overwrite: boolean }) => void
}) {
  const [scope, setScope] = useState<InstallScope>('global')
  const [version, setVersion] = useState<string>(props.defaultVersion)
  const [selectedAgentSlugs, setSelectedAgentSlugs] = useState<string[]>([])
  const [overwrite, setOverwrite] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [scan, setScan] = useState<ClawHubLocalScanResult | null>(props.scan)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanLoading, setScanLoading] = useState(false)

  const agentOptions = useMemo(
    () => props.agents
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((a) => ({ slug: a.slug, label: a.displayName })),
    [props.agents]
  )

  const versionOptions = useMemo(
    () => props.versions.map((v) => ({ value: v.version, label: v.version })),
    [props.versions]
  )

  useEffect(() => {
    if (props.isOpen) {
      setScope('global')
      setVersion(props.defaultVersion)
      setSelectedAgentSlugs([])
      setOverwrite(false)
      setLocalError(null)
      setScan(props.scan)
      setScanError(null)
      setScanLoading(false)
    }
  }, [props.isOpen, props.defaultVersion])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && props.isOpen && !props.isSubmitting) {
        props.onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [props.isOpen, props.isSubmitting, props.onClose])

  useEffect(() => {
    if (!props.isOpen || !version) return
    let cancelled = false
    setScanLoading(true)
    setScanError(null)

    clawhubApi.scan(props.slug, version)
      .then((res) => {
        if (cancelled) return
        setScan(res.data)
      })
      .catch((err) => {
        if (cancelled) return
        setScan(null)
        setScanError(err instanceof HttpError ? err.message : 'Local scan unavailable')
      })
      .finally(() => {
        if (cancelled) return
        setScanLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [props.isOpen, props.slug, version])

  const toggleAgent = (slug: string) => {
    setSelectedAgentSlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug)
      return [...prev, slug]
    })
  }

  const destDirs = scope === 'global'
    ? [`/skills/${props.slug}`]
    : selectedAgentSlugs.map((a) => `/agents/${a}/skills/${props.slug}`)

  const handleInstall = () => {
    setLocalError(null)
    if (!version) {
      setLocalError('Select a version')
      return
    }
    if (scope === 'agent' && selectedAgentSlugs.length === 0) {
      setLocalError('Select at least one agent')
      return
    }
    props.onInstall({
      version,
      scope,
      agentSlugs: scope === 'agent' ? selectedAgentSlugs : [],
      overwrite,
    })
  }

  if (!props.isOpen) return null

  const moderationUi = moderationBadge(props.moderation)
  const ModerationIcon = moderationUi.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!props.isSubmitting ? props.onClose : undefined}
      />

      <div className="relative bg-bg-1 border border-bd-1 rounded-[var(--radius-lg)] shadow-2xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bd-0">
          <div className="min-w-0">
            <h2 className="text-base font-medium text-fg-0 truncate">Install</h2>
            <div className="text-xs text-fg-2 font-mono truncate">{props.slug}</div>
          </div>
          <button
            onClick={props.onClose}
            disabled={props.isSubmitting}
            className="p-1.5 text-fg-2 hover:text-fg-0 hover:bg-bg-3 rounded-[var(--radius-md)] transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-fg-1">{props.displayName}</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-fg-1 mb-1.5">Version</div>
              <SelectDropdown
                value={version}
                onChange={(v) => setVersion(String(v))}
                disabled={props.isSubmitting}
                ariaLabel="Select install version"
                tone="field"
                size="md"
                options={versionOptions}
                placeholder="Select a version..."
              />
            </div>
            <div>
              <div className="text-xs font-medium text-fg-1 mb-1.5">Scope</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScope('global')}
                  disabled={props.isSubmitting}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm rounded-[var(--radius-md)] border transition-colors',
                    scope === 'global'
                      ? 'bg-status-info/10 text-status-info border-status-info/30'
                      : 'bg-bg-2 text-fg-1 border-bd-1 hover:border-bd-1'
                  )}
                >
                  Global
                </button>
                <button
                  type="button"
                  onClick={() => setScope('agent')}
                  disabled={props.isSubmitting}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm rounded-[var(--radius-md)] border transition-colors',
                    scope === 'agent'
                      ? 'bg-status-info/10 text-status-info border-status-info/30'
                      : 'bg-bg-2 text-fg-1 border-bd-1 hover:border-bd-1'
                  )}
                >
                  Agent(s)
                </button>
              </div>
            </div>
          </div>

          {scope === 'agent' ? (
            <div>
              <div className="text-xs font-medium text-fg-1 mb-1.5">Agents</div>
              <div className="max-h-44 overflow-auto bg-bg-2 border border-bd-1 rounded-[var(--radius-md)]">
                {agentOptions.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-fg-2">No agents available.</div>
                ) : (
                  <ul className="divide-y divide-bd-0">
                    {agentOptions.map((a) => (
                      <li key={a.slug} className="px-3 py-2 flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm text-fg-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedAgentSlugs.includes(a.slug)}
                            onChange={() => toggleAgent(a.slug)}
                            disabled={props.isSubmitting}
                            className="accent-status-info"
                          />
                          <span className="truncate">{a.label}</span>
                        </label>
                        <span className="text-[11px] text-fg-3 font-mono">@{a.slug}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs text-fg-2 select-none">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              disabled={props.isSubmitting}
              className="accent-status-warning"
            />
            Overwrite existing install (update)
          </label>

          <div className="bg-bg-2 rounded-[var(--radius-md)] border border-bd-1 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-fg-1">
              <ModerationIcon className="w-4 h-4" />
              Moderation: {moderationUi.label}
            </div>
            <div className="mt-2 text-[11px] text-fg-2">
              Destination: <span className="font-mono">{destDirs.join(', ') || '—'}</span>
            </div>
            <div className="mt-2">
              <div className="text-[11px] text-fg-2">Local scan warnings</div>
              {scanLoading ? (
                <div className="mt-1 text-[11px] text-fg-2 inline-flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  scanning
                </div>
              ) : scanError ? (
                <div className="mt-1 text-[11px] text-fg-2">{scanError}</div>
              ) : scan?.warnings?.length ? (
                <ul className="mt-1 space-y-1">
                  {scan.warnings.map((w) => (
                    <li key={`${w.code}:${w.message}`} className="text-[11px] text-fg-1">
                      <span className="font-mono">{w.code}</span>
                      {': '}
                      {w.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 text-[11px] text-fg-2">None</div>
              )}
            </div>
          </div>

          {(props.error || props.approvalId || localError) ? (
            <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2 space-y-1">
              {localError ? <div>{localError}</div> : null}
              {props.error ? <div>{props.error}</div> : null}
              {props.approvalId ? (
                <div>
                  Approval: <span className="font-mono">{props.approvalId}</span>{' '}
                  <Link href="/approvals" className="underline underline-offset-2">Open approvals</Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              onClick={props.onClose}
              disabled={props.isSubmitting}
              variant="secondary"
              size="md"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleInstall}
              disabled={props.isSubmitting || !version || (scope === 'agent' && selectedAgentSlugs.length === 0)}
              variant="primary"
              size="md"
            >
              {props.isSubmitting && <LoadingSpinner size="sm" />}
              {props.isSubmitting ? 'Installing...' : 'Install'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function UninstallSkillModal(props: {
  isOpen: boolean
  onClose: () => void
  slug: string
  displayName: string
  agents: AgentDTO[]
  installedAgentSlugs: string[]
  isSubmitting: boolean
  error: string | null
  approvalId: string | null
  onUninstall: (payload: { scope: InstallScope; agentSlugs: string[] }) => void
}) {
  const [scope, setScope] = useState<InstallScope>('global')
  const [selectedAgentSlugs, setSelectedAgentSlugs] = useState<string[]>([])
  const [localError, setLocalError] = useState<string | null>(null)

  const agentOptions = useMemo(
    () => props.agents
      .filter((a) => props.installedAgentSlugs.includes(a.slug))
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((a) => ({ slug: a.slug, label: a.displayName })),
    [props.agents, props.installedAgentSlugs]
  )

  useEffect(() => {
    if (props.isOpen) {
      setScope('global')
      setSelectedAgentSlugs([])
      setLocalError(null)
    }
  }, [props.isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && props.isOpen && !props.isSubmitting) {
        props.onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [props.isOpen, props.isSubmitting, props.onClose])

  const toggleAgent = (slug: string) => {
    setSelectedAgentSlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug)
      return [...prev, slug]
    })
  }

  const destDirs = scope === 'global'
    ? [`/skills/${props.slug}`]
    : selectedAgentSlugs.map((a) => `/agents/${a}/skills/${props.slug}`)

  const handleUninstall = () => {
    setLocalError(null)
    if (scope === 'agent' && selectedAgentSlugs.length === 0) {
      setLocalError('Select at least one agent')
      return
    }
    props.onUninstall({ scope, agentSlugs: scope === 'agent' ? selectedAgentSlugs : [] })
  }

  if (!props.isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!props.isSubmitting ? props.onClose : undefined}
      />

      <div className="relative bg-bg-1 border border-bd-1 rounded-[var(--radius-lg)] shadow-2xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bd-0">
          <div className="min-w-0">
            <h2 className="text-base font-medium text-fg-0 truncate">Uninstall</h2>
            <div className="text-xs text-fg-2 font-mono truncate">{props.slug}</div>
          </div>
          <button
            onClick={props.onClose}
            disabled={props.isSubmitting}
            className="p-1.5 text-fg-2 hover:text-fg-0 hover:bg-bg-3 rounded-[var(--radius-md)] transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-fg-1">{props.displayName}</div>

          <div>
            <div className="text-xs font-medium text-fg-1 mb-1.5">Scope</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScope('global')}
                disabled={props.isSubmitting}
                className={cn(
                  'flex-1 px-3 py-2 text-sm rounded-[var(--radius-md)] border transition-colors',
                  scope === 'global'
                    ? 'bg-status-warning/10 text-status-warning border-status-warning/30'
                    : 'bg-bg-2 text-fg-1 border-bd-1 hover:border-bd-1'
                )}
              >
                Global
              </button>
              <button
                type="button"
                onClick={() => setScope('agent')}
                disabled={props.isSubmitting}
                className={cn(
                  'flex-1 px-3 py-2 text-sm rounded-[var(--radius-md)] border transition-colors',
                  scope === 'agent'
                    ? 'bg-status-warning/10 text-status-warning border-status-warning/30'
                    : 'bg-bg-2 text-fg-1 border-bd-1 hover:border-bd-1'
                )}
              >
                Agent(s)
              </button>
            </div>
          </div>

          {scope === 'agent' ? (
            <div>
              <div className="text-xs font-medium text-fg-1 mb-1.5">Agents</div>
              <div className="max-h-44 overflow-auto bg-bg-2 border border-bd-1 rounded-[var(--radius-md)]">
                {agentOptions.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-fg-2">No agent-scoped installs detected.</div>
                ) : (
                  <ul className="divide-y divide-bd-0">
                    {agentOptions.map((a) => (
                      <li key={a.slug} className="px-3 py-2 flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm text-fg-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedAgentSlugs.includes(a.slug)}
                            onChange={() => toggleAgent(a.slug)}
                            disabled={props.isSubmitting}
                            className="accent-status-warning"
                          />
                          <span className="truncate">{a.label}</span>
                        </label>
                        <span className="text-[11px] text-fg-3 font-mono">@{a.slug}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          <div className="bg-bg-2 rounded-[var(--radius-md)] border border-bd-1 p-3 text-[11px] text-fg-2">
            Destination: <span className="font-mono">{destDirs.join(', ') || '—'}</span>
          </div>

          {(props.error || props.approvalId || localError) ? (
            <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2 space-y-1">
              {localError ? <div>{localError}</div> : null}
              {props.error ? <div>{props.error}</div> : null}
              {props.approvalId ? (
                <div>
                  Approval: <span className="font-mono">{props.approvalId}</span>{' '}
                  <Link href="/approvals" className="underline underline-offset-2">Open approvals</Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              onClick={props.onClose}
              disabled={props.isSubmitting}
              variant="secondary"
              size="md"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleUninstall}
              disabled={props.isSubmitting || (scope === 'agent' && selectedAgentSlugs.length === 0)}
              variant="primary"
              size="md"
            >
              {props.isSubmitting && <LoadingSpinner size="sm" />}
              {props.isSubmitting ? 'Uninstalling...' : 'Uninstall'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
