'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { Bot, Terminal, User, CircleDot, PencilLine, Search, Play, CheckCircle2, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { CopyButton } from './code-block/copy-button'
import { Markdown } from './markdown'

export type PromptKitRole = 'operator' | 'agent' | 'system'

export interface MessageProps {
  id?: string
  role: PromptKitRole
  content: string
  attachments?: Array<{
    type: 'image'
    mimeType: string
    fileName: string
    content: string
  }>
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

function splitTraceContent(content: string): { main: string; trace: string | null } {
  const trimmed = content.trim()
  if (!trimmed) return { main: '', trace: null }

  const lines = content.split('\n')
  if (lines.length < 6) return { main: content, trace: null }

  const LOG_LINE_PATTERN =
    /^\s*(?:clawcontrol@\S+\s+dev|> .* dev|cross-env\s|node\s+scripts\/|▲\s+Next\.js|✓\s+Starting|⚠\s+|Local:\s+http|Network:\s+http|prisma:query|\[(?:db|boot)\]|error:|warn:|info:|SELECT\s|BEGIN\s|COMMIT\b|FROM\s+main\.)/i

  let splitIndex = 0
  for (const line of lines) {
    if (LOG_LINE_PATTERN.test(line.trim())) {
      splitIndex++
      continue
    }
    break
  }

  if (splitIndex < 4) return { main: content, trace: null }

  const trace = lines.slice(0, splitIndex).join('\n').trim()
  const main = lines.slice(splitIndex).join('\n').trim()
  return {
    main: main || '',
    trace: trace || null,
  }
}

type ActivityKind = 'edited' | 'explored' | 'ran' | 'done' | 'other'

interface ActivityItem {
  kind: ActivityKind
  label: string
  meta?: string
  plus?: number
  minus?: number
}

interface ActivityLayout {
  intro: string
  activities: ActivityItem[]
}

function parseActivityLine(line: string): ActivityItem {
  const edited = /^edited\s+(.+?)(?:\s+\+(\d+)\s*-\s*(\d+))?$/i.exec(line)
  if (edited) {
    return {
      kind: 'edited',
      label: edited[1]?.trim() || line,
      plus: edited[2] ? Number(edited[2]) : undefined,
      minus: edited[3] ? Number(edited[3]) : undefined,
    }
  }

  const explored = /^explored\s+(.+)$/i.exec(line)
  if (explored) {
    return { kind: 'explored', label: explored[1]?.trim() || line }
  }

  const ran = /^(ran|running)\s+(.+)$/i.exec(line)
  if (ran) {
    return { kind: 'ran', label: ran[2]?.trim() || line }
  }

  const done = /^(done|completed|finished)\b/i.exec(line)
  if (done) {
    return { kind: 'done', label: line }
  }

  return { kind: 'other', label: line }
}

function buildActivityLayout(body: string): ActivityLayout {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return { intro: '', activities: [] }
  }

  const parsed = lines.map(parseActivityLine)
  const known = parsed.filter((item) => item.kind !== 'other').length

  // Only switch to feed mode when we clearly have update-like line items.
  if (known < 2 || known / parsed.length < 0.45) {
    return { intro: body, activities: [] }
  }

  const introLines: string[] = []
  const activities: ActivityItem[] = []

  for (const item of parsed) {
    if (item.kind === 'other') {
      introLines.push(item.label)
      continue
    }
    activities.push(item)
  }

  return {
    intro: introLines.join('\n'),
    activities,
  }
}

function SystemActivityRow({ item }: { item: ActivityItem }) {
  const icon = item.kind === 'edited'
    ? <PencilLine className="w-3.5 h-3.5 text-status-info" />
    : item.kind === 'explored'
      ? <Search className="w-3.5 h-3.5 text-status-warning" />
      : item.kind === 'ran'
        ? <Play className="w-3.5 h-3.5 text-status-progress" />
        : item.kind === 'done'
          ? <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
          : <FolderOpen className="w-3.5 h-3.5 text-fg-2" />

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-bd-0 bg-bg-0/55 px-2.5 py-1.5 text-xs">
      <span className="inline-flex flex-shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-fg-1">{item.label}</span>
      {typeof item.plus === 'number' && typeof item.minus === 'number' ? (
        <span className="inline-flex items-center gap-1 font-mono text-[10px]">
          <span className="text-status-success">+{item.plus}</span>
          <span className="text-status-danger">-{item.minus}</span>
        </span>
      ) : item.meta ? (
        <span className="text-[10px] text-fg-3">{item.meta}</span>
      ) : null}
    </div>
  )
}

