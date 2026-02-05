'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { X, Bot, MessageSquare, Wrench, Settings, Radio, Shield, Loader2, Eye, Code } from 'lucide-react'
import { TypedConfirmModal } from '@clawcontrol/ui'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { ModalFrame } from '@/components/ui/modal'
import type { GraphNode, GraphNodeKind } from '@/lib/openclaw/live-graph'

interface NodeDetailDrawerProps {
  node: GraphNode
  onClose: () => void
}

const NODE_KIND_CONFIG: Record<GraphNodeKind, { label: string; icon: typeof Bot; color: string }> = {
  chat: { label: 'Chat Message', icon: MessageSquare, color: 'text-status-info' },
  session: { label: 'Agent Session', icon: Bot, color: 'text-status-success' },
  turn: { label: 'Agent Turn', icon: Radio, color: 'text-fg-2' },
  tool_call: { label: 'Tool Call', icon: Wrench, color: 'text-status-warning' },
  assistant: { label: 'Assistant Output', icon: Settings, color: 'text-status-progress' },
}

export function NodeDetailDrawer({ node, onClose }: NodeDetailDrawerProps) {
  const config = NODE_KIND_CONFIG[node.kind]
  const Icon = config.icon
  const [rawDetails, setRawDetails] = useState<object | null>(null)
  const [isLoadingRaw, setIsLoadingRaw] = useState(false)
  const protectedAction = useProtectedAction()

  const handleRequestRawDetails = () => {
    protectedAction.trigger({
      actionKind: 'action.danger',
      actionTitle: 'View Raw Event Details',
      actionDescription: `Request raw event data for node "${node.id}". This may expose sensitive information including tool arguments and message contents.`,
      onConfirm: async () => {
        setIsLoadingRaw(true)
        try {
          // Simulate fetching raw details (in real implementation, would call an API)
          // For now, expose the full node metadata
          await new Promise((resolve) => setTimeout(resolve, 500))
          setRawDetails({
            id: node.id,
            kind: node.kind,
            status: node.status,
            sessionId: node.sessionId,
            sessionKey: node.sessionKey,
            agentId: node.agentId,
            operationId: node.operationId,
            workOrderId: node.workOrderId,
            metadata: node.metadata,
            timestamps: {
              startedAt: node.startedAt.toISOString(),
              endedAt: node.endedAt?.toISOString() ?? null,
              lastActivity: node.lastActivity.toISOString(),
            },
            isPinned: node.isPinned,
          })
        } finally {
          setIsLoadingRaw(false)
        }
      },
    })
  }

  return (
    <ModalFrame open={true} onClose={onClose} width="default" contentClassName="max-w-xl bg-bg-2">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bd-0">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn('w-5 h-5 shrink-0', config.color)} />
          <span className="text-sm font-medium text-fg-0 truncate">{config.label}</span>
          <span className="text-xs text-fg-3 font-mono truncate">· {node.id}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-bg-3 text-fg-2 transition-colors shrink-0"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Status */}
        <Section title="Status">
          <StatusBadge status={node.status} />
        </Section>

        {/* Identifiers */}
        <Section title="Identifiers">
          <Field label="Node ID" value={node.id} mono />
          {node.sessionId && <Field label="Session ID" value={node.sessionId} mono />}
          {node.agentId && <Field label="Agent" value={node.agentId} />}
          {node.operationId && (
            <Field label="Operation" value={`op:${node.operationId.slice(0, 12)}...`} mono />
          )}
          {node.workOrderId && (
            <Field label="Work Order" value={`wo:${node.workOrderId.slice(0, 12)}...`} mono />
          )}
        </Section>

        {/* Session Key */}
        {node.sessionKey && (
          <Section title="Session Key">
            <div className="text-xs font-mono text-fg-2 break-all bg-bg-3/50 px-2 py-1.5 rounded-[var(--radius-sm)]">
              {node.sessionKey}
            </div>
          </Section>
        )}

        {/* Timestamps */}
        <Section title="Timestamps">
          <Field label="Started" value={formatTimestamp(node.startedAt)} />
          {node.endedAt && <Field label="Ended" value={formatTimestamp(node.endedAt)} />}
          <Field label="Last Activity" value={formatTimestamp(node.lastActivity)} />
        </Section>

        {/* Metadata (kind-specific) */}
        {node.kind === 'tool_call' && (
          <Section title="Tool Details">
            {node.metadata.toolName && <Field label="Tool Name" value={node.metadata.toolName} />}
            {node.metadata.durationMs !== undefined && (
              <Field label="Duration" value={`${node.metadata.durationMs}ms`} />
            )}
            {node.metadata.exitCode !== undefined && (
              <Field
                label="Exit Code"
                value={String(node.metadata.exitCode)}
                valueColor={node.metadata.exitCode === 0 ? 'text-status-success' : 'text-status-danger'}
              />
            )}
            <div className="mt-3 flex items-center gap-2 text-xs text-fg-3">
              <Shield className="w-3.5 h-3.5" />
              <span>Tool arguments are redacted by default</span>
            </div>
          </Section>
        )}

        {node.kind === 'chat' && (
          <Section title="Message Details">
            {node.metadata.channel && <Field label="Channel" value={node.metadata.channel} />}
            {node.metadata.messageId && <Field label="Message ID" value={node.metadata.messageId} mono />}
          </Section>
        )}

        {node.kind === 'session' && node.metadata.isSubagent && (
          <Section title="Session Type">
            <div className="px-2 py-1.5 text-xs font-medium rounded bg-status-info/10 text-status-info border border-status-info/20 inline-block">
              Subagent Session
            </div>
          </Section>
        )}

        {/* Pinned Status */}
        <Section title="Pin Status">
          <div className="text-xs text-fg-2">
            {node.isPinned ? 'This node is pinned and will not be evicted.' : 'This node may be evicted after TTL expires.'}
          </div>
        </Section>

        {/* Raw Details Button (Governor-Gated) */}
        <Section title="Advanced">
          {rawDetails ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Eye className="w-3.5 h-3.5 text-status-warning" />
                <span className="text-xs text-status-warning font-medium">Raw Details Exposed</span>
              </div>
              <div className="bg-bg-3/50 rounded-[var(--radius-md)] border border-bd-0 overflow-hidden">
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-bd-0 bg-bg-3">
                  <div className="flex items-center gap-1.5">
                    <Code className="w-3.5 h-3.5 text-fg-2" />
                    <span className="text-xs text-fg-2 font-medium">JSON</span>
                  </div>
                  <button
                    onClick={() => setRawDetails(null)}
                    className="text-xs text-fg-3 hover:text-fg-1"
                  >
                    Hide
                  </button>
                </div>
                <pre className="p-2 text-xs font-mono text-fg-1 overflow-auto max-h-[300px]">
                  {JSON.stringify(rawDetails, null, 2)}
                </pre>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-fg-3 mb-2">
                Raw event details require governor approval.
              </div>
              <button
                onClick={handleRequestRawDetails}
                disabled={isLoadingRaw}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-3 hover:bg-bd-1 rounded-[var(--radius-md)] border border-bd-0 text-fg-1 disabled:opacity-50"
              >
                {isLoadingRaw ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Shield className="w-3.5 h-3.5" />
                )}
                Request Raw Details
              </button>
            </>
          )}
        </Section>
      </div>

      {/* Confirm Modal */}
      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        riskLevel={protectedAction.riskLevel}
        workOrderCode={protectedAction.state.workOrderCode}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </ModalFrame>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-fg-2 uppercase tracking-wide mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Field({
  label,
  value,
  mono = false,
  valueColor,
}: {
  label: string
  value: string
  mono?: boolean
  valueColor?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-fg-3">{label}</span>
      <span
        className={cn(
          'text-xs truncate max-w-[200px]',
          mono ? 'font-mono' : '',
          valueColor || 'text-fg-1'
        )}
      >
        {value}
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: GraphNode['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-[var(--radius-sm)]',
        status === 'active' && 'bg-status-success/10 text-status-success',
        status === 'completed' && 'bg-status-info/10 text-status-info',
        status === 'failed' && 'bg-status-danger/10 text-status-danger'
      )}
    >
      {status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />}
      {status}
    </span>
  )
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
