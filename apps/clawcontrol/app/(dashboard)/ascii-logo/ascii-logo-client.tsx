'use client'

import { useMemo, useState } from 'react'
import { Button, PageHeader, SegmentedToggle } from '@clawcontrol/ui'
import { RotateCcw } from 'lucide-react'
import { AsciiLogoViewer, type AsciiDensity } from './ascii-logo-viewer'

type Toggle = 'on' | 'off'

export function AsciiLogoClient() {
  const [density, setDensity] = useState<AsciiDensity>('normal')
  const [invert, setInvert] = useState<Toggle>('on')
  const [autoRotate, setAutoRotate] = useState<Toggle>('on')
  const [resetNonce, setResetNonce] = useState(0)

  const subtitle = useMemo(() => {
    const drag = 'Drag to rotate'
    const zoom = 'Scroll to zoom'
    const reset = 'Reset restores the default view'
    return `${drag} • ${zoom} • ${reset}`
  }, [])

  return (
    <div className="flex flex-col gap-3 min-h-[calc(100dvh-var(--topbar-height)-1.5rem)] sm:min-h-[calc(100dvh-var(--topbar-height)-2rem)]">
      <PageHeader
        title="ASCII Logo"
        subtitle={subtitle}
        actions={(
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setResetNonce((n) => n + 1)}
            title="Reset the camera + logo orientation"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedToggle
          ariaLabel="ASCII density"
          value={density}
          onChange={setDensity}
          items={[
            { value: 'fine', label: 'Fine' },
            { value: 'normal', label: 'Normal' },
            { value: 'chunky', label: 'Chunky' },
          ]}
        />

        <SegmentedToggle
          ariaLabel="Invert brightness"
          value={invert}
          onChange={setInvert}
          items={[
            { value: 'on', label: 'Invert' },
            { value: 'off', label: 'Normal' },
          ]}
        />

        <SegmentedToggle
          ariaLabel="Auto rotate"
          value={autoRotate}
          onChange={setAutoRotate}
          items={[
            { value: 'on', label: 'Auto' },
            { value: 'off', label: 'Manual' },
          ]}
        />
      </div>

      <AsciiLogoViewer
        className="flex-1"
        src="/images/logo-icon.png"
        density={density}
        invert={invert === 'on'}
        autoRotate={autoRotate === 'on'}
        resetNonce={resetNonce}
      />
    </div>
  )
}

