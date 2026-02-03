'use client'

import { cn } from '@/lib/utils'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { ModelBadge } from '@/components/ui/model-badge'
import { StatusPill } from '@/components/ui/status-pill'
import { FileCode, Zap, MessageSquare, Settings, Clock } from 'lucide-react'
import type { AgentDTO, SkillDTO } from '@/lib/repo'
import type { StatusTone } from '@savorg/ui/theme'

interface AgentCardProps {
  agent: AgentDTO
  skills?: SkillDTO[]
  selected?: boolean
  onClick?: () => void
  onProvision?: () => void
  onTest?: () => void
  onEditFile?: (fileName: string) => void
}

const STATUS_TONES: Record<string, StatusTone> = {
  active: 'success',
  idle: 'muted',
  blocked: 'warning',
  error: 'danger',
}

function formatRelativeTime(date: Date | string | null): string {
  if (!date) return 'Never'
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  return `${diffDay}d ago`
}

export function AgentCard({
  agent,
  skills = [],
  selected,
  onClick,
  onProvision,
  onTest,
  onEditFile,
}: AgentCardProps) {
  // Get enabled capabilities
  const enabledCapabilities = Object.entries(agent.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-bg-2 border rounded-[var(--radius-lg)] p-4 cursor-pointer transition-all',
        selected
          ? 'border-status-progress/50 ring-1 ring-status-progress/20'
          : 'border-white/[0.06] hover:border-white/[0.12]'
      )}
    >
      {/* Header: Avatar, Name, Status, Model */}
      <div className="flex items-start gap-3 mb-3">
        <AgentAvatar
          agentId={agent.id}
          name={agent.name}
          size="xl"
          showStatus
          status={agent.status}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-fg-0 truncate">{agent.name}</h3>
            <StatusPill tone={STATUS_TONES[agent.status]} label={agent.status} />
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 text-xs bg-bg-3 rounded text-fg-1">{agent.station}</span>
            <ModelBadge modelId={agent.model} size="sm" />
          </div>
          <p className="text-xs text-fg-2 line-clamp-2">{agent.role}</p>
        </div>
      </div>

      {/* Last Seen */}
      <div className="flex items-center gap-1.5 text-xs text-fg-3 mb-3">
        <Clock className="w-3 h-3" />
        <span>Last seen {formatRelativeTime(agent.lastSeenAt)}</span>
      </div>

      {/* Capabilities */}
      {enabledCapabilities.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wide text-fg-3 mb-1.5">Capabilities</div>
          <div className="flex flex-wrap gap-1">
            {enabledCapabilities.slice(0, 6).map((cap) => (
              <span
                key={cap}
                className="px-1.5 py-0.5 text-[10px] bg-bg-3 rounded text-fg-2"
              >
                {cap.replace(/_/g, ' ')}
              </span>
            ))}
            {enabledCapabilities.length > 6 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-bg-3 rounded text-fg-3">
                +{enabledCapabilities.length - 6}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wide text-fg-3 mb-1.5">Skills</div>
          <div className="flex flex-wrap gap-1">
            {skills.slice(0, 4).map((skill) => (
              <span
                key={skill.id}
                className={cn(
                  'px-1.5 py-0.5 text-[10px] rounded',
                  skill.enabled
                    ? 'bg-status-success/10 text-status-success'
                    : 'bg-bg-3 text-fg-3'
                )}
              >
                {skill.name}
              </span>
            ))}
            {skills.length > 4 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-bg-3 rounded text-fg-3">
                +{skills.length - 4}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Files */}
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide text-fg-3 mb-1.5">Files</div>
        <div className="flex gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEditFile?.(`${agent.name}.soul.md`)
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-bg-3 hover:bg-bd-1 rounded text-fg-2 transition-colors"
          >
            <FileCode className="w-3 h-3" />
            soul.md
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEditFile?.(`${agent.name}.md`)
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-bg-3 hover:bg-bd-1 rounded text-fg-2 transition-colors"
          >
            <Settings className="w-3 h-3" />
            overlay.md
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-white/[0.06]">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onProvision?.()
          }}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium bg-status-warning/10 hover:bg-status-warning/20 text-status-warning rounded-[var(--radius-md)] transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          Provision
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onTest?.()
          }}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium bg-status-progress/10 hover:bg-status-progress/20 text-status-progress rounded-[var(--radius-md)] transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Test
        </button>
      </div>
    </div>
  )
}
