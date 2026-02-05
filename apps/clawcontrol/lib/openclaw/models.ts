import { runCommandJson, runDynamicCommand } from '@clawcontrol/adapters-openclaw'
import { OPENCLAW_TIMEOUT_MS } from '@/lib/openclaw/availability'

export type ModelAuthMethod = 'apiKey' | 'oauth'

export interface AvailableModelProvider {
  id: string
  label: string
  supported: boolean
  authStatus: 'ok' | 'expiring' | 'expired' | 'missing'
  auth: {
    apiKey: boolean
    oauth: boolean
    oauthRequiresTty: boolean
  }
}

type ModelListAllResponse = {
  count: number
  models: Array<{ key: string }>
}

type ModelsStatusResponse = {
  auth?: {
    providers?: Array<{
      provider: string
      profiles?: { count?: number }
      env?: { value?: string }
    }>
    oauth?: {
      providers?: Array<{
        provider: string
        status: 'ok' | 'expiring' | 'expired' | 'missing'
      }>
    }
  }
}

const KNOWN_PROVIDERS: Array<{ id: string; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
  { id: 'xai', label: 'xAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'groq', label: 'Groq' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'together', label: 'Together' },
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'azure-openai', label: 'Azure OpenAI' },
  { id: 'amazon-bedrock', label: 'Amazon Bedrock' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'lmstudio', label: 'LM Studio' },
]

function titleCaseProvider(id: string): string {
  return id
    .split(/[-_]/g)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ')
}

export async function getAvailableModelProviders(): Promise<AvailableModelProvider[]> {
  const [listAll, status] = await Promise.all([
    runCommandJson<ModelListAllResponse>('models.list.all.json', { timeout: OPENCLAW_TIMEOUT_MS }),
    runCommandJson<ModelsStatusResponse>('models.status.json', { timeout: OPENCLAW_TIMEOUT_MS }),
  ])

  const discovered = new Set<string>()
  if (listAll.data?.models) {
    for (const m of listAll.data.models) {
      const provider = m.key.split('/')[0]
      if (provider) discovered.add(provider)
    }
  }

  const configuredProviders = new Set<string>()
  for (const p of status.data?.auth?.providers ?? []) {
    const profilesCount = p.profiles?.count ?? 0
    const envValue = typeof p.env?.value === 'string' ? p.env.value : ''
    if (profilesCount > 0 || envValue.length > 0) {
      configuredProviders.add(p.provider)
    }
  }

  const oauthStatusByProvider = new Map<string, AvailableModelProvider['authStatus']>()
  for (const p of status.data?.auth?.oauth?.providers ?? []) {
    oauthStatusByProvider.set(p.provider, p.status)
  }
  const oauthSupported = new Set<string>(oauthStatusByProvider.keys())

  function computeAuthStatus(providerId: string): AvailableModelProvider['authStatus'] {
    const oauthStatus = oauthStatusByProvider.get(providerId)
    if (oauthStatus && oauthStatus !== 'missing') return oauthStatus
    return configuredProviders.has(providerId) ? 'ok' : 'missing'
  }

  const known = KNOWN_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    supported: discovered.has(p.id),
    authStatus: computeAuthStatus(p.id),
    auth: {
      apiKey: true,
      oauth: oauthSupported.has(p.id),
      oauthRequiresTty: true,
    },
  }))

  // Include a small "other" list for newly-added providers (avoid huge grids).
  const knownIds = new Set(KNOWN_PROVIDERS.map((p) => p.id))
  const others = Array.from(discovered)
    .filter((id) => !knownIds.has(id))
    .sort()
    .slice(0, 24)
    .map((id) => ({
      id,
      label: titleCaseProvider(id),
      supported: true,
      authStatus: computeAuthStatus(id),
      auth: {
        apiKey: true,
        oauth: oauthSupported.has(id),
        oauthRequiresTty: true,
      },
    }))

  return [...known, ...others]
}

export async function addModelProviderApiKeyAuth(options: {
  provider: string
  apiKey: string
  profileId?: string
  expiresIn?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = options.provider.trim()
  const apiKey = options.apiKey.trim()
  const profileId = (options.profileId ?? `${provider}:manual`).trim()

  if (!provider) return { ok: false, error: 'Provider is required' }
  if (!apiKey) return { ok: false, error: 'API key is required' }

  const res = await runDynamicCommand(
    'models.auth.paste-token',
    {
      provider,
      'profile-id': profileId,
      ...(options.expiresIn ? { 'expires-in': options.expiresIn } : {}),
    },
    { timeout: OPENCLAW_TIMEOUT_MS, stdin: apiKey }
  )

  if (res.exitCode !== 0) {
    return { ok: false, error: 'Failed to add API key' }
  }

  return { ok: true }
}
