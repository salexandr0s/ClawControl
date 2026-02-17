'use client'

import { Modal } from '@/components/ui/modal'
import { Button } from '@clawcontrol/ui'
import { ExternalLink } from 'lucide-react'

export type WhatsNewSection = {
  title: string
  items: string[]
}

export type WhatsNewPayload = {
  version: string
  title: string
  publishedAt: string | null
  highlights: string[]
  sections?: WhatsNewSection[]
  releaseUrl: string
}

export function WhatsNewModal(props: {
  open: boolean
  payload: WhatsNewPayload | null
  onClose: () => void
  onOpenRelease: () => void
}) {
  if (!props.open || !props.payload) return null

  const publishedLabel = props.payload.publishedAt
    ? new Date(props.payload.publishedAt).toLocaleString()
    : null
  const sections = props.payload.sections && props.payload.sections.length > 0
    ? props.payload.sections
    : [{
        title: 'Highlights',
        items: props.payload.highlights,
      }]

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={`What’s New • v${props.payload.version}`}
      description={props.payload.title}
    >
      <div className="space-y-4">
        {publishedLabel ? (
          <div className="text-xs text-fg-2 font-mono">Published: {publishedLabel}</div>
        ) : null}

        <div className="space-y-3">
          {sections.slice(0, 4).map((section, sectionIndex) => (
            <div
              key={`${sectionIndex}-${section.title}`}
              className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 p-4"
            >
              <div className="text-[11px] uppercase tracking-wide text-fg-2 mb-2">{section.title}</div>
              <ul className="list-disc pl-5 space-y-1 text-sm text-fg-1">
                {section.items.slice(0, 8).map((line, itemIndex) => (
                  <li key={`${sectionIndex}-${itemIndex}-${line.slice(0, 24)}`}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={props.onOpenRelease}>
            <ExternalLink className="w-3.5 h-3.5" />
            Open Release
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}
