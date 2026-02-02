'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { DensityPreset } from '@savorg/ui/theme'
import { densityClasses } from '@savorg/ui/theme'

// ============================================================================
// TABLE TYPES
// ============================================================================

export interface Column<T> {
  key: string
  header: string | ReactNode
  width?: string
  align?: 'left' | 'center' | 'right'
  mono?: boolean
  render?: (row: T, index: number) => ReactNode
  sortable?: boolean
}

interface CanonicalTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  density?: DensityPreset
  onRowClick?: (row: T, index: number) => void
  selectedKey?: string
  emptyState?: ReactNode
  stickyHeader?: boolean
  className?: string
}

// ============================================================================
// CELL STYLES
// ============================================================================

// Canonical mono cell styling - consistent across all table uses
const monoCellClass = 'font-mono text-xs font-medium tracking-tight text-fg-1'
const textCellClass = 'text-[13px] text-fg-0'

// Row states - subtle visual hierarchy
const rowBaseClass = 'border-b border-white/[0.06] transition-colors duration-100'
const rowHoverClass = 'hover:bg-bg-2/70'
const rowSelectedClass = 'bg-bg-3/80 border-l-2 border-l-status-info'
const rowClickableClass = 'cursor-pointer'

// ============================================================================
// TABLE COMPONENT
// ============================================================================

export function CanonicalTable<T>({
  columns,
  rows,
  rowKey,
  density = 'compact',
  onRowClick,
  selectedKey,
  emptyState,
  stickyHeader = true,
  className,
}: CanonicalTableProps<T>) {
  const densityStyle = densityClasses[density]

  if (rows.length === 0 && emptyState) {
    return (
      <div className="flex items-center justify-center py-12 text-fg-2 text-sm">
        {emptyState}
      </div>
    )
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse">
        {/* Header */}
        <thead>
          <tr
            className={cn(
              stickyHeader && 'sticky top-0 z-10',
              'bg-bg-1 border-b border-white/[0.08]'
            )}
          >
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                className={cn(
                  'px-3 text-xs font-medium text-fg-2 whitespace-nowrap text-left',
                  densityStyle.row,
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center'
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        {/* Body */}
        <tbody className="relative">
          {rows.map((row, i) => {
            const key = rowKey(row, i)
            const isSelected = selectedKey === key

            return (
              <tr
                key={key}
                onClick={() => onRowClick?.(row, i)}
                className={cn(
                  rowBaseClass,
                  onRowClick && rowClickableClass,
                  isSelected ? rowSelectedClass : rowHoverClass
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3',
                      densityStyle.row,
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.mono ? monoCellClass : textCellClass
                    )}
                  >
                    {col.render
                      ? col.render(row, i)
                      : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// STACKED ROWS (for mobile/vertical)
// ============================================================================

interface StackedRowsProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  onRowClick?: (row: T, index: number) => void
  selectedKey?: string
  emptyState?: ReactNode
  className?: string
}

export function StackedRows<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  emptyState,
  className,
}: StackedRowsProps<T>) {
  if (rows.length === 0 && emptyState) {
    return (
      <div className="flex items-center justify-center py-12 text-fg-2 text-sm">
        {emptyState}
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      {rows.map((row, i) => {
        const key = rowKey(row, i)
        const isSelected = selectedKey === key

        return (
          <div
            key={key}
            onClick={() => onRowClick?.(row, i)}
            className={cn(
              'p-3 rounded-[var(--radius-lg)] border transition-colors duration-100',
              onRowClick && 'cursor-pointer',
              isSelected
                ? 'bg-bg-3/80 border-status-info/30 border-l-2 border-l-status-info'
                : 'bg-bg-2 border-white/[0.06] hover:bg-bg-3/50 hover:border-bd-1'
            )}
          >
            {columns.map((col) => (
              <div key={col.key} className="flex items-center justify-between py-1 min-w-0">
                <span className="text-xs text-fg-2 shrink-0 mr-3">{col.header}</span>
                <span className={cn('truncate', col.mono ? monoCellClass : textCellClass)}>
                  {col.render
                    ? col.render(row, i)
                    : String((row as Record<string, unknown>)[col.key] ?? '')}
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// RESPONSIVE TABLE (auto-switches between table and stacked)
// ============================================================================

interface ResponsiveTableProps<T> extends CanonicalTableProps<T> {
  stackBreakpoint?: number
}

export function ResponsiveTable<T>({
  stackBreakpoint: _stackBreakpoint = 768,
  ...props
}: ResponsiveTableProps<T>) {
  return (
    <>
      {/* Table view (hidden on narrow) */}
      <div className="hidden md:block">
        <CanonicalTable {...props} />
      </div>

      {/* Stacked view (shown on narrow) */}
      <div className="md:hidden">
        <StackedRows
          columns={props.columns}
          rows={props.rows}
          rowKey={props.rowKey}
          onRowClick={props.onRowClick}
          selectedKey={props.selectedKey}
          emptyState={props.emptyState}
        />
      </div>
    </>
  )
}
