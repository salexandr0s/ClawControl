'use client'

import { memo, useMemo } from 'react'
import { Bot, Terminal, User } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { CopyButton } from './code-block/copy-button'
import { Markdown } from './markdown'

export type PromptKitRole = 'operator' | 'agent' | 'system'

export interface MessageProps {
  id?: string
  role: PromptKitRole
  content: string
  timestamp: Date
  pending?: boolean
  streaming?: boolean
  error?: string
  className?: string
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-fg-2">
      <span className="inline-flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-2 animate-pulse" />
        <span className="w-1.5 h-1.5 rounded-full bg-fg-2 animate-pulse [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-fg-2 animate-pulse [animation-delay:300ms]" />
      </span>
      <span className="text-xs">Thinking…</span>
    </div>
  )
}

export const Message = memo(function Message({
  role,
  content,
  timestamp,
  pending,
  streaming,
  error,
  className,
}: MessageProps) {
  const reduceMotion = useReducedMotion()

  const isOperator = role === 'operator'
  const isSystem = role === 'system'

  const avatar = useMemo(() => {
    if (isOperator) return <User className="w-4 h-4 text-status-info" />
    if (isSystem) return <Terminal className="w-4 h-4 text-fg-2" />
    return <Bot className="w-4 h-4 text-status-progress" />
  }, [isOperator, isSystem])

  const wrapperAlign = isSystem ? 'justify-center' : isOperator ? 'justify-end' : 'justify-start'

  const bubbleClasses = cn(
    'group relative px-4 py-3 border text-sm break-words',
    'rounded-[var(--radius-md)]',
    isOperator
      ? 'bg-status-info text-white border-transparent'
      : isSystem
        ? 'bg-bg-2 text-fg-0 border-bd-0'
        : 'bg-bg-3 text-fg-0 border-bd-0',
    pending && 'opacity-70',
    error && 'border-status-danger/60'
  )

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn('flex w-full', wrapperAlign, className)}
    >
      <div className={cn('flex gap-3 max-w-[880px] w-full', isSystem && 'max-w-[760px]')}>
        {!isSystem && (
          <div
            className={cn(
              'mt-0.5 w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0 border',
              isOperator ? 'bg-status-info/10 border-status-info/20' : 'bg-bg-2 border-bd-0'
            )}
          >
            {avatar}
          </div>
        )}

        <div className={cn('min-w-0 flex-1', isOperator && 'flex flex-col items-end')}>
          <div className={cn(bubbleClasses, isOperator && 'w-fit')}>
            {/* Hover actions */}
            {!isSystem && content && (
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <CopyButton text={content} variant="ghost" />
              </div>
            )}

            {/* Content */}
            {streaming && !content ? (
              <TypingIndicator />
            ) : (
              <Markdown content={content || ''} />
            )}

            {streaming && content && (
              <div className="mt-2 flex items-center gap-2 text-[10px] text-fg-2">
                <span className="w-1.5 h-1.5 bg-status-progress rounded-full animate-pulse" />
                <span>Streaming</span>
              </div>
            )}

            {error && (
              <div className="mt-2 text-xs text-status-danger">
                {error}
              </div>
            )}
          </div>

          <div className={cn('mt-1 text-[10px] text-fg-3', isOperator && 'text-right')}>
            {formatTime(timestamp)}
            {pending && <span className="ml-2 text-fg-3/70">sending…</span>}
          </div>
        </div>
      </div>
    </motion.div>
  )
})
