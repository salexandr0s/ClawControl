'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { generateIdenticonSvg } from '@/lib/avatar'

interface AgentAvatarProps {
  agentId: string
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showStatus?: boolean
  status?: 'idle' | 'active' | 'blocked' | 'error'
}

const SIZE_MAP = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
} as const

const SIZE_CLASSES = {
  xs: 'w-4 h-4',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
} as const

const STATUS_RING_CLASSES = {
  idle: 'ring-fg-3',
  active: 'ring-status-success',
  blocked: 'ring-status-warning',
  error: 'ring-status-danger',
} as const

export function AgentAvatar({
  agentId,
  name,
  size = 'md',
  className,
  showStatus = false,
  status = 'idle',
}: AgentAvatarProps) {
  const [error, setError] = useState(false)
  const pixelSize = SIZE_MAP[size]

  // Generate fallback identicon
  const fallbackSvg = generateIdenticonSvg(name, { size: pixelSize })
  const fallbackDataUrl = `data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString('base64')}`

  const imageUrl = error ? fallbackDataUrl : `/api/agents/${agentId}/avatar`

  return (
    <div
      className={cn(
        'relative rounded-[var(--radius-md)] overflow-hidden flex-shrink-0',
        SIZE_CLASSES[size],
        showStatus && 'ring-2 ring-offset-1 ring-offset-bg-0',
        showStatus && STATUS_RING_CLASSES[status],
        className
      )}
    >
      <img
        src={imageUrl}
        alt={`${name} avatar`}
        className="w-full h-full object-cover"
        onError={() => setError(true)}
      />
    </div>
  )
}

/**
 * Inline identicon for cases where we don't want to load from API
 */
export function AgentIdenticonInline({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const pixelSize = SIZE_MAP[size]
  const svg = generateIdenticonSvg(name, { size: pixelSize })

  return (
    <div
      className={cn(
        'rounded-[var(--radius-md)] overflow-hidden flex-shrink-0',
        SIZE_CLASSES[size],
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
