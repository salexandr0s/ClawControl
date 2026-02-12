'use client'

import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageSection, Button } from '@clawcontrol/ui'
import {
  modelsApi,
  openclawModelsApi,
  type ModelListItem,
  type ModelStatusResponse,
  type AuthProfile,
  type AvailableModelProvider,
  type ModelAuthMethod,
  HttpError,
} from '@/lib/http'
import { LoadingState } from '@/components/ui/loading-state'
import { ActionConfirmModal } from '@/components/ui/action-confirm-modal'
import { cn } from '@/lib/utils'
import { usePageReadyTiming } from '@/lib/perf/client-timing'
import { ProviderLogo } from '@/components/provider-logo'
import {
  getAuthAction,
  normalizeProviderAuthStates,
  type NormalizedProviderAuth,
} from './provider-auth-state'
import {
  Cpu,
  Plus,
  RefreshCw,
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
  availableProviders: AvailableModelProvider[]
  error: string | null
}

type NoticeTone = 'success' | 'warning'

type RemovalConfirmState =
  | {
      kind: 'model'
      model: ModelListItem
      descriptor: string
    }
  | {
      kind: 'provider'
      provider: string
      removableCount: number
    }

function hasFallbackTag(model: ModelListItem): boolean {
  return model.tags.some((tag) => tag.startsWith('fallback'))
}

function hasAliasTag(model: ModelListItem): boolean {
  return model.tags.some((tag) => tag.startsWith('alias:'))
}

function canRemoveConfiguredModel(model: ModelListItem): boolean {
  if (model.tags.includes('default')) return false
  return hasFallbackTag(model) || hasAliasTag(model)
}

function removalDescription(model: ModelListItem): string {
  const parts: string[] = []
  if (hasFallbackTag(model)) parts.push('fallback')
  if (hasAliasTag(model)) parts.push('alias')
  return parts.join(' + ')
}