export const Message = memo(function Message({
  role,
  content,
  attachments,
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
    if (isOperator) return <User className="w-4 h-4 text-fg-1" />
    if (isSystem) return <Terminal className="w-4 h-4 text-fg-2" />
    return <Bot className="w-4 h-4 text-fg-1" />
  }, [isOperator, isSystem])

  const wrapperAlign = isOperator ? 'justify-end' : 'justify-start'
  const parsedContent = useMemo(() => {
    if (isOperator) return { main: content, trace: null as string | null }
    return splitTraceContent(content)
  }, [content, isOperator])

  const bubbleClasses = cn(
    'group relative w-fit max-w-full px-4 py-3 text-sm break-words',
    'rounded-[10px]',
    'border border-bd-0',
    isOperator
      ? 'bg-bg-2 text-fg-0'
      : isSystem
        ? 'bg-bg-2 text-fg-0'
        : 'bg-bg-3 text-fg-0',
    pending && 'opacity-70',
    error && 'outline outline-1 outline-status-danger/50'
  )

  const systemCardTitle = useMemo(() => {
    if (!isSystem) return null
    const firstLine = (parsedContent.main.split('\n')[0] || '').trim()
    if (!firstLine) return 'Update'
    if (firstLine.length <= 72) return firstLine
    return 'Update'
  }, [isSystem, parsedContent.main])

  const systemCardBody = useMemo(() => {
    if (!isSystem) return parsedContent.main
    const lines = parsedContent.main.split('\n')
    const firstLine = (lines[0] || '').trim()
    if (firstLine && systemCardTitle === firstLine) {
      return lines.slice(1).join('\n').trim()
    }
    return parsedContent.main
  }, [isSystem, parsedContent.main, systemCardTitle])

  const activityLayout = useMemo(() => buildActivityLayout(systemCardBody), [systemCardBody])
  const [collapsed, setCollapsed] = useState(isSystem)

  useEffect(() => {
    setCollapsed(isSystem)
  }, [isSystem, content])

  const collapsedPreview = useMemo(() => {
    if (!isSystem) return ''
    if (activityLayout.activities.length > 0) {
      const first = activityLayout.activities[0]?.label ?? 'Update'
      const rest = Math.max(0, activityLayout.activities.length - 1)
      return rest > 0 ? `${first} (+${rest} more)` : first
    }
    const text = (activityLayout.intro || systemCardBody || '').replace(/\s+/g, ' ').trim()
    if (!text) return parsedContent.trace ? 'Trace output available' : 'Update'
    return text.length > 150 ? `${text.slice(0, 150)}...` : text
  }, [activityLayout.activities, activityLayout.intro, isSystem, parsedContent.trace, systemCardBody])

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn('flex w-full', wrapperAlign, className)}
    >
      <div className={cn('flex gap-3 max-w-[88%]', !isSystem && 'min-w-0', isOperator && 'justify-end', isOperator && 'flex-row-reverse')}>
        {!isSystem && (
          <div
            className={cn(
              'mt-0.5 w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0',
              isOperator ? 'bg-bg-3' : 'bg-bg-2'
            )}
          >
            {avatar}
          </div>
        )}

        <div className={cn('min-w-0', isOperator && 'flex flex-col items-end', isSystem && 'w-full max-w-[780px]')}>
          {isSystem ? (
            <div className={cn(
              'w-full rounded-[12px] border border-bd-0 bg-bg-1/95 px-3.5 py-3',
              pending && 'opacity-70',
              error && 'outline outline-1 outline-status-danger/50'
            )}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-xs text-fg-2">
                  <CircleDot className="w-3.5 h-3.5 text-status-progress" />
                  <span className="font-medium">{systemCardTitle}</span>
                </div>
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-bd-0 px-1.5 py-0.5 text-[10px] text-fg-2 hover:text-fg-1 hover:bg-bg-0 transition-colors"
                    title={collapsed ? 'Expand update' : 'Minimize update'}
                  >
                    {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {collapsed ? 'Expand' : 'Minimize'}
                  </button>
                  <span className="text-[10px] text-fg-3">{formatTime(timestamp)}</span>
                </div>
              </div>

              {collapsed ? (
                <div className="text-xs text-fg-2 truncate">
                  {collapsedPreview}
                </div>
              ) : systemCardBody ? (
                <>
                {activityLayout.intro ? (
                  <Markdown content={activityLayout.intro} />
                ) : null}

                {activityLayout.activities.length > 0 ? (
                  <div className={cn('space-y-1.5', activityLayout.intro && 'mt-2')}>
                    {activityLayout.activities.map((item, idx) => (
                      <SystemActivityRow key={`${item.kind}-${item.label}-${idx}`} item={item} />
                    ))}
                  </div>
                ) : null}
                </>
              ) : null}

              {!collapsed && parsedContent.trace && (
                <details className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-bd-0 bg-bg-0/40">
                  <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[11px] text-fg-2 hover:text-fg-1">
                    Trace output
                  </summary>
                  <pre className="max-h-52 overflow-auto border-t border-bd-0 px-2.5 py-2 text-[10px] leading-5 text-fg-2 whitespace-pre-wrap font-mono">
                    {parsedContent.trace}
                  </pre>
                </details>
              )}

              {error && (
                <div className="mt-2 text-xs text-status-danger">
                  {error}
                </div>
              )}
            </div>
          ) : (
          <div className={cn(bubbleClasses, !isSystem && 'pr-10')}>
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
              <Markdown content={parsedContent.main || ''} />
            )}

            {attachments && attachments.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {attachments.map((attachment, idx) => (
                  <div
                    key={`${attachment.fileName}-${idx}`}
                    className="overflow-hidden rounded-[var(--radius-md)] border border-bd-0 bg-bg-0"
                    title={attachment.fileName}
                  >
                    <Image
                      src={attachment.content}
                      alt={attachment.fileName}
                      width={180}
                      height={120}
                      className="h-20 w-full object-cover"
                      unoptimized
                    />
                    <div className="truncate px-2 py-1 text-[10px] text-fg-2">
                      {attachment.fileName}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {parsedContent.trace && (
              <details className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-bd-0 bg-bg-0/40">
                <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[11px] text-fg-2 hover:text-fg-1">
                  Trace output
                </summary>
                <pre className="max-h-52 overflow-auto border-t border-bd-0 px-2.5 py-2 text-[10px] leading-5 text-fg-2 whitespace-pre-wrap font-mono">
                  {parsedContent.trace}
                </pre>
              </details>
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
          )}

          {!isSystem && (
            <div className={cn('mt-1 text-[10px] text-fg-3', isOperator && 'text-right')}>
              {formatTime(timestamp)}
              {pending && <span className="ml-2 text-fg-3/70">sending…</span>}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
})
