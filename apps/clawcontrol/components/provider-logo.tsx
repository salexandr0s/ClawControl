import { cn } from '@/lib/utils'

type ProviderLogoProps = {
  provider: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

type ProviderVisual = {
  src?: string
  label: string
  lightBg?: boolean
  labelClassName?: string
}

const PROVIDER_VISUALS: Record<string, ProviderVisual> = {
  'amazon-bedrock': { src: '/images/providers/aws.svg', label: 'AW', lightBg: true },
  anthropic: { src: '/images/providers/anthropic.svg', label: 'AN', lightBg: true },
  'azure-openai': { src: '/images/providers/azure.svg', label: 'AZ' },
  github: { src: '/images/providers/github.svg', label: 'GH', lightBg: true },
  'github-copilot': { src: '/images/providers/github-copilot.svg', label: 'GC', lightBg: true },
  google: { src: '/images/providers/google.svg', label: 'GO' },
  'google-cloud': { src: '/images/providers/google-cloud.svg', label: 'GV' },
  'google-gemini': { src: '/images/providers/google-gemini.svg', label: 'GG' },
  huggingface: { src: '/images/providers/huggingface.svg', label: 'HF' },
  kimi: { src: '/images/providers/kimi.svg', label: 'KI' },
  lmstudio: { src: '/images/providers/lmstudio.svg', label: 'LM', lightBg: true },
  minimax: { src: '/images/providers/minimax.svg', label: 'MM' },
  mistral: { src: '/images/providers/mistral.svg', label: 'MS' },
  ollama: { src: '/images/providers/ollama.svg', label: 'OL', lightBg: true },
  openai: { src: '/images/providers/openai.svg', label: 'OA', lightBg: true },
  opencode: { src: '/images/providers/opencode.svg', label: 'OC' },
  openrouter: { src: '/images/providers/openrouter.svg', label: 'OR' },
  perplexity: { src: '/images/providers/perplexity.svg', label: 'PX' },
  cerebras: { src: '/images/providers/cerebras.svg', label: 'CE', lightBg: true },
  deepseek: { src: '/images/providers/deepseek.svg', label: 'DS' },
  groq: { src: '/images/providers/groq.svg', label: 'GQ', lightBg: true },
  together: { src: '/images/providers/together.svg', label: 'TG' },
  vercel: { src: '/images/providers/vercel.svg', label: 'VC', lightBg: true },
  xai: { src: '/images/providers/x.svg', label: 'XA', lightBg: true },
  zai: { src: '/images/providers/zai.svg', label: 'ZA', lightBg: true },
}

function canonicalProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase()
  if (!normalized) return 'unknown'

  if (normalized.startsWith('anthropic')) return 'anthropic'
  if (normalized.startsWith('openai-codex')) return 'openai'
  if (normalized.startsWith('openai')) return 'openai'
  if (normalized.startsWith('google-')) {
    if (normalized.includes('gemini')) return 'google-gemini'
    if (normalized.includes('vertex')) return 'google-cloud'
    return 'google'
  }
  if (normalized === 'google') return 'google'
  if (normalized.startsWith('github-')) {
    return normalized.includes('copilot') ? 'github-copilot' : 'github'
  }
  if (normalized === 'github') return 'github'
  if (normalized.startsWith('azure-openai')) return 'azure-openai'
  if (normalized.startsWith('amazon-bedrock')) return 'amazon-bedrock'
  if (normalized.startsWith('vercel-ai-gateway')) return 'vercel'
  if (normalized.startsWith('vercel')) return 'vercel'
  if (normalized.startsWith('minimax')) return 'minimax'
  if (normalized.startsWith('mistral')) return 'mistral'
  if (normalized.startsWith('huggingface')) return 'huggingface'
  if (normalized.startsWith('openrouter')) return 'openrouter'
  if (normalized.startsWith('perplexity')) return 'perplexity'
  if (normalized.startsWith('ollama')) return 'ollama'
  if (normalized.startsWith('xai')) return 'xai'
  if (normalized.startsWith('deepseek')) return 'deepseek'
  if (normalized.startsWith('cerebras')) return 'cerebras'
  if (normalized.startsWith('groq')) return 'groq'
  if (normalized.startsWith('together')) return 'together'
  if (normalized.startsWith('opencode')) return 'opencode'
  if (normalized.startsWith('lmstudio')) return 'lmstudio'
  if (normalized.startsWith('kimi')) return 'kimi'
  if (normalized === 'z.ai') return 'zai'
  if (normalized.startsWith('zai')) return 'zai'

  return normalized
}

function autoLabel(provider: string): string {
  const parts = provider.split(/[^a-z0-9]+/g).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

export function ProviderLogo({ provider, size = 'sm', className }: ProviderLogoProps) {
  const canonical = canonicalProvider(provider)
  const visual = PROVIDER_VISUALS[canonical]

  const boxClass = size === 'md' ? 'w-7 h-7 rounded-md' : size === 'sm' ? 'w-6 h-6 rounded-md' : 'w-4 h-4 rounded-sm'
  const iconClass = size === 'md' ? 'w-5 h-5' : size === 'sm' ? 'w-4 h-4' : 'w-3 h-3'
  const labelClass = size === 'md' ? 'text-[10px]' : size === 'sm' ? 'text-[9px]' : 'text-[8px]'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center border',
        visual?.lightBg ? 'bg-white/95 border-white/20' : 'bg-bg-2 border-bd-1',
        boxClass,
        className
      )}
      aria-hidden
    >
      {visual?.src ? (
        <img
          src={visual.src}
          alt=""
          className={cn(iconClass, 'object-contain')}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className={cn('font-semibold leading-none uppercase text-fg-1', labelClass, visual?.labelClassName)}>
          {visual?.label ?? autoLabel(canonical)}
        </span>
      )}
    </span>
  )
}
