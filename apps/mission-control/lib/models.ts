/**
 * AI Model Constants
 *
 * Available models for agent configuration.
 */

export const AVAILABLE_MODELS = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Sonnet 4',
    shortName: 'Sonnet',
    description: 'Fast, balanced performance',
    color: 'info',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Opus 4',
    shortName: 'Opus',
    description: 'Most capable, complex tasks',
    color: 'progress',
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Haiku 3.5',
    shortName: 'Haiku',
    description: 'Fastest, most efficient',
    color: 'success',
  },
] as const

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id']
export type ModelColor = (typeof AVAILABLE_MODELS)[number]['color']

export const DEFAULT_MODEL: ModelId = 'claude-sonnet-4-20250514'

/**
 * Get model info by ID
 */
export function getModelById(id: string | null): (typeof AVAILABLE_MODELS)[number] | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === id)
}

/**
 * Get display name for a model ID
 */
export function getModelDisplayName(id: string | null): string {
  const model = getModelById(id)
  return model?.name ?? 'Unknown'
}

/**
 * Get short name for a model ID (for badges)
 */
export function getModelShortName(id: string | null): string {
  const model = getModelById(id)
  return model?.shortName ?? 'Unknown'
}
