'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import {
  openclawModelsApi,
  type AvailableModelProvider,
  type ModelAuthMethod,
  HttpError,
} from '@/lib/http'
import { cn } from '@/lib/utils'
import { ArrowLeft, KeyRound, Loader2, Terminal } from 'lucide-react'
import { ProviderCard } from './provider-card'

type Step = 'provider' | 'auth'

export function AddModelModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded: () => void | Promise<void>
}) {
  const [step, setStep] = useState<Step>('provider')
  const [providers, setProviders] = useState<AvailableModelProvider[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)

  const [authMethod, setAuthMethod] = useState<ModelAuthMethod>('apiKey')
  const [apiKey, setApiKey] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  )

  useEffect(() => {
    if (!open) return

    setStep('provider')
    setSelectedProviderId(null)
    setAuthMethod('apiKey')
    setApiKey('')
    setError(null)

    let cancelled = false

    async function load() {
      setIsLoadingProviders(true)
      try {
        const res = await openclawModelsApi.getAvailable()
        if (cancelled) return
        setProviders(res.data.providers ?? [])
      } catch (err) {
        if (cancelled) return
        setProviders([])
        setError(err instanceof HttpError ? err.message : 'Failed to load providers')
      } finally {
        if (!cancelled) setIsLoadingProviders(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [open])

  const supportedProviders = useMemo(
    () => providers.filter((p) => p.supported),
    [providers]
  )

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId)
    setStep('auth')
    setAuthMethod('apiKey')
    setApiKey('')
    setError(null)
  }

  const handleBack = () => {
    setStep('provider')
    setAuthMethod('apiKey')
    setApiKey('')
    setError(null)
  }

  const oauthCommand =
    selectedProvider ? `openclaw models auth login --provider ${selectedProvider.id}` : ''

  const handleCopyOauthCommand = async () => {
    if (!oauthCommand) return
    try {
      await navigator.clipboard.writeText(oauthCommand)
    } catch {
      // Ignore clipboard failures; user can copy manually.
    }
  }

  const handleSubmitApiKey = async () => {
    if (!selectedProvider) return
    if (!apiKey.trim()) {
      setError('API key is required')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await openclawModelsApi.add({
        provider: selectedProvider.id,
        authMethod: 'apiKey',
        apiKey: apiKey.trim(),
      })
      await onAdded()
      onClose()
    } catch (err) {
      setError(err instanceof HttpError ? err.message : 'Failed to add model provider')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === 'provider' ? 'Add Model Provider' : selectedProvider?.label ?? 'Add Model Provider'}
      description={
        step === 'provider'
          ? 'Choose a provider to authenticate'
          : selectedProvider
            ? `Authenticate ${selectedProvider.label}`
            : undefined
      }
      width="lg"
    >
      {error && (
        <div className="mb-4 p-3 bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] text-status-danger text-sm">
          {error}
        </div>
      )}

      {step === 'provider' && (
        <>
          {isLoadingProviders ? (
            <div className="flex items-center gap-2 text-fg-3 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading providers...</span>
            </div>
          ) : supportedProviders.length === 0 ? (
            <div className="text-sm text-fg-2">
              No providers discovered. Make sure OpenClaw is installed and `openclaw models list --all --json` works.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {supportedProviders.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  selected={false}
                  onClick={() => handleSelectProvider(p.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {step === 'auth' && selectedProvider && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBack}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-bd-0 bg-bg-3 hover:bg-bg-2 text-fg-1 hover:text-fg-0 disabled:opacity-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAuthMethod('apiKey')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                authMethod === 'apiKey'
                  ? 'bg-status-info/10 text-status-info border-status-info/30'
                  : 'bg-bg-3 text-fg-1 border-bd-0 hover:bg-bg-2 hover:text-fg-0'
              )}
            >
              API Key
            </button>
            {selectedProvider.auth.oauth && (
              <button
                type="button"
                onClick={() => setAuthMethod('oauth')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                  authMethod === 'oauth'
                    ? 'bg-status-info/10 text-status-info border-status-info/30'
                    : 'bg-bg-3 text-fg-1 border-bd-0 hover:bg-bg-2 hover:text-fg-0'
                )}
              >
                OAuth
              </button>
            )}
          </div>

          {authMethod === 'apiKey' && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-fg-2">
                API Key
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-3" />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your API key"
                    disabled={isSubmitting}
                    className="w-full pl-10 pr-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSubmitApiKey}
                  disabled={isSubmitting || !apiKey.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-[var(--radius-md)] bg-status-info text-bg-0 hover:bg-status-info/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add
                </button>
              </div>
              <p className="text-xs text-fg-3">
                The key is written via OpenClaw&apos;s `models auth paste-token` and never stored by the UI.
              </p>
            </div>
          )}

          {authMethod === 'oauth' && (
            <div className="space-y-3">
              <div className="p-3 bg-bg-2 rounded-[var(--radius-md)] border border-bd-0">
                <div className="flex items-start gap-2">
                  <Terminal className="w-4 h-4 text-fg-3 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm text-fg-1">
                      OAuth login requires an interactive terminal.
                    </div>
                    <div className="text-xs text-fg-3 mt-1 font-mono break-all">
                      {oauthCommand}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end mt-3">
                  <button
                    type="button"
                    onClick={handleCopyOauthCommand}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-bd-0 bg-bg-3 hover:bg-bg-2 text-fg-1 hover:text-fg-0"
                  >
                    Copy command
                  </button>
                </div>
              </div>
              <p className="text-xs text-fg-3">
                After completing OAuth, return here and click Refresh.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

