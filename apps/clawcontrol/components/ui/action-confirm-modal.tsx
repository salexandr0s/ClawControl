'use client'

import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@clawcontrol/ui'
import { Modal, type ModalWidth } from '@/components/ui/modal'

interface ActionConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  notice?: ReactNode
  details?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  isLoading?: boolean
  intent?: 'danger' | 'warning'
  width?: ModalWidth
  showCloseButton?: boolean
}

export function ActionConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  notice,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isLoading = false,
  intent = 'danger',
  width = 'default',
  showCloseButton = true,
}: ActionConfirmModalProps) {
  const intentClasses = intent === 'danger'
    ? 'border-status-danger/30 bg-status-danger/10 text-status-danger'
    : 'border-status-warning/30 bg-status-warning/10 text-status-warning'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={width}
      showCloseButton={showCloseButton && !isLoading}
      bodyClassName="space-y-4"
    >
      {notice && (
        <div className={`rounded-[var(--radius-md)] border p-3 ${intentClasses}`}>
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>{notice}</div>
          </div>
        </div>
      )}

      {details}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={isLoading}
          onClick={onClose}
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={intent === 'danger' ? 'danger' : 'primary'}
          size="md"
          disabled={isLoading}
          onClick={onConfirm}
        >
          {isLoading ? 'Processing...' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
