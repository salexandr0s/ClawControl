'use client'

import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageSection } from '@clawcontrol/ui'
import {
  modelsApi,
  type ModelListItem,
  type ModelStatusResponse,
  type AuthProfile,
  type ProviderAuth,
  HttpError,
} from '@/lib/http'
import { cn } from '@/lib/utils'
import {
  Cpu,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Key,
  Shield,
  ChevronDown,
  ChevronRight,
  Globe,
  HardDrive,
  Eye,
} from 'lucide-react'
import { AddModelModal } from './components/add-model-modal'

type ModelsState = {
  isLoading: boolean
  isRefreshing: boolean
  status: ModelStatusResponse | null
  models: ModelListItem[] | null
  error: string | null
}

export function ModelsClient() {
  const [state, setState] = useState<ModelsState>({
    isLoading: true,
    isRefreshing: false,
    status: null,
    models: null,
    error: null,
  })
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const fetchData = useCallback(async (isRefresh = false) => {
    setState((prev) => ({
      ...prev,
      isLoading: !isRefresh,
      isRefreshing: isRefresh,
      error: null,
    }))

    try {
      // Fetch status and models list in parallel
      const [statusResult, modelsResult] = await Promise.all([
        modelsApi.getStatus(),
        modelsApi.runAction('list'),
      ])

      setState((prev) => ({
        ...prev,
        isLoading: false,
        isRefreshing: false,
        status: statusResult.data.status,
        models: (modelsResult.data as { count: number; models: ModelListItem[] }).models,
      }))
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Failed to fetch models'
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isRefreshing: false,
        error: message,
      }))
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const toggleProvider = (provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) {
        next.delete(provider)
      } else {
        next.add(provider)
      }
      return next
    })
  }

  const { isLoading, isRefreshing, status, models, error } = state

  // Group models by provider
  const modelsByProvider = models?.reduce((acc, model) => {
    const provider = model.key.split('/')[0]
    if (!acc[provider]) acc[provider] = []
    acc[provider].push(model)
    return acc
  }, {} as Record<string, ModelListItem[]>) || {}

  // Get provider auth status
  const getProviderAuth = (provider: string): ProviderAuth | undefined => {
    return status?.auth.oauth.providers.find((p) => p.provider === provider)
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Models"
        subtitle="View and manage AI model configuration"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddModalOpen(true)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-colors',
                'bg-status-info text-bg-0 hover:bg-status-info/90'
              )}
            >
              <Plus className="w-4 h-4" />
              Add Model
            </button>

            <button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-colors',
                'bg-bg-3 text-fg-0 hover:bg-bg-2',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        }
      />

      {/* Notice Banner */}
      {notice && (
        <div className="p-3 rounded-md flex items-center gap-2 bg-status-success/10">
          <CheckCircle className="w-4 h-4 text-status-success shrink-0" />
          <span className="text-sm text-status-success">{notice}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-3 rounded-md flex items-center gap-2 bg-status-error/10">
          <XCircle className="w-4 h-4 text-status-error shrink-0" />
          <span className="text-sm text-status-error">{error}</span>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="p-8 text-center bg-bg-2 rounded-[var(--radius-lg)]">
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-status-info animate-spin" />
          <h3 className="text-lg font-medium text-fg-0 mb-2">Loading Models...</h3>
          <p className="text-sm text-fg-2">Fetching model configuration and auth status</p>
        </div>
      )}

      {/* Content */}
      {!isLoading && status && (
        <>
          {/* Configuration Overview - Horizontal inline layout */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-fg-3">Default:</span>
              <span className="font-mono text-fg-0">{status.defaultModel}</span>
            </div>
            {status.fallbacks.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-fg-3">Fallbacks:</span>
                <span className="font-mono text-fg-2">{status.fallbacks.join(', ')}</span>
              </div>
            )}
            {status.imageModel && (
              <div className="flex items-center gap-2">
                <span className="text-fg-3">Image:</span>
                <span className="font-mono text-fg-2">{status.imageModel}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-fg-3">Allowed:</span>
              <span className="text-fg-2">{status.allowed.length} models</span>
            </div>
          </div>

          {/* Auth Status */}
          <PageSection title="Authentication Status" description="Provider authentication and OAuth status">
            <div className="space-y-2">
              {status.auth.oauth.providers.map((providerAuth) => (
                <ProviderAuthCard key={providerAuth.provider} providerAuth={providerAuth} />
              ))}
              {status.auth.missingProvidersInUse.length > 0 && (
                <div className="p-3 rounded-[var(--radius-md)] bg-status-warning/10 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-status-warning shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-status-warning">Missing Providers</div>
                    <div className="text-xs text-fg-2">
                      {status.auth.missingProvidersInUse.join(', ')} - referenced in config but not authenticated
                    </div>
                  </div>
                </div>
              )}
            </div>
          </PageSection>

          {/* Models by Provider */}
          <PageSection title="Models" description="Available models organized by provider">
            <div className="space-y-2">
              {Object.entries(modelsByProvider).map(([provider, providerModels]) => {
                const providerAuth = getProviderAuth(provider)
                const isExpanded = expandedProviders.has(provider)

                return (
                  <div key={provider} className="bg-bg-3 rounded-[var(--radius-md)] overflow-hidden">
                    {/* Provider Header */}
                    <button
                      onClick={() => toggleProvider(provider)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-2 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-fg-3" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-fg-3" />
                      )}
                      <span className="font-medium text-fg-0">{provider}</span>
                      <span className="text-xs text-fg-3">
                        {providerModels.length} model{providerModels.length !== 1 ? 's' : ''}
                      </span>
                      {providerAuth && (
                        <AuthStatusBadge status={providerAuth.status} />
                      )}
                    </button>

                    {/* Models List */}
                    {isExpanded && (
                      <div className="bg-bg-2/50">
                        {providerModels.map((model, idx) => (
                          <ModelRow key={model.key} model={model} isLast={idx === providerModels.length - 1} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {Object.keys(modelsByProvider).length === 0 && (
                <div className="p-6 text-center text-fg-2">
                  <Cpu className="w-12 h-12 mx-auto mb-2 text-fg-3" />
                  <p>No models configured</p>
                </div>
              )}
            </div>
          </PageSection>

          {/* Aliases */}
          {Object.keys(status.aliases).length > 0 && (
            <PageSection title="Aliases" description="Shorthand names for models">
              <div className="flex flex-wrap gap-4">
                {Object.entries(status.aliases).map(([alias, target]) => (
                  <div key={alias} className="flex items-center gap-2 text-sm bg-bg-3 px-3 py-2 rounded-[var(--radius-md)]">
                    <span className="font-mono text-status-info">{alias}</span>
                    <span className="text-fg-3">→</span>
                    <span className="font-mono text-fg-2">{target}</span>
                  </div>
                ))}
              </div>
            </PageSection>
          )}
        </>
      )}

      <AddModelModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAdded={async () => {
          setNotice('Provider added')
          setTimeout(() => setNotice(null), 2500)
          await fetchData(true)
        }}
      />
    </div>
  )
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function ProviderAuthCard({ providerAuth }: { providerAuth: ProviderAuth }) {
  const { provider, status, profiles, remainingMs } = providerAuth

  const statusColors = {
    ok: 'bg-status-success/10',
    expiring: 'bg-status-warning/10',
    expired: 'bg-status-error/10',
    missing: 'bg-bg-3',
  }

  const statusIconColors = {
    ok: 'text-status-success',
    expiring: 'text-status-warning',
    expired: 'text-status-error',
    missing: 'text-fg-3',
  }

  const statusIcons = {
    ok: CheckCircle,
    expiring: AlertTriangle,
    expired: XCircle,
    missing: Key,
  }

  const StatusIcon = statusIcons[status]

  const formatTimeRemaining = (ms: number) => {
    const days = Math.floor(ms / (1000 * 60 * 60 * 24))
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    if (days > 0) return `${days}d ${hours}h remaining`
    if (hours > 0) return `${hours}h remaining`
    return 'Expires soon'
  }

  return (
    <div className={cn(
      'px-4 py-3 rounded-[var(--radius-md)] flex items-center gap-4',
      statusColors[status]
    )}>
      <StatusIcon className={cn('w-5 h-5 shrink-0', statusIconColors[status])} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg-0">{provider}</span>
          <AuthStatusBadge status={status} />
        </div>
        {profiles.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
            {profiles.map((profile) => (
              <ProfileRow key={profile.profileId} profile={profile} />
            ))}
          </div>
        )}
        {status === 'missing' && (
          <p className="text-xs text-fg-3 mt-1">No authentication configured for this provider</p>
        )}
      </div>
      {remainingMs && status !== 'missing' && (
        <div className="flex items-center gap-1 text-xs text-status-success shrink-0">
          <Clock className="w-3 h-3" />
          <span>{formatTimeRemaining(remainingMs)}</span>
        </div>
      )}
    </div>
  )
}

function ProfileRow({ profile }: { profile: AuthProfile }) {
  const typeIcons = {
    oauth: Shield,
    token: Key,
    apiKey: Key,
  }
  const TypeIcon = typeIcons[profile.type]

  return (
    <div className="flex items-center gap-1.5 text-xs text-fg-2">
      <TypeIcon className="w-3 h-3 text-fg-3" />
      <span className="font-mono">{profile.label}</span>
      <span className="text-fg-3">({profile.type})</span>
    </div>
  )
}

function AuthStatusBadge({ status }: { status: 'ok' | 'expiring' | 'expired' | 'missing' }) {
  const colors = {
    ok: 'bg-status-success/20 text-status-success',
    expiring: 'bg-status-warning/20 text-status-warning',
    expired: 'bg-status-error/20 text-status-error',
    missing: 'bg-bg-2 text-fg-3',
  }

  const labels = {
    ok: 'Active',
    expiring: 'Expiring',
    expired: 'Expired',
    missing: 'Missing',
  }

  return (
    <span className={cn(
      'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase',
      colors[status]
    )}>
      {labels[status]}
    </span>
  )
}

function ModelRow({ model, isLast }: { model: ModelListItem; isLast: boolean }) {
  const isDefault = model.tags.includes('default')
  const isFallback = model.tags.some((t) => t.startsWith('fallback'))
  const alias = model.tags.find((t) => t.startsWith('alias:'))?.replace('alias:', '')

  return (
    <div className={cn(
      'flex items-center gap-4 px-4 py-3 hover:bg-bg-2 transition-colors',
      !isLast && 'border-b border-bg-3'
    )}>
      {/* Status indicator */}
      <div className="shrink-0">
        {model.available ? (
          <CheckCircle className="w-4 h-4 text-status-success" />
        ) : model.missing ? (
          <XCircle className="w-4 h-4 text-status-error" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-status-warning" />
        )}
      </div>

      {/* Model info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-fg-0">{model.name}</span>
          {isDefault && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-status-info/20 text-status-info">
              DEFAULT
            </span>
          )}
          {isFallback && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-status-progress/20 text-status-progress">
              FALLBACK
            </span>
          )}
          {alias && (
            <span className="text-xs text-fg-3">alias: {alias}</span>
          )}
        </div>
        <div className="text-xs text-fg-3 font-mono mt-0.5">{model.key}</div>
      </div>

      {/* Model attributes */}
      <div className="flex items-center gap-4 text-xs text-fg-2 shrink-0">
        {model.input && model.input !== '-' && (
          <div className="flex items-center gap-1" title="Input type">
            {model.input.includes('image') ? (
              <Eye className="w-3 h-3" />
            ) : (
              <Cpu className="w-3 h-3" />
            )}
            <span>{model.input}</span>
          </div>
        )}
        {model.contextWindow && (
          <div className="flex items-center gap-1" title="Context window">
            <span>{(model.contextWindow / 1000).toFixed(0)}k ctx</span>
          </div>
        )}
        {model.local !== null && (
          <div title={model.local ? 'Local model' : 'Cloud model'}>
            {model.local ? (
              <HardDrive className="w-3 h-3" />
            ) : (
              <Globe className="w-3 h-3" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
