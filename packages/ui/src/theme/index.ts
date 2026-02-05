/**
 * Theme tokens and utilities
 *
 * Canonical color, spacing, and typography definitions for clawcontrol
 */

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes with conflict resolution
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ============================================================================
// STATUS TONES
// ============================================================================

/**
 * Status tone types for semantic colors
 */
export type StatusTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'progress'
  | 'idle'
  | 'muted'

/**
 * Map status tones to Tailwind classes
 */
export const statusToneClasses: Record<
  StatusTone,
  { text: string; bg: string; border: string; icon: string }
> = {
  success: {
    text: 'text-status-success',
    bg: 'status-bg-success',
    border: 'border-bd-0',
    icon: 'text-status-success',
  },
  warning: {
    text: 'text-status-warning',
    bg: 'status-bg-warning',
    border: 'border-bd-0',
    icon: 'text-status-warning',
  },
  danger: {
    text: 'text-status-danger',
    bg: 'status-bg-danger',
    border: 'border-bd-0',
    icon: 'text-status-danger',
  },
  info: {
    text: 'text-status-info',
    bg: 'status-bg-info',
    border: 'border-bd-0',
    icon: 'text-status-info',
  },
  progress: {
    text: 'text-status-progress',
    bg: 'status-bg-progress',
    border: 'border-bd-0',
    icon: 'text-status-progress',
  },
  idle: {
    text: 'text-status-idle',
    bg: 'status-bg-idle',
    border: 'border-bd-0',
    icon: 'text-status-idle',
  },
  muted: {
    text: 'text-fg-2',
    bg: 'bg-bg-3',
    border: 'border-bd-0',
    icon: 'text-fg-3',
  },
}

// ============================================================================
// WORK ORDER & OPERATION STATUS MAPPINGS
// ============================================================================

export type WorkOrderState =
  | 'planned'
  | 'active'
  | 'blocked'
  | 'review'
  | 'shipped'
  | 'cancelled'

export type OperationStatus =
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'rework'

export type GatewayHealth = 'ok' | 'degraded' | 'down' | 'unknown'

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

/**
 * Map Work Order states to status tones
 */
export const workOrderStateTone: Record<WorkOrderState, StatusTone> = {
  planned: 'idle',
  active: 'progress',
  blocked: 'danger',
  review: 'warning',
  shipped: 'success',
  cancelled: 'muted',
}

/**
 * Map Operation statuses to status tones
 */
export const operationStatusTone: Record<OperationStatus, StatusTone> = {
  todo: 'idle',
  in_progress: 'progress',
  blocked: 'danger',
  review: 'warning',
  done: 'success',
  rework: 'warning',
}

/**
 * Map Gateway health to status tones
 */
export const gatewayHealthTone: Record<GatewayHealth, StatusTone> = {
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
  unknown: 'muted',
}

/**
 * Map Priority to status tones
 */
export const priorityTone: Record<Priority, StatusTone> = {
  P0: 'danger',
  P1: 'warning',
  P2: 'info',
  P3: 'idle',
}

/**
 * Human-readable labels for states
 */
export const workOrderStateLabel: Record<WorkOrderState, string> = {
  planned: 'Planned',
  active: 'Active',
  blocked: 'Blocked',
  review: 'Review',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
}

export const operationStatusLabel: Record<OperationStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
  rework: 'Rework',
}

// ============================================================================
// DENSITY
// ============================================================================

export type DensityPreset = 'compact' | 'default'

export const densityClasses: Record<
  DensityPreset,
  { row: string; padding: string; gap: string; text: string }
> = {
  compact: {
    row: 'h-8',
    padding: 'p-2',
    gap: 'gap-2',
    text: 'text-xs',
  },
  default: {
    row: 'h-9',
    padding: 'p-3',
    gap: 'gap-3',
    text: 'text-sm',
  },
}

// ============================================================================
// LAYOUT
// ============================================================================

export type LayoutMode = 'auto' | 'horizontal' | 'vertical'

export const layoutBreakpoints = {
  railCollapse: 1200,
  drawerFullscreen: 1000,
  verticalMode: 900,
} as const

// ============================================================================
// TYPOGRAPHY
// ============================================================================

export const typography = {
  pageTitle: 'text-xl font-semibold leading-tight',
  sectionTitle: 'text-sm font-semibold leading-snug',
  body: 'text-[13px] leading-relaxed',
  caption: 'text-xs leading-snug text-fg-1',
  monoSm: 'font-mono text-xs font-medium tracking-tight',
  monoMd: 'font-mono text-[13px] font-medium tracking-tight',
} as const

// ============================================================================
// SPACING
// ============================================================================

export const spacing = {
  unit: 8,
  page: 16,
  panel: 12,
  card: 12,
} as const
