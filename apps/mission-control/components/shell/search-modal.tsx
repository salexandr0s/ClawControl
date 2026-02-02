'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Search, FileText, Cog, MessageSquare, File, X, Loader2 } from 'lucide-react'
import type { SearchResult } from '@/lib/data'

interface SearchModalProps {
  open: boolean
  onClose: () => void
}

// Icons for result types
const typeIcons: Record<SearchResult['type'], typeof FileText> = {
  work_order: FileText,
  operation: Cog,
  message: MessageSquare,
  document: File,
}

const typeLabels: Record<SearchResult['type'], string> = {
  work_order: 'Work Order',
  operation: 'Operation',
  message: 'Message',
  document: 'Document',
}

export function SearchModal({ open, onClose }: SearchModalProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      // Small delay to ensure modal is rendered
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Search with debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        )
        if (res.ok) {
          const data = await res.json()
          setResults(data.results || [])
          setSelectedIndex(0)
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('[search] Error:', err)
        }
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            navigateToResult(results[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [results, selectedIndex, onClose]
  )

  // Navigate to selected result based on type
  const navigateToResult = (result: SearchResult) => {
    onClose()

    switch (result.type) {
      case 'work_order':
        router.push(`/work-orders/${result.id}`)
        break
      case 'operation':
        // Navigate to parent work order's operations tab
        if (result.workOrderId) {
          router.push(`/work-orders/${result.workOrderId}?tab=operations`)
        } else {
          router.push('/work-orders')
        }
        break
      case 'message':
        // Messages tab exists but is disabled - route to work order
        if (result.workOrderId) {
          router.push(`/work-orders/${result.workOrderId}`)
        } else {
          router.push('/work-orders')
        }
        break
      case 'document':
        // No documents page exists - fall back to work orders
        router.push('/work-orders')
        break
    }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-bg-0/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-[15%] z-50 w-full max-w-xl -translate-x-1/2">
        <div className="bg-bg-1 border border-bd-1 rounded-[var(--radius-lg)] shadow-2xl overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
            <Search className="w-4 h-4 text-fg-2 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search work orders, operations, messages..."
              className="flex-1 bg-transparent text-sm text-fg-0 placeholder:text-fg-3 outline-none"
            />
            {loading && <Loader2 className="w-4 h-4 text-fg-2 animate-spin" />}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-bg-3 transition-colors"
            >
              <X className="w-4 h-4 text-fg-2" />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto">
            {query && !loading && results.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-fg-2">
                No results found for &quot;{query}&quot;
              </div>
            )}

            {results.length > 0 && (
              <div className="py-2">
                {results.map((result, index) => {
                  const Icon = typeIcons[result.type]
                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => navigateToResult(result)}
                      className={cn(
                        'w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors',
                        index === selectedIndex
                          ? 'bg-bg-3'
                          : 'hover:bg-bg-2'
                      )}
                    >
                      <Icon className="w-4 h-4 text-fg-2 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-fg-0 font-medium truncate">
                            {result.title}
                          </span>
                          {result.workOrderCode && (
                            <span className="text-xs text-fg-3 font-mono shrink-0">
                              {result.workOrderCode}
                            </span>
                          )}
                        </div>
                        {result.snippet && (
                          <p className="text-xs text-fg-2 mt-0.5 line-clamp-2">
                            {result.snippet}
                          </p>
                        )}
                        <span className="text-xs text-fg-3 mt-1 block">
                          {typeLabels[result.type]}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] bg-bg-2/50 text-xs text-fg-3">
            <span>
              <kbd className="kbd">↑↓</kbd> to navigate
            </span>
            <span>
              <kbd className="kbd">↵</kbd> to select
            </span>
            <span>
              <kbd className="kbd">esc</kbd> to close
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Hook to manage search modal state with Cmd/Ctrl+K shortcut
 */
export function useSearchModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return {
    open,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
  }
}
