'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildDispatchErrorDisplay } from '@/lib/work-orders/dispatch-error'

interface DispatchErrorCardProps {
  error: string | null | undefined
  title?: string
  className?: string
}

export function DispatchErrorCard({
  error,
  title = 'Blocked',
  className,
}: DispatchErrorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const display = useMemo(() => buildDispatchErrorDisplay(error), [error])

  if (!display.raw) return null

  return (
    <div className={cn('p-3 bg-status-danger/10 border border-status-danger/30 rounded-[var(--radius-md)]', className)}>
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-status-danger">{title}</div>
          <p className="text-sm text-fg-1 mt-1 break-words [overflow-wrap:anywhere]">{display.summary}</p>
          {display.hint ? (
            <p className="text-xs text-status-warning mt-1 break-words [overflow-wrap:anywhere]">{display.hint}</p>
          ) : null}
        </div>
      </div>

      {display.raw !== display.summary ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs text-status-danger hover:text-status-danger/80"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {expanded ? 'Hide raw details' : 'Show raw details'}
          </button>
          {expanded ? (
            <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded bg-bg-2/80 border border-bd-0 p-2 text-[11px] text-fg-1 font-mono">
              {display.raw}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
