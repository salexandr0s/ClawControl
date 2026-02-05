'use client'

import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ModalWidth = 'default' | 'lg' | 'full'

export interface ModalFrameProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  width?: ModalWidth
  closeOnBackdrop?: boolean
  className?: string
  contentClassName?: string
}

export function ModalFrame({
  open,
  onClose,
  children,
  width = 'default',
  closeOnBackdrop = true,
  className,
  contentClassName,
}: ModalFrameProps) {
  const contentRef = useRef<HTMLElement>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    },
    [open, onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prevent body scroll when open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Focus the modal content when it opens
  useEffect(() => {
    if (open) contentRef.current?.focus()
  }, [open])

  const widthClasses: Record<ModalWidth, string> = {
    default: 'w-full max-w-lg',
    lg: 'w-full max-w-3xl',
    full: 'w-[min(1200px,calc(100vw-2rem))]',
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        open ? 'pointer-events-auto' : 'pointer-events-none',
        className
      )}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0'
        )}
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Content */}
      <section
        ref={contentRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative flex max-h-[85vh] flex-col overflow-hidden',
          'bg-bg-1 border border-bd-0 shadow-2xl rounded-[var(--radius-lg)]',
          'transform-gpu transition duration-200 ease-out',
          open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-1',
          widthClasses[width],
          contentClassName
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </section>
    </div>
  )
}

export interface ModalProps extends Omit<ModalFrameProps, 'children'> {
  title?: string
  description?: string
  children: React.ReactNode
  headerClassName?: string
  bodyClassName?: string
  showCloseButton?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width,
  closeOnBackdrop,
  className,
  contentClassName,
  headerClassName,
  bodyClassName,
  showCloseButton = true,
}: ModalProps) {
  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      width={width}
      closeOnBackdrop={closeOnBackdrop}
      className={className}
      contentClassName={contentClassName}
    >
      <header
        className={cn(
          'flex items-start justify-between gap-4 px-4 py-3 border-b border-bd-0',
          headerClassName
        )}
      >
        <div className="min-w-0 flex-1">
          {title ? (
            <h2 className="text-sm font-semibold text-fg-0 truncate">{title}</h2>
          ) : (
            <span className="sr-only">Modal</span>
          )}
          {description && (
            <p className="text-xs text-fg-2 mt-0.5 truncate">{description}</p>
          )}
        </div>

        {showCloseButton && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] text-fg-2 hover:text-fg-0 hover:bg-bg-3 transition-colors shrink-0"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </header>

      <div className={cn('flex-1 overflow-y-auto overscroll-contain p-4', bodyClassName)}>
        {children}
      </div>
    </ModalFrame>
  )
}
