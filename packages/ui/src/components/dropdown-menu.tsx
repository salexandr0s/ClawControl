'use client'

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '../theme'

export type DropdownMenuAlign = 'start' | 'end'
export type DropdownMenuSize = 'sm' | 'md'

export interface DropdownMenuItem<T extends string = string> {
  id: T
  label: ReactNode
  icon?: ReactNode
  description?: ReactNode
  disabled?: boolean
  danger?: boolean
  title?: string
}

export interface DropdownMenuProps<T extends string = string> {
  items: ReadonlyArray<DropdownMenuItem<T>>
  onSelect: (id: T) => void
  trigger: ReactNode
  ariaLabel?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  align?: DropdownMenuAlign
  menuWidth?: 'trigger' | number | string
  size?: DropdownMenuSize
  disabled?: boolean
  className?: string
  menuClassName?: string
}

interface DropdownMenuClassOptions {
  size?: DropdownMenuSize
}

const triggerBaseClass =
  'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 text-fg-1 transition-colors hover:bg-bg-3 hover:text-fg-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info/40 disabled:opacity-50 disabled:cursor-not-allowed'

const triggerSizeClass: Record<DropdownMenuSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs font-medium',
  md: 'px-3 py-2 text-sm font-medium',
}

const menuClass =
  'max-h-[min(420px,calc(100vh-24px))] overflow-y-auto rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 shadow-[0_14px_36px_rgba(0,0,0,0.45)] p-1'

const itemBaseClass =
  'w-full text-left rounded-[var(--radius-sm)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info/40'

const itemSizeClass: Record<DropdownMenuSize, string> = {
  sm: 'px-2.5 py-2 text-xs',
  md: 'px-3 py-2.5 text-sm',
}

export function dropdownMenuClasses(options: DropdownMenuClassOptions = {}) {
  const size = options.size ?? 'sm'
  return {
    trigger: cn(triggerBaseClass, triggerSizeClass[size]),
    menu: menuClass,
    item: cn(itemBaseClass, itemSizeClass[size]),
    itemNormal: 'text-fg-1 hover:bg-bg-3 hover:text-fg-0',
    itemDanger: 'text-status-danger hover:bg-status-danger/10',
    itemDisabled: 'text-fg-3 cursor-not-allowed opacity-60',
    icon: 'w-4 h-4 shrink-0 text-fg-2',
    description: 'mt-0.5 text-[11px] text-fg-2',
  }
}

function getFirstEnabledIndex<T extends string>(items: ReadonlyArray<DropdownMenuItem<T>>): number {
  return items.findIndex((item) => !item.disabled)
}

function getLastEnabledIndex<T extends string>(items: ReadonlyArray<DropdownMenuItem<T>>): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (!items[i]?.disabled) return i
  }
  return -1
}

function getNextEnabledIndex<T extends string>(
  items: ReadonlyArray<DropdownMenuItem<T>>,
  startIndex: number,
  direction: 1 | -1
): number {
  if (items.length === 0) return -1
  let index = startIndex
  for (let i = 0; i < items.length; i += 1) {
    index = (index + direction + items.length) % items.length
    if (!items[index]?.disabled) return index
  }
  return -1
}

export function DropdownMenu<T extends string = string>({
  items,
  onSelect,
  trigger,
  ariaLabel,
  open,
  defaultOpen = false,
  onOpenChange,
  align = 'end',
  menuWidth = 'trigger',
  size = 'sm',
  disabled = false,
  className,
  menuClassName,
}: DropdownMenuProps<T>) {
  const classes = dropdownMenuClasses({ size })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [isMounted, setIsMounted] = useState(false)
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ position: 'fixed', top: -9999, left: -9999 })

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen

  const setOpen = (nextOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const updatePosition = useMemo(
    () => () => {
      const triggerEl = triggerRef.current
      if (!triggerEl) return
      const rect = triggerEl.getBoundingClientRect()
      const gap = 6
      const viewportPadding = 8
      const estimatedHeight = menuRef.current?.offsetHeight ?? 240
      const placeAbove =
        rect.bottom + gap + estimatedHeight > window.innerHeight - viewportPadding &&
        rect.top - gap - estimatedHeight > viewportPadding

      const nextStyle: CSSProperties = {
        position: 'fixed',
        zIndex: 70,
        top: placeAbove ? rect.top - gap : rect.bottom + gap,
        transform: placeAbove ? 'translateY(-100%)' : undefined,
      }

      if (menuWidth === 'trigger') {
        nextStyle.width = rect.width
      } else if (typeof menuWidth === 'number') {
        nextStyle.width = `${menuWidth}px`
      } else if (typeof menuWidth === 'string') {
        nextStyle.width = menuWidth
      }

      if (align === 'start') {
        nextStyle.left = Math.max(viewportPadding, rect.left)
      } else {
        nextStyle.right = Math.max(viewportPadding, window.innerWidth - rect.right)
      }

      setMenuStyle(nextStyle)
    },
    [align, menuWidth]
  )

  useEffect(() => {
    if (!isOpen) return
    updatePosition()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const handleWindowChange = () => updatePosition()

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
    }
  }, [isOpen, setOpen, updatePosition])

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(-1)
      return
    }
    setActiveIndex(getFirstEnabledIndex(items))
  }, [isOpen, items])

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return
    itemRefs.current[activeIndex]?.focus()
  }, [isOpen, activeIndex])

  const closeAndFocusTrigger = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleSelect = (item: DropdownMenuItem<T>) => {
    if (item.disabled) return
    onSelect(item.id)
    closeAndFocusTrigger()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(getFirstEnabledIndex(items))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(getLastEnabledIndex(items))
      return
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      closeAndFocusTrigger()
    }
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndFocusTrigger()
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(getFirstEnabledIndex(items))
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(getLastEnabledIndex(items))
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (activeIndex < 0) {
        setActiveIndex(event.key === 'ArrowDown' ? getFirstEnabledIndex(items) : getLastEnabledIndex(items))
        return
      }
      const next = getNextEnabledIndex(items, activeIndex, event.key === 'ArrowDown' ? 1 : -1)
      if (next >= 0) setActiveIndex(next)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const currentItem = items[activeIndex]
      if (currentItem && !currentItem.disabled) {
        handleSelect(currentItem)
      }
    }
  }

  const menuNode = isOpen ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className={cn(classes.menu, menuClassName)}
      style={menuStyle}
      onKeyDown={handleMenuKeyDown}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => {
            itemRefs.current[index] = element
          }}
          type="button"
          role="menuitem"
          title={item.title}
          tabIndex={activeIndex === index ? 0 : -1}
          aria-disabled={item.disabled ? true : undefined}
          disabled={item.disabled}
          onFocus={() => setActiveIndex(index)}
          onMouseEnter={() => {
            if (!item.disabled) setActiveIndex(index)
          }}
          onClick={() => handleSelect(item)}
          className={cn(
            classes.item,
            item.disabled
              ? classes.itemDisabled
              : item.danger
                ? classes.itemDanger
                : classes.itemNormal
          )}
        >
          <span className="flex items-start gap-2.5">
            {item.icon && <span className={classes.icon}>{item.icon}</span>}
            <span className="min-w-0">
              <span className="block">{item.label}</span>
              {item.description && <span className={classes.description}>{item.description}</span>}
            </span>
          </span>
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={cn(classes.trigger, className)}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">{trigger}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-fg-2 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {menuNode && (isMounted && typeof document !== 'undefined' ? createPortal(menuNode, document.body) : menuNode)}
    </div>
  )
}
