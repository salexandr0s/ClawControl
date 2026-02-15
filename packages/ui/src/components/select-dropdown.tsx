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
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '../theme'

export type SelectDropdownTone = 'toolbar' | 'field'
export type SelectDropdownSize = 'sm' | 'md'
export type SelectDropdownAlign = 'start' | 'end'

export interface SelectDropdownOption<T extends string = string> {
  value: T
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  textValue?: string
  title?: string
}

export interface SelectDropdownFooterAction {
  label: ReactNode
  onClick: () => void
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  title?: string
}

export interface SelectDropdownProps<T extends string = string> {
  value: T | '' | null | undefined
  onChange: (value: T) => void
  options: ReadonlyArray<SelectDropdownOption<T>>
  ariaLabel?: string
  placeholder?: ReactNode
  tone?: SelectDropdownTone
  size?: SelectDropdownSize
  disabled?: boolean
  search?: 'auto' | boolean
  searchThreshold?: number
  emptyMessage?: ReactNode
  footerAction?: SelectDropdownFooterAction
  align?: SelectDropdownAlign
  menuWidth?: 'trigger' | number | string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  triggerClassName?: string
  menuClassName?: string
}

interface SelectDropdownClassOptions {
  tone?: SelectDropdownTone
  size?: SelectDropdownSize
}

const triggerBaseClass =
  'inline-flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info/40 disabled:opacity-50 disabled:cursor-not-allowed'

const triggerToneClass: Record<SelectDropdownTone, string> = {
  toolbar: 'bg-bg-3 border-bd-0 text-fg-1 hover:bg-bg-2 hover:text-fg-0',
  field: 'bg-bg-2 border-bd-1 text-fg-0 hover:border-bd-0',
}

const triggerSizeClass: Record<SelectDropdownSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs font-medium',
  md: 'px-3 py-2 text-sm font-medium',
}

const menuBaseClass =
  'max-h-[min(440px,calc(100vh-24px))] overflow-y-auto rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 shadow-[0_14px_36px_rgba(0,0,0,0.45)] p-1'

const optionBaseClass =
  'w-full text-left rounded-[var(--radius-sm)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info/40'

const optionSizeClass: Record<SelectDropdownSize, string> = {
  sm: 'px-2.5 py-2 text-xs',
  md: 'px-3 py-2.5 text-sm',
}

export function selectDropdownClasses(options: SelectDropdownClassOptions = {}) {
  const tone = options.tone ?? 'field'
  const size = options.size ?? 'md'
  return {
    trigger: cn(triggerBaseClass, triggerToneClass[tone], triggerSizeClass[size]),
    menu: menuBaseClass,
    option: cn(optionBaseClass, optionSizeClass[size]),
    optionDefault: 'text-fg-1 hover:bg-bg-3 hover:text-fg-0',
    optionSelected: 'bg-bg-3 text-fg-0',
    optionDisabled: 'text-fg-3 cursor-not-allowed opacity-60',
    description: 'mt-0.5 text-[11px] text-fg-2',
    searchWrap: 'px-1 pb-1',
    searchInput:
      'w-full rounded-[var(--radius-sm)] border border-bd-0 bg-bg-3 pl-7 pr-2 py-1.5 text-xs text-fg-1 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/40',
    emptyState: 'px-2.5 py-2 text-xs text-fg-3',
    footerAction:
      'mt-1 border-t border-bd-0 pt-1 w-full text-left rounded-[var(--radius-sm)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info/40',
    footerActionDefault: cn(optionBaseClass, optionSizeClass[size], 'text-fg-1 hover:bg-bg-3 hover:text-fg-0'),
    footerActionDanger: cn(optionBaseClass, optionSizeClass[size], 'text-status-danger hover:bg-status-danger/10'),
  }
}

function getOptionText<T extends string>(option: SelectDropdownOption<T>): string {
  if (option.textValue) return option.textValue
  const labelText = typeof option.label === 'string' ? option.label : ''
  const descriptionText = typeof option.description === 'string' ? option.description : ''
  return `${option.value} ${labelText} ${descriptionText}`.trim()
}

