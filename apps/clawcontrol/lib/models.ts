/**
 * AI Model Constants
 *
 * Available models for agent configuration.
 * Uses OpenClaw format: provider/model-id
 */

export const AVAILABLE_MODELS = [
  {
    id: 'anthropic/claude-opus-4-5',
    name: 'Opus 4.5',
    shortName: 'Opus 4.5',
    description: 'Most capable, complex tasks',
    color: 'progress',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Sonnet 4.5',
    shortName: 'Sonnet 4.5',
    description: 'Fast, balanced performance',
    color: 'info',
  },
  {
    id: 'anthropic/claude-3-5-haiku-20241022',
    name: 'Haiku 3.5',
    shortName: 'Haiku 3.5',
    description: 'Fastest, most efficient',
    color: 'success',
  },
  {
    id: 'openai-codex/gpt-5.2',
    name: 'Codex GPT-5.2',
    shortName: 'Codex 5.2',
    description: 'Code-focused (ChatGPT Plus)',
    color: 'default',
  },
  {
    id: 'openai/gpt-5.2',
    name: 'GPT-5.2',
    shortName: 'GPT-5.2',
    description: 'OpenAI API',
    color: 'default',
  },
] as const

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id']
export type ModelColor = (typeof AVAILABLE_MODELS)[number]['color']

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5'

/**
 * Infer provider id from either canonical ("provider/model") or legacy model ids.
 */
export function inferModelProvider(id: string | null | undefined): string {
  if (!id) return 'unknown'

  const trimmed = id.trim()
  if (!trimmed) return 'unknown'

  const slashIndex = trimmed.indexOf('/')
  if (slashIndex > 0) {
    return trimmed.slice(0, slashIndex).toLowerCase()
  }

  const normalized = trimmed.toLowerCase()
  if (
    normalized.startsWith('claude')
    || normalized.includes('sonnet')
    || normalized.includes('opus')
    || normalized.includes('haiku')
  ) {
    return 'anthropic'
  }
  if (normalized.includes('codex')) return 'openai-codex'
  if (normalized.startsWith('gpt-') || normalized.startsWith('gpt')) return 'openai'
  if (normalized.includes('gemini')) return 'google-gemini'
  if (normalized.startsWith('xai') || normalized.startsWith('grok')) return 'xai'

  return 'unknown'
}

/**
 * Get model info by ID
 */
export function getModelById(id: string | null | undefined): (typeof AVAILABLE_MODELS)[number] | undefined {
  if (!id) return undefined
  return AVAILABLE_MODELS.find((m) => m.id === id)
}

/**
 * Get display name for a model ID
 */
export function getModelDisplayName(id: string | null | undefined): string {
  const model = getModelById(id)
  if (model) return model.name
  // Try to parse unknown model IDs
  if (id) {
    const parts = id.split('/')
    return parts.length > 1 ? parts[1] : id
  }
  return 'Unknown'
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatParsedModelName(rawName: string): string | undefined {
  const name = rawName.trim().toLowerCase()
  if (!name) return undefined

  const familyAfterVersion = name.match(/(?:claude-)?(\d+)-(\d+)-(opus|sonnet|haiku)/)
  if (familyAfterVersion) {
    const major = familyAfterVersion[1]
    const minor = familyAfterVersion[2]
    const family = capitalize(familyAfterVersion[3])
    if (major.length === 1 && minor.length === 1) return `${family} ${major}.${minor}`
    return `${family} ${major}`
  }

  const familyWithVersion = name.match(/(?:claude-)?(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/)
  if (familyWithVersion) {
    const family = capitalize(familyWithVersion[1])
    const major = familyWithVersion[2]
    const minor = familyWithVersion[3]
    if (!minor) return `${family} ${major}`
    return minor.length === 1 ? `${family} ${major}.${minor}` : `${family} ${major}`
  }

  const gptVersion = name.match(/gpt-?(\d+(?:\.\d+)?)/)?.[1]
  if (name.includes('codex') && gptVersion) return `Codex ${gptVersion}`
  if (name.includes('codex')) return 'Codex'
  if (gptVersion) return `GPT-${gptVersion}`
  if (name.includes('opus')) return 'Opus'
  if (name.includes('sonnet')) return 'Sonnet'
  if (name.includes('haiku')) return 'Haiku'

  return undefined
}

/**
 * Get short name for a model ID (for badges)
 */
export function getModelShortName(id: string | null | undefined): string {
  const model = getModelById(id)
  if (model) return model.shortName
  // Try to parse unknown model IDs
  if (id) {
    const parts = id.split('/')
    const name = parts.length > 1 ? parts[1] : id
    const parsed = formatParsedModelName(name)
    if (parsed) return parsed

    const cleaned = name.replace(/^claude-/, '').replace(/[-_]+/g, ' ').trim()
    return cleaned.length > 20 ? `${cleaned.slice(0, 19)}...` : cleaned
  }
  return '?'
}