export function ModelsClient() {
  const [state, setState] = useState<ModelsState>({
    isLoading: true,
    isRefreshing: false,
    status: null,
    models: null,
    availableProviders: [],
    error: null,
  })
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalInitialProviderId, setAddModalInitialProviderId] = useState<string | null>(null)
  const [addModalInitialAuthMethod, setAddModalInitialAuthMethod] = useState<ModelAuthMethod | null>(null)
  const [notice, setNotice] = useState<{ message: string; tone: NoticeTone } | null>(null)
  const [removingModelKeys, setRemovingModelKeys] = useState<Set<string>>(new Set())
  const [removingProviders, setRemovingProviders] = useState<Set<string>>(new Set())
  const [removalConfirm, setRemovalConfirm] = useState<RemovalConfirmState | null>(null)
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false)

  const fetchData = useCallback(async (isRefresh = false) => {
    setState((prev) => ({
      ...prev,
      isLoading: !isRefresh,
      isRefreshing: isRefresh,
      error: null,
    }))

    try {
      // Fetch status, configured models, and auth-capable providers in parallel.
      const [statusResult, modelsResult, availableProvidersResult] = await Promise.all([
        modelsApi.getStatus(),
        modelsApi.runAction('list'),
        openclawModelsApi.getAvailable(),
      ])

      setState((prev) => ({
        ...prev,
        isLoading: false,
        isRefreshing: false,
        status: statusResult.data.status,
        models: (modelsResult.data as { count: number; models: ModelListItem[] }).models,
        availableProviders: availableProvidersResult.data.providers ?? [],
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

  const openAddProviderModal = useCallback((providerId?: string, authMethod?: ModelAuthMethod) => {
    setAddModalInitialProviderId(providerId ?? null)
    setAddModalInitialAuthMethod(authMethod ?? null)
    setAddModalOpen(true)
  }, [])

  const closeAddProviderModal = useCallback(() => {
    setAddModalOpen(false)
    setAddModalInitialProviderId(null)
    setAddModalInitialAuthMethod(null)
  }, [])

  const showNotice = useCallback(
    (message: string, tone: NoticeTone = 'success', durationMs = 2500) => {
      setNotice({ message, tone })
      window.setTimeout(() => setNotice(null), durationMs)
    },
    []
  )

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

  const { isLoading, isRefreshing, status, models, availableProviders, error } = state
  usePageReadyTiming('models', !isLoading)

  // Group models by provider
  const modelsByProvider = models?.reduce((acc, model) => {
    const provider = model.key.split('/')[0]
    if (!acc[provider]) acc[provider] = []
    acc[provider].push(model)
    return acc
  }, {} as Record<string, ModelListItem[]>) || {}

  const modelProviders = Object.keys(modelsByProvider)
  const normalizedAuthRows = status
    ? normalizeProviderAuthStates({
      status,
      modelProviders,
      availableProviders,
    })
    : []
  const authByProvider = new Map(normalizedAuthRows.map((providerAuth) => [providerAuth.provider, providerAuth]))
  const authOnlyProviders = normalizedAuthRows
    .map((providerAuth) => providerAuth.provider)
    .filter((provider) => !modelProviders.includes(provider))
  const providersToRender = [...modelProviders, ...authOnlyProviders]

  const getProviderAuthAction = (
    providerAuth: NormalizedProviderAuth,
    allowProactive = true
  ) => getAuthAction(providerAuth.status, providerAuth.supportsOauth, {
    allowProactive,
    hasRemaining: providerAuth.remainingMs !== undefined,
  })

  const handleAuthRemediation = (
    providerAuth: NormalizedProviderAuth,
    allowProactive = true
  ) => {
    const action = getProviderAuthAction(providerAuth, allowProactive)
    if (!action) return
    openAddProviderModal(providerAuth.provider, action.authMethod)
  }

  const handleMissingModelFix = (
    model: ModelListItem,
    provider: string,
    providerAuth?: NormalizedProviderAuth
  ) => {
    if (providerAuth) {
      const authAction = getProviderAuthAction(providerAuth, false)
      if (authAction) {
        handleAuthRemediation(providerAuth, false)
        return
      }
    }

    showNotice(
      `Model ${model.key} is unavailable. Verify provider "${provider}" has this model, then update your default/fallback model key and refresh.`,
      'warning',
      7000
    )
  }

  const handleRemoveModel = useCallback(async (model: ModelListItem, skipConfirm = false) => {
    if (!canRemoveConfiguredModel(model)) {
      showNotice(
        `Model ${model.key} cannot be removed directly. Only fallback/alias entries are removable here.`,
        'warning',
        6000
      )
      return
    }

    if (!skipConfirm) {
      setRemovalConfirm({
        kind: 'model',
        model,
        descriptor: removalDescription(model),
      })
      return
    }

    setRemovingModelKeys((prev) => {
      const next = new Set(prev)
      next.add(model.key)
      return next
    })

    try {
      const result = await openclawModelsApi.removeModel({ modelKey: model.key })
      showNotice(
        `Removed ${result.data.removedActions} reference(s) for ${model.key}.`
      )
      await fetchData(true)
    } catch (err) {
      const message = err instanceof HttpError ? err.message : `Failed to remove ${model.key}`
      showNotice(message, 'warning', 7000)
    } finally {
      setRemovingModelKeys((prev) => {
        const next = new Set(prev)
        next.delete(model.key)
        return next
      })
    }
  }, [fetchData, showNotice])

  const handleClearProviderModels = useCallback(async (
    provider: string,
    removableCount: number,
    skipConfirm = false
  ) => {
    if (removableCount <= 0) {
      showNotice(`No removable configured model entries for provider "${provider}".`, 'warning', 6000)
      return
    }

    if (!skipConfirm) {
      setRemovalConfirm({
        kind: 'provider',
        provider,
        removableCount,
      })
      return
    }

    setRemovingProviders((prev) => {
      const next = new Set(prev)
      next.add(provider)
      return next
    })

    try {
      const result = await openclawModelsApi.removeProviderModels({ provider })
      if (result.data.removedActions === 0) {
        showNotice(
          `No removable entries were found for provider "${provider}".`,
          'warning',
          6000
        )
      } else {
        showNotice(
          `Removed ${result.data.removedModels} model entr${result.data.removedModels === 1 ? 'y' : 'ies'} from "${provider}".`
        )
      }
      await fetchData(true)
    } catch (err) {
      const message = err instanceof HttpError ? err.message : `Failed to clear provider "${provider}"`
      showNotice(message, 'warning', 7000)
    } finally {
      setRemovingProviders((prev) => {
        const next = new Set(prev)
        next.delete(provider)
        return next
      })
    }
  }, [fetchData, showNotice])

  const closeRemovalConfirm = useCallback(() => {
    if (isConfirmingRemoval) return
    setRemovalConfirm(null)
  }, [isConfirmingRemoval])

  const handleConfirmRemoval = useCallback(async () => {
    if (!removalConfirm) return

    setIsConfirmingRemoval(true)
    try {
      if (removalConfirm.kind === 'model') {
        await handleRemoveModel(removalConfirm.model, true)
      } else {
        await handleClearProviderModels(
          removalConfirm.provider,
          removalConfirm.removableCount,
          true
        )
      }
      setRemovalConfirm(null)
    } finally {
      setIsConfirmingRemoval(false)
    }
  }, [removalConfirm, handleRemoveModel, handleClearProviderModels])

  const removalConfirmTitle = removalConfirm
    ? (removalConfirm.kind === 'model' ? 'Remove Model Reference' : 'Clear Provider Models')
    : ''
  const removalConfirmDescription = removalConfirm
    ? (removalConfirm.kind === 'model'
      ? `Remove "${removalConfirm.model.key}" from configured ${removalConfirm.descriptor} entries?`
      : `Clear ${removalConfirm.removableCount} removable model entr${
        removalConfirm.removableCount === 1 ? 'y' : 'ies'
      } for provider "${removalConfirm.provider}"?`)
    : ''
  const removalConfirmActionLabel = removalConfirm
    ? (removalConfirm.kind === 'model' ? 'Remove Model' : 'Clear Provider Models')
    : 'Confirm'

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Models"
        subtitle="View and manage AI model configuration"
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => openAddProviderModal()}
              variant="primary"
              size="md"
            >
              <Plus className="w-4 h-4" />
              Add Model
            </Button>

            <Button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              variant="secondary"
              size="md"
            >
              <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Notice Banner */}
      {notice && (
        <div className={cn(
          'p-3 rounded-md flex items-center gap-2',
          notice.tone === 'warning' ? 'bg-status-warning/10' : 'bg-status-success/10'
        )}>
          {notice.tone === 'warning' ? (
            <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
          ) : (
            <CheckCircle className="w-4 h-4 text-status-success shrink-0" />
          )}
          <span className={cn(
            'text-sm',
            notice.tone === 'warning' ? 'text-status-warning' : 'text-status-success'
          )}>
            {notice.message}
          </span>
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
        <div className="p-8 bg-bg-2 rounded-[var(--radius-lg)]">
          <LoadingState
            height="auto"
            size="3xl"
            spinnerClassName="text-status-info"
            label="Loading models..."
            description="Fetching model configuration and auth status"
          />
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
          <PageSection
            title="Provider Authentication"
            description="Credential health per provider. Fix missing/expired providers directly from this section."
          >
            <div className="space-y-2">
              {normalizedAuthRows.map((providerAuth) => (
                <ProviderAuthCard
                  key={providerAuth.provider}
                  providerAuth={providerAuth}
                  onAuthenticate={handleAuthRemediation}
                />
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
          <PageSection
            title="Configured Models"
            description="Model inventory grouped by provider. Model presence and auth status are related but tracked independently."
          >
            <div className="space-y-2">
              {providersToRender.map((provider) => {
                const providerModels = modelsByProvider[provider] ?? []
                const providerAuth = authByProvider.get(provider)
                const isExpanded = expandedProviders.has(provider)
                const removableProviderModels = providerModels.filter(canRemoveConfiguredModel)
                const removableProviderModelCount = removableProviderModels.length
                const isProviderRemoving = removingProviders.has(provider)

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
                      <ProviderLogo provider={provider} size="sm" />
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
                        {removableProviderModelCount > 0 && (
                          <div className="px-4 py-2 border-b border-bg-3 flex justify-end">
                            <Button
                              type="button"
                              size="xs"
                              variant="danger"
                              disabled={isProviderRemoving}
                              onClick={() => handleClearProviderModels(provider, removableProviderModelCount)}
                            >
                              {isProviderRemoving
                                ? 'Removing...'
                                : `Clear Provider Models (${removableProviderModelCount})`}
                            </Button>
                          </div>
                        )}
                        {providerModels.length > 0 ? (
                          providerModels.map((model, idx) => (
                            <ModelRow
                              key={model.key}
                              model={model}
                              provider={provider}
                              providerAuth={providerAuth}
                              isLast={idx === providerModels.length - 1}
                              onFixMissing={handleMissingModelFix}
                              onRemoveModel={handleRemoveModel}
                              isRemoving={removingModelKeys.has(model.key)}
                            />
                          ))
                        ) : (
                          <div className="px-4 py-3 text-xs text-fg-3">
                            No models configured for this provider.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {providersToRender.length === 0 && (
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
        onClose={closeAddProviderModal}
        initialProviderId={addModalInitialProviderId}
        initialAuthMethod={addModalInitialAuthMethod}
        onAdded={async () => {
          showNotice('Provider authentication updated')
          await fetchData(true)
        }}
      />

      <ActionConfirmModal
        open={removalConfirm !== null}
        onClose={closeRemovalConfirm}
        onConfirm={handleConfirmRemoval}
        title={removalConfirmTitle}
        description={removalConfirmDescription}
        confirmLabel={isConfirmingRemoval ? 'Removing...' : removalConfirmActionLabel}
        isLoading={isConfirmingRemoval}
        intent="warning"
        notice="This updates OpenClaw model configuration immediately."
        showCloseButton={!isConfirmingRemoval}
      />
    </div>
  )
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function ProviderAuthCard({
  providerAuth,
  onAuthenticate,
}: {
  providerAuth: NormalizedProviderAuth
  onAuthenticate: (providerAuth: NormalizedProviderAuth) => void
}) {
  const { provider, status, profiles, remainingMs, hasConfiguredAuth, supportsOauth } = providerAuth
  const authAction = getAuthAction(status, supportsOauth, {
    allowProactive: true,
    hasRemaining: remainingMs !== undefined,
  })

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
          <ProviderLogo provider={provider} size="sm" />
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
        {status === 'expired' && (
          <p className="text-xs text-fg-2 mt-1">Authentication exists but has expired.</p>
        )}
        {status === 'ok' && profiles.length === 0 && hasConfiguredAuth && (
          <p className="text-xs text-fg-2 mt-1">Authenticated via configured provider source.</p>
        )}
      </div>
      <div className="shrink-0">
        {remainingMs && status !== 'missing' && (
          <div className="flex items-center justify-end gap-1 text-xs text-status-success">
            <Clock className="w-3 h-3" />
            <span>{formatTimeRemaining(remainingMs)}</span>
          </div>
        )}
        {authAction && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onAuthenticate(providerAuth)}
            className="mt-2"
          >
            {authAction.label}
          </Button>
        )}
      </div>
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

function ModelRow({
  model,
  provider,
  providerAuth,
  isLast,
  onFixMissing,
  onRemoveModel,
  isRemoving,
}: {
  model: ModelListItem
  provider: string
  providerAuth?: NormalizedProviderAuth
  isLast: boolean
  onFixMissing: (model: ModelListItem, provider: string, providerAuth?: NormalizedProviderAuth) => void
  onRemoveModel: (model: ModelListItem) => void
  isRemoving: boolean
}) {
  const isDefault = model.tags.includes('default')
  const isFallback = model.tags.some((t) => t.startsWith('fallback'))
  const alias = model.tags.find((t) => t.startsWith('alias:'))?.replace('alias:', '')
  const missingModelAuthAction = providerAuth
    ? getAuthAction(providerAuth.status, providerAuth.supportsOauth)
    : null
  const canRemoveModel = canRemoveConfiguredModel(model)

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
        {model.missing && (
          <div className="text-xs text-status-warning mt-1">
            Configured model is unavailable for this provider.
          </div>
        )}
      </div>

      {/* Model attributes */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-4 text-xs text-fg-2">
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
        {model.missing && (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => onFixMissing(model, provider, providerAuth)}
          >
            {missingModelAuthAction?.label ?? 'How to fix'}
          </Button>
        )}
        {canRemoveModel && (
          <Button
            type="button"
            size="xs"
            variant="danger"
            disabled={isRemoving}
            onClick={() => onRemoveModel(model)}
          >
            {isRemoving ? 'Removing...' : 'Remove'}
          </Button>
        )}
      </div>
    </div>
  )
}