function getFirstEnabledIndex<T extends string>(items: ReadonlyArray<SelectDropdownOption<T>>): number {
  return items.findIndex((item) => !item.disabled)
}

function getLastEnabledIndex<T extends string>(items: ReadonlyArray<SelectDropdownOption<T>>): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (!items[i]?.disabled) return i
  }
  return -1
}

function getNextEnabledIndex<T extends string>(
  items: ReadonlyArray<SelectDropdownOption<T>>,
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

export function SelectDropdown<T extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = 'Select...',
  tone = 'field',
  size = 'md',
  disabled = false,
  search = 'auto',
  searchThreshold = 10,
  emptyMessage = 'No options found',
  footerAction,
  align = 'start',
  menuWidth = 'trigger',
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  triggerClassName,
  menuClassName,
}: SelectDropdownProps<T>) {
  const classes = selectDropdownClasses({ tone, size })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searchQuery, setSearchQuery] = useState('')
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

  const selectedOption = options.find((option) => option.value === value) ?? null

  const showSearch = search === true || (search === 'auto' && options.length > searchThreshold)

  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => getOptionText(option).toLowerCase().includes(query))
  }, [options, searchQuery])

  const updatePosition = useMemo(
    () => () => {
      const triggerEl = triggerRef.current
      if (!triggerEl) return
      const rect = triggerEl.getBoundingClientRect()
      const gap = 6
      const viewportPadding = 8
      const maxAllowedWidth = Math.max(0, window.innerWidth - viewportPadding * 2)
      const estimatedHeight = menuRef.current?.offsetHeight ?? 260
      const placeAbove =
        rect.bottom + gap + estimatedHeight > window.innerHeight - viewportPadding &&
        rect.top - gap - estimatedHeight > viewportPadding

      const nextStyle: CSSProperties = {
        position: 'fixed',
        zIndex: 70,
        top: placeAbove ? rect.top - gap : rect.bottom + gap,
        transform: placeAbove ? 'translateY(-100%)' : undefined,
        maxWidth: maxAllowedWidth,
      }

      if (menuWidth === 'trigger') {
        // Prefer menus that can expand to fit option labels while keeping at least the trigger width.
        // This prevents short triggers (e.g. "Stars") from truncating longer menu options (e.g. "Downloads").
        nextStyle.width = 'max-content'
        nextStyle.minWidth = Math.min(rect.width, maxAllowedWidth)
      } else if (typeof menuWidth === 'number') {
        nextStyle.width = Math.min(menuWidth, maxAllowedWidth)
      } else if (typeof menuWidth === 'string') {
        nextStyle.width = menuWidth
      }

      // Clamp horizontally so expanded menus don't render off-screen.
      const measuredWidth = menuRef.current?.offsetWidth ?? rect.width
      const widthForClamp =
        menuWidth === 'trigger'
          ? Math.min(Math.max(rect.width, measuredWidth), maxAllowedWidth)
          : typeof menuWidth === 'number'
            ? Math.min(menuWidth, maxAllowedWidth)
            : Math.min(measuredWidth, maxAllowedWidth)
      const desiredLeft = align === 'start' ? rect.left : rect.right - widthForClamp
      const left = Math.min(
        Math.max(viewportPadding, desiredLeft),
        window.innerWidth - viewportPadding - widthForClamp
      )
      nextStyle.left = left

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
      setSearchQuery('')
      setActiveIndex(-1)
      return
    }
    setSearchQuery('')
    const selectedIndex = filteredOptions.findIndex((option) => option.value === value && !option.disabled)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : getFirstEnabledIndex(filteredOptions))
  }, [filteredOptions, isOpen, value])

  useEffect(() => {
    if (!isOpen) return
    if (showSearch) {
      searchRef.current?.focus()
      return
    }
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.focus()
    }
  }, [isOpen, showSearch, activeIndex])

  useEffect(() => {
    if (!isOpen || showSearch) return
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.focus()
    }
  }, [activeIndex, isOpen, showSearch])

  const closeAndFocusTrigger = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleSelect = (option: SelectDropdownOption<T>) => {
    if (option.disabled) return
    onChange(option.value)
    closeAndFocusTrigger()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(getLastEnabledIndex(filteredOptions))
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
      setActiveIndex(getFirstEnabledIndex(filteredOptions))
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(getLastEnabledIndex(filteredOptions))
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (activeIndex < 0) {
        setActiveIndex(event.key === 'ArrowDown' ? getFirstEnabledIndex(filteredOptions) : getLastEnabledIndex(filteredOptions))
      } else {
        const next = getNextEnabledIndex(filteredOptions, activeIndex, event.key === 'ArrowDown' ? 1 : -1)
        if (next >= 0) setActiveIndex(next)
      }
      if (showSearch && activeIndex >= 0) {
        itemRefs.current[activeIndex]?.focus()
      }
      return
    }

    if (event.key === 'Enter') {
      const current = filteredOptions[activeIndex]
      if (current && !current.disabled) {
        event.preventDefault()
        handleSelect(current)
      }
    }
  }

  const menuNode = isOpen ? (
    <div
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel}
      className={cn(classes.menu, menuClassName)}
      style={menuStyle}
      onKeyDown={handleMenuKeyDown}
    >
      {showSearch && (
        <div className={classes.searchWrap}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search..."
              className={classes.searchInput}
            />
          </div>
        </div>
      )}

      {filteredOptions.length === 0 && (
        <div className={classes.emptyState}>{emptyMessage}</div>
      )}

      {filteredOptions.map((option, index) => {
        const isSelected = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            type="button"
            role="option"
            aria-selected={isSelected}
            title={
              option.title ??
              (typeof option.label === 'string'
                ? option.label
                : option.textValue ?? String(option.value))
            }
            tabIndex={activeIndex === index ? 0 : -1}
            aria-disabled={option.disabled ? true : undefined}
            disabled={option.disabled}
            onFocus={() => setActiveIndex(index)}
            onMouseEnter={() => {
              if (!option.disabled) setActiveIndex(index)
            }}
            onClick={() => handleSelect(option)}
            className={cn(
              classes.option,
              option.disabled
                ? classes.optionDisabled
                : isSelected
                  ? classes.optionSelected
                  : classes.optionDefault
            )}
          >
            <span className="flex items-start justify-between gap-2.5">
              <span className="min-w-0 flex items-start gap-2.5">
                {option.icon && <span className="h-4 w-4 shrink-0 text-fg-2">{option.icon}</span>}
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.description && <span className={classes.description}>{option.description}</span>}
                </span>
              </span>
              <span className={cn('h-4 w-4 shrink-0', isSelected ? 'text-status-progress' : 'text-transparent')}>
                <Check className="h-4 w-4" />
              </span>
            </span>
          </button>
        )
      })}

      {footerAction && (
        <button
          type="button"
          title={footerAction.title}
          onClick={() => {
            if (footerAction.disabled) return
            footerAction.onClick()
            closeAndFocusTrigger()
          }}
          disabled={footerAction.disabled}
          className={cn(
            classes.footerAction,
            footerAction.danger ? classes.footerActionDanger : classes.footerActionDefault,
            footerAction.disabled && 'opacity-60 cursor-not-allowed'
          )}
        >
          <span className="flex items-center gap-2.5">
            {footerAction.icon && <span className="h-4 w-4 shrink-0">{footerAction.icon}</span>}
            <span>{footerAction.label}</span>
          </span>
        </button>
      )}
    </div>
  ) : null

  return (
    <div className={cn('inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={cn(classes.trigger, triggerClassName)}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={cn('min-w-0 flex flex-1 items-center gap-2 text-left', !selectedOption && 'text-fg-2')}>
          {selectedOption?.icon && <span className="h-4 w-4 shrink-0 text-fg-2">{selectedOption.icon}</span>}
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-fg-2 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {menuNode && (isMounted && typeof document !== 'undefined' ? createPortal(menuNode, document.body) : menuNode)}
    </div>
  )
}
