'use client'

import { cn } from '@/lib/utils'

interface KbdProps {
  children: React.ReactNode
  className?: string
}

/**
 * Keyboard shortcut chip
 * Displays keyboard shortcuts in a styled pill
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd className={cn('kbd', className)}>
      {children}
    </kbd>
  )
}

/**
 * Keyboard shortcut combination
 * Example: <KbdCombo keys={['Cmd', 'K']} />
 */
export function KbdCombo({
  keys,
  className,
}: {
  keys: string[]
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((key, i) => (
        <Kbd key={i}>{key}</Kbd>
      ))}
    </span>
  )
}
