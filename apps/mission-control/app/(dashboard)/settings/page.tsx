'use client'

import { useLayout, type LayoutMode } from '@/lib/layout-context'
import { cn } from '@/lib/utils'
import { Monitor, Smartphone, Maximize2, Check } from 'lucide-react'

export default function SettingsPage() {
  const { mode, setMode, resolved } = useLayout()

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-fg-0">Settings</h1>
        <p className="text-sm text-fg-2 mt-1">Configure Mission Control preferences</p>
      </div>

      {/* Layout Mode Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Layout Mode</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Choose how the interface adapts to your display
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <LayoutModeCard
            mode="auto"
            label="Auto"
            description="Adapts based on screen aspect ratio"
            icon={Maximize2}
            selected={mode === 'auto'}
            onSelect={() => setMode('auto')}
          />
          <LayoutModeCard
            mode="horizontal"
            label="Horizontal"
            description="Optimized for wide monitors"
            icon={Monitor}
            selected={mode === 'horizontal'}
            onSelect={() => setMode('horizontal')}
          />
          <LayoutModeCard
            mode="vertical"
            label="Vertical"
            description="Optimized for portrait displays"
            icon={Smartphone}
            selected={mode === 'vertical'}
            onSelect={() => setMode('vertical')}
          />
        </div>

        <p className="text-xs text-fg-3">
          Current resolved layout: <span className="font-mono text-fg-2">{resolved}</span>
        </p>
      </section>

      {/* Theme Section (placeholder) */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Theme</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            Visual appearance settings
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ThemeCard
            label="Ops Dark"
            description="High contrast for extended monitoring"
            selected={true}
          />
          <ThemeCard
            label="Ops Dim"
            description="Lower contrast for comfortable viewing"
            selected={false}
            disabled
          />
        </div>
      </section>

      {/* Density Section (placeholder) */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-fg-0">Display Density</h2>
          <p className="text-xs text-fg-2 mt-0.5">
            How compact the interface should be
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DensityCard
            label="Compact"
            description="More information per screen"
            selected={true}
          />
          <DensityCard
            label="Default"
            description="More breathing room"
            selected={false}
          />
        </div>
      </section>
    </div>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function LayoutModeCard({
  label,
  description,
  icon: Icon,
  selected,
  onSelect,
}: {
  mode?: LayoutMode
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex flex-col items-start p-4 rounded-[var(--radius-lg)] border transition-all text-left',
        selected
          ? 'bg-bg-3 border-status-info/50 ring-1 ring-status-info/20'
          : 'bg-bg-2 border-white/[0.06] hover:border-bd-1 hover:bg-bg-3/50'
      )}
    >
      <div className="flex items-center justify-between w-full mb-2">
        <Icon className={cn('w-5 h-5', selected ? 'text-status-info' : 'text-fg-2')} />
        {selected && <Check className="w-4 h-4 text-status-info" />}
      </div>
      <span className={cn('text-sm font-medium', selected ? 'text-fg-0' : 'text-fg-1')}>
        {label}
      </span>
      <span className="text-xs text-fg-2 mt-0.5">{description}</span>
    </button>
  )
}

function ThemeCard({
  label,
  description,
  selected,
  disabled,
}: {
  label: string
  description: string
  selected: boolean
  disabled?: boolean
}) {
  return (
    <button
      disabled={disabled}
      className={cn(
        'flex items-center justify-between p-4 rounded-[var(--radius-lg)] border transition-all text-left',
        selected
          ? 'bg-bg-3 border-status-info/50'
          : 'bg-bg-2 border-white/[0.06]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div>
        <span className={cn('text-sm font-medium', selected ? 'text-fg-0' : 'text-fg-1')}>
          {label}
        </span>
        <p className="text-xs text-fg-2 mt-0.5">{description}</p>
      </div>
      {selected && <Check className="w-4 h-4 text-status-info shrink-0" />}
    </button>
  )
}

function DensityCard({
  label,
  description,
  selected,
}: {
  label: string
  description: string
  selected: boolean
}) {
  return (
    <button
      className={cn(
        'flex items-center justify-between p-4 rounded-[var(--radius-lg)] border transition-all text-left',
        selected
          ? 'bg-bg-3 border-status-info/50'
          : 'bg-bg-2 border-white/[0.06] hover:border-bd-1 hover:bg-bg-3/50'
      )}
    >
      <div>
        <span className={cn('text-sm font-medium', selected ? 'text-fg-0' : 'text-fg-1')}>
          {label}
        </span>
        <p className="text-xs text-fg-2 mt-0.5">{description}</p>
      </div>
      {selected && <Check className="w-4 h-4 text-status-info shrink-0" />}
    </button>
  )
}
