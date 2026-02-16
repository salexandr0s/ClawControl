'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, TypedConfirmModal, Button, SelectDropdown } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { RightDrawer } from '@/components/shell/right-drawer'
import { Modal } from '@/components/ui/modal'
import { ImportPackageModal } from '@/components/packages/import-package-modal'
import {
  agentsApi,
  agentTeamsApi,
  packagesApi,
  templatesApi,
  workflowsApi,
  type AgentTeamSummary,
  type TeamHierarchyConfig,
  type TeamInstantiateAgentsResult,
  type TemplateSummary,
  type WorkflowListItem,
} from '@/lib/http'
import type { AgentDTO } from '@/lib/repo'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import { Download, Info, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'

const teamColumns: Column<AgentTeamSummary>[] = [
  {
    key: 'name',
    header: 'Team',
    width: '220px',
    render: (row) => (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-status-success" />
        <span className="text-fg-0">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'source',
    header: 'Source',
    width: '90px',
    mono: true,
    render: (row) => row.source,
  },
  {
    key: 'memberCount',
    header: 'Members',
    width: '70px',
    align: 'center',
    mono: true,
    render: (row) => row.memberCount,
  },
  {
    key: 'workflowIds',
    header: 'Workflows',
    width: '80px',
    align: 'center',
    mono: true,
    render: (row) => row.workflowIds.length,
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: '100px',
    align: 'right',
    render: (row) => <span className="text-xs text-fg-2">{new Date(row.updatedAt).toLocaleDateString()}</span>,
  },
]

interface TeamEditorDraft {
  id?: string
  name: string
  description: string
  workflowIds: string[]
  templateIds: string[]
}

type TeamHierarchyMember = TeamHierarchyConfig['members'][string]

const TEAM_CAPABILITY_KEYS = [
  'canDelegate',
  'canSendMessages',
  'canExecuteCode',
  'canModifyFiles',
  'canWebSearch',
] as const

type TeamCapabilityKey = (typeof TEAM_CAPABILITY_KEYS)[number]

function emptyHierarchyMember(): TeamHierarchyMember {
  return {
    reportsTo: null,
    delegatesTo: [],
    receivesFrom: [],
    canMessage: [],
    capabilities: {},
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}

function normalizeHierarchyForTemplateIds(
  hierarchy: TeamHierarchyConfig | null | undefined,
  templateIds: string[]
): TeamHierarchyConfig {
  const ids = dedupe(templateIds).sort((left, right) => left.localeCompare(right))
  const members: TeamHierarchyConfig['members'] = {}

  for (const templateId of ids) {
    const source = hierarchy?.members?.[templateId]
    const next = source ? {
      reportsTo: typeof source.reportsTo === 'string' && source.reportsTo.trim() ? source.reportsTo.trim() : null,
      delegatesTo: dedupe(source.delegatesTo ?? []).sort((left, right) => left.localeCompare(right)),
      receivesFrom: dedupe(source.receivesFrom ?? []).sort((left, right) => left.localeCompare(right)),
      canMessage: dedupe(source.canMessage ?? []).sort((left, right) => left.localeCompare(right)),
      capabilities: {
        ...(typeof source.capabilities.canDelegate === 'boolean' ? { canDelegate: source.capabilities.canDelegate } : {}),
        ...(typeof source.capabilities.canSendMessages === 'boolean' ? { canSendMessages: source.capabilities.canSendMessages } : {}),
        ...(typeof source.capabilities.canExecuteCode === 'boolean' ? { canExecuteCode: source.capabilities.canExecuteCode } : {}),
        ...(typeof source.capabilities.canModifyFiles === 'boolean' ? { canModifyFiles: source.capabilities.canModifyFiles } : {}),
        ...(typeof source.capabilities.canWebSearch === 'boolean' ? { canWebSearch: source.capabilities.canWebSearch } : {}),
      },
    } : emptyHierarchyMember()
    members[templateId] = next
  }

  return { version: 1, members }
}

function validateHierarchyDraft(
  hierarchy: TeamHierarchyConfig,
  templateIds: string[]
): string[] {
  const errors: string[] = []
  const ids = dedupe(templateIds)
  const idSet = new Set(ids)

  for (const key of Object.keys(hierarchy.members)) {
    if (!idSet.has(key)) {
      errors.push(`Member "${key}" is not in templateIds`)
    }
  }

  for (const templateId of ids) {
    const member = hierarchy.members[templateId]
    if (!member) {
      errors.push(`Missing hierarchy member for "${templateId}"`)
      continue
    }

    if (member.reportsTo && !idSet.has(member.reportsTo)) {
      errors.push(`${templateId}: reportsTo "${member.reportsTo}" is not in templateIds`)
    }
    if (member.reportsTo === templateId) {
      errors.push(`${templateId}: reportsTo cannot reference itself`)
    }

    const validateTargets = (relation: string, targets: string[]) => {
      for (const target of targets) {
        if (target === templateId) {
          errors.push(`${templateId}: ${relation} cannot include itself`)
          continue
        }
        if (!idSet.has(target)) {
          errors.push(`${templateId}: ${relation} target "${target}" is not in templateIds`)
        }
      }
    }
    validateTargets('delegatesTo', member.delegatesTo)
    validateTargets('receivesFrom', member.receivesFrom)
    validateTargets('canMessage', member.canMessage)

    if (member.capabilities.canDelegate === false && member.delegatesTo.length > 0) {
      errors.push(`${templateId}: canDelegate=false requires delegatesTo to be empty`)
    }
    if (member.capabilities.canSendMessages === false && member.canMessage.length > 0) {
      errors.push(`${templateId}: canSendMessages=false requires canMessage to be empty`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  const visit = (templateId: string): boolean => {
    if (visiting.has(templateId)) {
      const idx = stack.lastIndexOf(templateId)
      const cycle = idx === -1 ? [templateId] : stack.slice(idx).concat(templateId)
      errors.push(`reportsTo cycle detected: ${cycle.join(' -> ')}`)
      return true
    }
    if (visited.has(templateId)) return false
    visiting.add(templateId)
    stack.push(templateId)
    const parent = hierarchy.members[templateId]?.reportsTo
    if (parent && hierarchy.members[parent] && visit(parent)) return true
    stack.pop()
    visiting.delete(templateId)
    visited.add(templateId)
    return false
  }

  for (const templateId of ids) {
    if (visit(templateId)) break
  }

  return errors
}

type TeamHierarchyChartNodeKind = 'operator' | 'main' | 'team'

interface TeamHierarchyChartNode {
  id: string
  kind: TeamHierarchyChartNodeKind
  title: string
  subtitle: string
  status: string
  templateId: string | null
  materialized: boolean
}

interface TeamHierarchyChartEdge {
  id: string
  from: string
  to: string
}

interface TeamHierarchyChartData {
  nodes: TeamHierarchyChartNode[]
  edges: TeamHierarchyChartEdge[]
  levels: string[][]
}

interface TeamHierarchyChartLayout {
  width: number
  height: number
  nodeWidth: number
  nodeHeight: number
  positions: Map<string, { x: number; y: number }>
}

function humanizeTemplateId(templateId: string): string {
  const normalized = templateId
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return templateId
  return normalized.replace(/\b[a-z]/g, (match) => match.toUpperCase())
}

function buildTeamHierarchyChartData(
  team: AgentTeamSummary,
  hierarchy: TeamHierarchyConfig | null,
  mainAgent: AgentDTO | null
): TeamHierarchyChartData {
  const operatorNodeId = 'operator:user'
  const mainNodeId = 'agent:main'

  const templateIds = dedupe(team.templateIds).sort((left, right) => left.localeCompare(right))
  const templateSet = new Set(templateIds)

  const membersByTemplateId = new Map<string, AgentTeamSummary['members'][number]>()
  for (const member of team.members) {
    if (member.templateId && templateSet.has(member.templateId)) {
      membersByTemplateId.set(member.templateId, member)
      continue
    }
    if (templateSet.has(member.slug) && !membersByTemplateId.has(member.slug)) {
      membersByTemplateId.set(member.slug, member)
    }
  }

  const nodes: TeamHierarchyChartNode[] = [
    {
      id: operatorNodeId,
      kind: 'operator',
      title: 'You',
      subtitle: 'Human Operator',
      status: 'online',
      templateId: null,
      materialized: true,
    },
    {
      id: mainNodeId,
      kind: 'main',
      title: mainAgent?.displayName?.trim() || 'Main Agent',
      subtitle: mainAgent ? `${mainAgent.role} · ${mainAgent.station}` : 'Core CEO Agent',
      status: mainAgent?.status ?? 'core',
      templateId: null,
      materialized: Boolean(mainAgent),
    },
  ]

  const edges: TeamHierarchyChartEdge[] = [
    {
      id: `${operatorNodeId}->${mainNodeId}`,
      from: operatorNodeId,
      to: mainNodeId,
    },
  ]

  for (const templateId of templateIds) {
    const runtimeMember = membersByTemplateId.get(templateId)
    nodes.push({
      id: `template:${templateId}`,
      kind: 'team',
      title: runtimeMember?.displayName?.trim() || humanizeTemplateId(templateId),
      subtitle: runtimeMember
        ? `${templateId} · ${runtimeMember.role}`
        : `${templateId} template`,
      status: runtimeMember?.status ?? 'template',
      templateId,
      materialized: Boolean(runtimeMember),
    })
  }

  for (const templateId of templateIds) {
    const parentTemplateId = hierarchy?.members?.[templateId]?.reportsTo
    const parentId = parentTemplateId && templateSet.has(parentTemplateId)
      ? `template:${parentTemplateId}`
      : mainNodeId

    edges.push({
      id: `${parentId}->template:${templateId}`,
      from: parentId,
      to: `template:${templateId}`,
    })
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  const childrenByParent = new Map<string, string[]>()
  for (const edge of edges) {
    const bucket = childrenByParent.get(edge.from) ?? []
    bucket.push(edge.to)
    childrenByParent.set(edge.from, bucket)
  }
  for (const [parentId, childIds] of childrenByParent.entries()) {
    childIds.sort((left, right) => {
      const leftNode = nodeById.get(left)
      const rightNode = nodeById.get(right)
      if (!leftNode || !rightNode) return left.localeCompare(right)
      return leftNode.title.localeCompare(rightNode.title)
    })
    childrenByParent.set(parentId, childIds)
  }

  const levels: string[][] = []
  const visited = new Set<string>()
  let frontier = [operatorNodeId]

  while (frontier.length > 0) {
    levels.push(frontier)
    const next = new Set<string>()
    for (const nodeId of frontier) {
      visited.add(nodeId)
      for (const childId of childrenByParent.get(nodeId) ?? []) {
        if (!visited.has(childId)) next.add(childId)
      }
    }
    frontier = Array.from(next)
  }

  const leftovers = nodes
    .map((node) => node.id)
    .filter((nodeId) => !visited.has(nodeId))
    .sort((left, right) => {
      const leftNode = nodeById.get(left)
      const rightNode = nodeById.get(right)
      if (!leftNode || !rightNode) return left.localeCompare(right)
      return leftNode.title.localeCompare(rightNode.title)
    })

  if (leftovers.length > 0) {
    levels.push(leftovers)
  }

  return { nodes, edges, levels }
}

function buildTeamHierarchyChartLayout(
  levels: string[][],
  viewportWidth: number
): TeamHierarchyChartLayout {
  const nodeHeight = 74
  const minNodeWidth = 124
  const maxNodeWidth = 180
  const horizontalGap = 12
  const verticalGap = 24
  const padding = 16
  const safeViewport = Math.max(360, viewportWidth || 840)

  const maxColumns = Math.max(
    1,
    Math.min(
      6,
      Math.floor((safeViewport - (padding * 2) + horizontalGap) / (minNodeWidth + horizontalGap))
    )
  )

  const visualLevels: string[][] = []
  for (const level of levels) {
    if (level.length === 0) continue
    for (let offset = 0; offset < level.length; offset += maxColumns) {
      visualLevels.push(level.slice(offset, offset + maxColumns))
    }
  }

  if (visualLevels.length === 0) {
    visualLevels.push([])
  }

  const widestRowSize = Math.max(1, ...visualLevels.map((row) => row.length))
  const autoWidth = Math.floor(
    (safeViewport - (padding * 2) - (widestRowSize - 1) * horizontalGap) / widestRowSize
  )
  const nodeWidth = Math.max(minNodeWidth, Math.min(maxNodeWidth, autoWidth))
  const width = Math.max(
    safeViewport,
    (padding * 2) + (widestRowSize * nodeWidth) + ((widestRowSize - 1) * horizontalGap)
  )
  const height = Math.max(
    180,
    (padding * 2) + (visualLevels.length * nodeHeight) + Math.max(0, visualLevels.length - 1) * verticalGap
  )

  const positions = new Map<string, { x: number; y: number }>()
  visualLevels.forEach((row, rowIndex) => {
    const rowWidth = row.length === 0
      ? 0
      : (row.length * nodeWidth) + ((row.length - 1) * horizontalGap)
    const rowStartX = row.length === 0
      ? width / 2
      : (width - rowWidth) / 2 + (nodeWidth / 2)
    const y = padding + (nodeHeight / 2) + rowIndex * (nodeHeight + verticalGap)

    row.forEach((nodeId, colIndex) => {
      const x = rowStartX + colIndex * (nodeWidth + horizontalGap)
      positions.set(nodeId, { x, y })
    })
  })

  return { width, height, nodeWidth, nodeHeight, positions }
}

function TeamHierarchyOrgChart({
  team,
  hierarchy,
  mainAgent,
}: {
  team: AgentTeamSummary
  hierarchy: TeamHierarchyConfig | null
  mainAgent: AgentDTO | null
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [viewportWidth, setViewportWidth] = useState(840)

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const updateViewportWidth = () => {
      setViewportWidth(Math.max(360, Math.floor(element.clientWidth)))
    }
    updateViewportWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportWidth)
      return () => window.removeEventListener('resize', updateViewportWidth)
    }

    const observer = new ResizeObserver(() => updateViewportWidth())
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const chartData = useMemo(
    () => buildTeamHierarchyChartData(team, hierarchy, mainAgent),
    [team, hierarchy, mainAgent]
  )

  const layout = useMemo(
    () => buildTeamHierarchyChartLayout(chartData.levels, viewportWidth),
    [chartData.levels, viewportWidth]
  )

  const statusClassName = (status: string) => {
    if (status === 'active') return 'bg-status-success/15 text-status-success'
    if (status === 'idle') return 'bg-bg-3 text-fg-2'
    if (status === 'blocked' || status === 'error') return 'bg-status-danger/15 text-status-danger'
    if (status === 'template') return 'bg-status-warning/15 text-status-warning'
    if (status === 'online') return 'bg-status-progress/15 text-status-progress'
    return 'bg-bg-3 text-fg-2'
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-fg-2">Corporate Structure</div>
        <div className="text-[11px] text-fg-3">{team.templateIds.length} team positions</div>
      </div>

      <div ref={viewportRef} className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-2/80 p-2">
        <div className="overflow-x-auto overflow-y-hidden">
          <div style={{ width: layout.width, height: layout.height }} className="relative mx-auto">
            <svg className="absolute inset-0" width={layout.width} height={layout.height}>
              <defs>
                <marker
                  id="team-hierarchy-arrow"
                  markerWidth="7"
                  markerHeight="5"
                  refX="6"
                  refY="2.5"
                  orient="auto"
                >
                  <path d="M0,0 L7,2.5 L0,5 Z" fill="#64748b" />
                </marker>
              </defs>

              {chartData.edges.map((edge) => {
                const from = layout.positions.get(edge.from)
                const to = layout.positions.get(edge.to)
                if (!from || !to) return null

                const startX = from.x
                const startY = from.y + layout.nodeHeight / 2
                const endX = to.x
                const endY = to.y - layout.nodeHeight / 2
                const bend = Math.max(18, Math.abs(endY - startY) * 0.45)
                const c1x = startX
                const c1y = startY + bend
                const c2x = endX
                const c2y = endY - bend

                return (
                  <path
                    key={edge.id}
                    d={`M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`}
                    fill="none"
                    stroke="#64748b"
                    strokeOpacity={0.85}
                    strokeWidth={1.8}
                    markerEnd="url(#team-hierarchy-arrow)"
                  />
                )
              })}
            </svg>

            {chartData.nodes.map((node) => {
              const position = layout.positions.get(node.id)
              if (!position) return null

              const nodeTypeLabel = node.kind === 'operator'
                ? 'User'
                : node.kind === 'main'
                  ? 'Main Agent'
                  : 'Team Agent'

              const baseClassName = node.kind === 'operator'
                ? 'border-status-progress/40 bg-status-progress/10'
                : node.kind === 'main'
                  ? 'border-status-warning/45 bg-status-warning/10'
                  : node.materialized
                    ? 'border-bd-0 bg-bg-1'
                    : 'border-bd-0 border-dashed bg-bg-1/80'

              return (
                <div
                  key={node.id}
                  className={`absolute rounded-[var(--radius-md)] border p-2 shadow-sm ${baseClassName}`}
                  style={{
                    width: layout.nodeWidth,
                    minHeight: layout.nodeHeight,
                    left: position.x - layout.nodeWidth / 2,
                    top: position.y - layout.nodeHeight / 2,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-fg-3">{nodeTypeLabel}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClassName(node.status)}`}>
                      {node.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-fg-0 truncate">{node.title}</div>
                  <div className="text-[10px] text-fg-2 truncate">{node.subtitle}</div>
                  {node.templateId && (
                    <div className="mt-1 text-[10px] font-mono text-fg-3 truncate">
                      {node.templateId}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-fg-3">
        Reporting lines use each member&apos;s <span className="font-mono">reportsTo</span> relation.
        You dispatch through the Main Agent, which orchestrates this team.
      </div>

      {chartData.nodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-fg-3">
          <span className="rounded px-1.5 py-0.5 border border-status-progress/40 bg-status-progress/10">User</span>
          <span className="rounded px-1.5 py-0.5 border border-status-warning/45 bg-status-warning/10">Main Agent</span>
          <span className="rounded px-1.5 py-0.5 border border-bd-0 bg-bg-1">Materialized Team Agent</span>
          <span className="rounded px-1.5 py-0.5 border border-bd-0 border-dashed bg-bg-1/80">Template Position</span>
          <span className="rounded px-1.5 py-0.5 border border-bd-0 bg-bg-1">
            Nodes: {chartData.nodes.length} · Links: {chartData.edges.length}
          </span>
        </div>
      )}
    </div>
  )
}

function toDraft(team: AgentTeamSummary | null): TeamEditorDraft {
  if (!team) {
    return {
      name: '',
      description: '',
      workflowIds: [],
      templateIds: [],
    }
  }

  return {
    id: team.id,
    name: team.name,
    description: team.description ?? '',
    workflowIds: [...team.workflowIds],
    templateIds: [...team.templateIds],
  }
}

interface TeamEditorModalProps {
  open: boolean
  mode: 'create' | 'edit'
  draft: TeamEditorDraft
  workflows: WorkflowListItem[]
  templates: TemplateSummary[]
  optionsLoading: boolean
  optionsError: string | null
  onClose: () => void
  onChange: (next: TeamEditorDraft) => void
  onSubmit: () => Promise<void>
  isSubmitting: boolean
}

function FieldInfoTooltip({ copy }: { copy: string }) {
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-bd-0 bg-bg-2 text-fg-3 hover:text-fg-1"
        aria-label="Field help"
      >
        <Info className="h-3 w-3" />
      </button>
      <span className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-20 hidden w-64 rounded-[var(--radius-sm)] border border-bd-0 bg-bg-2 p-2 text-[11px] text-fg-1 shadow-lg group-hover:block group-focus-within:block">
        {copy}
      </span>
    </span>
  )
}

function SelectionChip({
  id,
  sublabel,
  onRemove,
}: {
  id: string
  sublabel?: string
  onRemove: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-bd-0 bg-bg-3 px-2 py-1">
      <span className="min-w-0">
        <span className="block font-mono text-xs text-fg-0 truncate max-w-[220px]">{id}</span>
        {sublabel && <span className="block text-[10px] text-fg-3 truncate max-w-[220px]">{sublabel}</span>}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-[var(--radius-xs)] p-0.5 text-fg-3 hover:text-fg-1 hover:bg-bg-2"
        aria-label={`Remove ${id}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function TeamEditorModal({
  open,
  mode,
  draft,
  workflows,
  templates,
  optionsLoading,
  optionsError,
  onClose,
  onChange,
  onSubmit,
  isSubmitting,
}: TeamEditorModalProps) {
  const canSubmit = draft.name.trim().length > 0 && !isSubmitting
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow] as const))
  const templateById = new Map(templates.map((template) => [template.id, template] as const))
  const workflowOptions = workflows
    .filter((workflow) => !draft.workflowIds.includes(workflow.id))
    .map((workflow) => ({
      value: workflow.id,
      label: workflow.id,
      description: workflow.description || 'No description',
      textValue: `${workflow.id} ${workflow.description}`,
    }))
  const templateOptions = templates
    .filter((template) => !draft.templateIds.includes(template.id))
    .map((template) => ({
      value: template.id,
      label: template.id,
      description: template.name,
      textValue: `${template.id} ${template.name} ${template.description}`,
    }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title={mode === 'create' ? 'New Team' : 'Edit Team'}
      description="Team metadata and linked workflows/templates"
    >
      <div className="space-y-3">
        <label className="space-y-1 text-sm block">
          <span className="text-fg-2">Name</span>
          <input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
          />
        </label>

        <label className="space-y-1 text-sm block">
          <span className="text-fg-2">Description</span>
          <textarea
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            rows={3}
            className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
          />
        </label>

        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-fg-2">Workflows</span>
            <FieldInfoTooltip copy="Workflow IDs identify orchestration pipelines this team is linked to." />
          </div>
          <SelectDropdown
            value={null}
            onChange={(workflowId) => onChange({ ...draft, workflowIds: [...draft.workflowIds, workflowId] })}
            ariaLabel="Add workflow"
            tone="field"
            size="md"
            placeholder={optionsLoading ? 'Loading workflows…' : 'Select workflow...'}
            options={workflowOptions}
            disabled={optionsLoading || workflowOptions.length === 0}
            search="auto"
            emptyMessage="No more workflows available"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {draft.workflowIds.length === 0 && (
              <span className="text-xs text-fg-3">No workflows linked.</span>
            )}
            {draft.workflowIds.map((workflowId) => {
              const workflow = workflowById.get(workflowId)
              return (
                <SelectionChip
                  key={workflowId}
                  id={workflowId}
                  sublabel={workflow?.description}
                  onRemove={() => onChange({ ...draft, workflowIds: draft.workflowIds.filter((id) => id !== workflowId) })}
                />
              )
            })}
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-fg-2">Templates</span>
            <FieldInfoTooltip copy="Template IDs reference agent blueprints this team typically uses." />
          </div>
          <SelectDropdown
            value={null}
            onChange={(templateId) => onChange({ ...draft, templateIds: [...draft.templateIds, templateId] })}
            ariaLabel="Add template"
            tone="field"
            size="md"
            placeholder={optionsLoading ? 'Loading templates…' : 'Select template...'}
            options={templateOptions}
            disabled={optionsLoading || templateOptions.length === 0}
            search="auto"
            emptyMessage="No more templates available"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {draft.templateIds.length === 0 && (
              <span className="text-xs text-fg-3">No templates linked.</span>
            )}
            {draft.templateIds.map((templateId) => {
              const template = templateById.get(templateId)
              return (
                <SelectionChip
                  key={templateId}
                  id={templateId}
                  sublabel={template?.name}
                  onRemove={() => onChange({ ...draft, templateIds: draft.templateIds.filter((id) => id !== templateId) })}
                />
              )
            })}
          </div>
        </div>

        {optionsError && (
          <div className="rounded-[var(--radius-sm)] border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning">
            {optionsError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose} variant="secondary" size="sm" type="button">Cancel</Button>
          <Button
            onClick={() => { void onSubmit() }}
            disabled={!canSubmit}
            variant="primary"
            size="sm"
            type="button"
          >
            {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Team' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function TeamsTab() {
  const { skipTypedConfirm } = useSettings()
  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const [teams, setTeams] = useState<AgentTeamSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deployResult, setDeployResult] = useState<TeamInstantiateAgentsResult | null>(null)
  const [isInstantiating, setIsInstantiating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => teams.find((item) => item.id === selectedId) ?? null, [teams, selectedId])

  const [showEditor, setShowEditor] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
  const [draft, setDraft] = useState<TeamEditorDraft>(toDraft(null))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowListItem[]>([])
  const [templateOptions, setTemplateOptions] = useState<TemplateSummary[]>([])
  const [editorOptionsLoading, setEditorOptionsLoading] = useState(false)
  const [editorOptionsError, setEditorOptionsError] = useState<string | null>(null)

  const [showPackageImport, setShowPackageImport] = useState(false)
  const [hierarchyDraft, setHierarchyDraft] = useState<TeamHierarchyConfig | null>(null)
  const [isSavingHierarchy, setIsSavingHierarchy] = useState(false)
  const [mainAgent, setMainAgent] = useState<AgentDTO | null>(null)

  const fetchTeams = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await agentTeamsApi.list()
      setTeams(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teams')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTeams()
  }, [fetchTeams])

  useEffect(() => {
    let cancelled = false

    const fetchMainAgent = async () => {
      try {
        const result = await agentsApi.list({
          mode: 'light',
          syncSessions: false,
          includeSessionOverlay: false,
          includeModelOverlay: false,
        })
        if (cancelled) return

        const detectedMainAgent = result.data.find((agent) => agent.slug === 'main')
          ?? result.data.find((agent) => agent.kind === 'ceo')
          ?? null
        setMainAgent(detectedMainAgent)
      } catch {
        if (!cancelled) setMainAgent(null)
      }
    }

    void fetchMainAgent()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setDeployResult(null)
  }, [selectedId])

  useEffect(() => {
    if (!selected) {
      setHierarchyDraft(null)
      return
    }
    setHierarchyDraft(normalizeHierarchyForTemplateIds(selected.hierarchy, selected.templateIds))
  }, [selected])

  const hierarchyErrors = useMemo(() => {
    if (!selected || !hierarchyDraft) return []
    return validateHierarchyDraft(hierarchyDraft, selected.templateIds)
  }, [selected, hierarchyDraft])

  const loadEditorOptions = useCallback(async () => {
    setEditorOptionsLoading(true)
    setEditorOptionsError(null)
    try {
      const [workflowsResult, templatesResult] = await Promise.all([
        workflowsApi.list(),
        templatesApi.list(),
      ])
      setWorkflowOptions(workflowsResult.data)
      setTemplateOptions(templatesResult.data.filter((template) => template.isValid))
    } catch (err) {
      setEditorOptionsError(err instanceof Error ? err.message : 'Failed to load workflows/templates')
    } finally {
      setEditorOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!showEditor) return
    void loadEditorOptions()
  }, [showEditor, loadEditorOptions])

  const openCreate = () => {
    setEditorMode('create')
    setDraft(toDraft(null))
    setShowEditor(true)
  }

  const openEdit = () => {
    if (!selected) return
    setEditorMode('edit')
    setDraft(toDraft(selected))
    setShowEditor(true)
  }

  const saveTeam = async () => {
    setIsSubmitting(true)
    setError(null)

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      workflowIds: [...draft.workflowIds],
      templateIds: [...draft.templateIds],
    }

    try {
      if (editorMode === 'create') {
        await new Promise<void>((resolve, reject) => {
          protectedAction.trigger({
            actionKind: 'team.create',
            actionTitle: 'Create Team',
            actionDescription: `Create team ${payload.name}`,
            entityName: payload.name,
            onConfirm: async (typedConfirmText) => {
              try {
                await agentTeamsApi.create({ ...payload, typedConfirmText })
                resolve()
              } catch (err) {
                reject(err)
                throw err
              }
            },
            onError: reject,
          })
        })
      } else if (selected) {
        await new Promise<void>((resolve, reject) => {
          protectedAction.trigger({
            actionKind: 'team.edit',
            actionTitle: 'Edit Team',
            actionDescription: `Update team ${selected.name}`,
            entityName: selected.name,
            onConfirm: async (typedConfirmText) => {
              try {
                await agentTeamsApi.update(selected.id, { ...payload, typedConfirmText })
                resolve()
              } catch (err) {
                reject(err)
                throw err
              }
            },
            onError: reject,
          })
        })
      }

      setShowEditor(false)
      await fetchTeams()
      setNotice(editorMode === 'create' ? 'Team created' : 'Team updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save team')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteTeam = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'team.delete',
      actionTitle: 'Delete Team',
      actionDescription: `Delete team ${selected.name}`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        setIsDeleting(true)
        try {
          await agentTeamsApi.delete(selected.id, { typedConfirmText })
          setSelectedId(null)
          await fetchTeams()
          setNotice('Team deleted')
        } finally {
          setIsDeleting(false)
        }
      },
      onError: (err) => setError(err.message),
    })
  }

  const exportTeam = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'team.export',
      actionTitle: 'Export Team',
      actionDescription: `Export team ${selected.name} as YAML`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        const blob = await agentTeamsApi.export(selected.id, typedConfirmText)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${selected.slug || selected.id}.team.yaml`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setNotice('Team exported')
      },
      onError: (err) => setError(err.message),
    })
  }

  const exportTeamPackage = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'package.export',
      actionTitle: 'Export Team Package',
      actionDescription: `Export ${selected.name} as .clawpack.zip`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        const blob = await packagesApi.export(selected.id, 'team_with_workflows', typedConfirmText)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${selected.slug || selected.id}.clawpack.zip`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setNotice('Team package exported')
      },
      onError: (err) => setError(err.message),
    })
  }

  const instantiateAgents = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'team.instantiate_agents',
      actionTitle: 'Deploy Team Agents',
      actionDescription: `Create missing agents and materialize workspace files for ${selected.name}`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        setIsInstantiating(true)
        try {
          const result = await agentTeamsApi.instantiateAgents(selected.id, { typedConfirmText })
          setDeployResult(result.data)
          await fetchTeams()
          setNotice(`Team deployed (created ${result.data.createdAgents.length}, existing ${result.data.existingAgents.length})`)
        } finally {
          setIsInstantiating(false)
        }
      },
      onError: (err) => setError(err.message),
    })
  }

  const updateHierarchyMember = (
    templateId: string,
    updater: (member: TeamHierarchyMember) => TeamHierarchyMember
  ) => {
    if (!selected || !hierarchyDraft) return
    const current = hierarchyDraft.members[templateId] ?? emptyHierarchyMember()
    setHierarchyDraft({
      version: 1,
      members: {
        ...hierarchyDraft.members,
        [templateId]: updater(current),
      },
    })
  }

  const setReportsTo = (templateId: string, reportsTo: string | null) => {
    updateHierarchyMember(templateId, (member) => ({
      ...member,
      reportsTo,
    }))
  }

  const toggleRelation = (
    templateId: string,
    relation: 'delegatesTo' | 'receivesFrom' | 'canMessage',
    targetId: string
  ) => {
    updateHierarchyMember(templateId, (member) => {
      const current = new Set(member[relation])
      if (current.has(targetId)) {
        current.delete(targetId)
      } else {
        current.add(targetId)
      }
      return {
        ...member,
        [relation]: Array.from(current).sort((left, right) => left.localeCompare(right)),
      }
    })
  }

  const toggleCapability = (templateId: string, capability: TeamCapabilityKey, checked: boolean) => {
    updateHierarchyMember(templateId, (member) => ({
      ...member,
      capabilities: {
        ...member.capabilities,
        [capability]: checked,
      },
    }))
  }

  const saveHierarchy = () => {
    if (!selected || !hierarchyDraft) return
    if (hierarchyErrors.length > 0) {
      setError('Fix hierarchy validation errors before saving')
      return
    }

    protectedAction.trigger({
      actionKind: 'team.edit',
      actionTitle: 'Save Team Hierarchy',
      actionDescription: `Update hierarchy for ${selected.name}`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        setIsSavingHierarchy(true)
        try {
          await agentTeamsApi.update(selected.id, {
            hierarchy: hierarchyDraft,
            typedConfirmText,
          })
          await fetchTeams()
          setNotice('Hierarchy updated')
        } finally {
          setIsSavingHierarchy(false)
        }
      },
      onError: (err) => setError(err.message),
    })
  }

  const regenerateHierarchyFromDefaults = () => {
    if (!selected) return
    protectedAction.trigger({
      actionKind: 'team.edit',
      actionTitle: 'Regenerate Team Hierarchy',
      actionDescription: `Replace hierarchy for ${selected.name} with template defaults`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        setIsSavingHierarchy(true)
        try {
          await agentTeamsApi.update(selected.id, {
            templateIds: selected.templateIds,
            regenerateHierarchyFromDefaults: true,
            typedConfirmText,
          })
          await fetchTeams()
          setNotice('Hierarchy regenerated from template defaults')
        } finally {
          setIsSavingHierarchy(false)
        }
      },
      onError: (err) => setError(err.message),
    })
  }

  if (loading) {
    return <div className="p-6 text-sm text-fg-2">Loading teams…</div>
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-fg-2">{teams.length} teams configured</div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => setShowPackageImport(true)}
              variant="secondary"
              size="sm"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Package
            </Button>
            <Button type="button" onClick={openCreate} variant="primary" size="sm">
              <Plus className="w-3.5 h-3.5" />
              New Team
            </Button>
          </div>
        </div>

        {notice && (
          <div className="rounded-[var(--radius-sm)] border border-status-success/40 bg-status-success/10 text-status-success text-sm p-2">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-[var(--radius-sm)] border border-status-danger/40 bg-status-danger/10 text-status-danger text-sm p-2">
            {error}
          </div>
        )}

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          <CanonicalTable
            columns={teamColumns}
            rows={teams}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedKey={selectedId ?? undefined}
            density="compact"
            emptyState={
              <EmptyState
                title="No teams"
                description="Create a team to group agents and linked workflows."
              />
            }
          />
        </div>
      </div>

      <RightDrawer
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.name || 'Team'}
        description={selected?.description || selected?.slug || ''}
        width="xl"
        className="overflow-x-hidden"
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Members:</span> <span className="text-fg-1">{selected.memberCount}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Health:</span> <span className="text-fg-1">{selected.healthStatus}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Workflows:</span> <span className="text-fg-1">{selected.workflowIds.length}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Templates:</span> <span className="text-fg-1">{selected.templateIds.length}</span></div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-fg-2">Workflow IDs</div>
              <div className="text-xs text-fg-1 font-mono break-all whitespace-pre-wrap rounded bg-bg-2 p-2">
                {selected.workflowIds.join(', ') || 'none'}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-fg-2">Template IDs</div>
              <div className="text-xs text-fg-1 font-mono break-all whitespace-pre-wrap rounded bg-bg-2 p-2">
                {selected.templateIds.join(', ') || 'none'}
              </div>
            </div>

            <TeamHierarchyOrgChart
              team={selected}
              hierarchy={hierarchyDraft}
              mainAgent={mainAgent}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-fg-2">Hierarchy Editor</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={regenerateHierarchyFromDefaults}
                    variant="secondary"
                    size="sm"
                    disabled={isSavingHierarchy || isInstantiating || isDeleting}
                  >
                    Regenerate From Template Defaults
                  </Button>
                  <Button
                    type="button"
                    onClick={saveHierarchy}
                    variant="primary"
                    size="sm"
                    disabled={isSavingHierarchy || isInstantiating || isDeleting}
                  >
                    {isSavingHierarchy ? 'Saving...' : 'Save Hierarchy'}
                  </Button>
                </div>
              </div>

              {hierarchyErrors.length > 0 && (
                <div className="rounded-[var(--radius-sm)] border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning">
                  <div className="font-medium">Hierarchy validation errors</div>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {hierarchyErrors.slice(0, 8).map((msg, index) => (
                      <li key={`${msg}-${index}`}>{msg}</li>
                    ))}
                    {hierarchyErrors.length > 8 && (
                      <li>{hierarchyErrors.length - 8} more…</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="space-y-3">
                {selected.templateIds
                  .slice()
                  .sort((left, right) => left.localeCompare(right))
                  .map((templateId) => {
                    const member = hierarchyDraft?.members[templateId] ?? emptyHierarchyMember()
                    const templateChoices = selected.templateIds
                      .filter((candidate) => candidate !== templateId)
                      .sort((left, right) => left.localeCompare(right))

                    return (
                      <div key={templateId} className="rounded-[var(--radius-sm)] border border-bd-0 bg-bg-2 p-2 space-y-2">
                        <div className="font-mono text-xs text-fg-0">{templateId}</div>

                        <label className="block text-xs text-fg-2">
                          Reports To
                          <select
                            value={member.reportsTo ?? ''}
                            onChange={(event) => setReportsTo(templateId, event.target.value || null)}
                            className="mt-1 w-full rounded-[var(--radius-sm)] border border-bd-0 bg-bg-3 px-2 py-1 text-xs text-fg-0"
                          >
                            <option value="">(none)</option>
                            {templateChoices.map((choice) => (
                              <option key={choice} value={choice}>{choice}</option>
                            ))}
                          </select>
                        </label>

                        {([
                          ['delegatesTo', 'Delegates To'],
                          ['canMessage', 'Can Message'],
                          ['receivesFrom', 'Receives From'],
                        ] as const).map(([relation, label]) => (
                          <div key={relation} className="space-y-1">
                            <div className="text-[11px] text-fg-2">{label}</div>
                            <div className="flex flex-wrap gap-2">
                              {templateChoices.map((choice) => {
                                const checked = member[relation].includes(choice)
                                return (
                                  <label key={choice} className="inline-flex items-center gap-1 rounded border border-bd-0 px-2 py-1 text-[11px] text-fg-1">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleRelation(templateId, relation, choice)}
                                    />
                                    <span className="font-mono">{choice}</span>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        ))}

                        <div className="space-y-1">
                          <div className="text-[11px] text-fg-2">Capabilities</div>
                          <div className="flex flex-wrap gap-2">
                            {TEAM_CAPABILITY_KEYS.map((capabilityKey) => (
                              <label key={capabilityKey} className="inline-flex items-center gap-1 rounded border border-bd-0 px-2 py-1 text-[11px] text-fg-1">
                                <input
                                  type="checkbox"
                                  checked={Boolean(member.capabilities[capabilityKey])}
                                  onChange={(event) => toggleCapability(templateId, capabilityKey, event.target.checked)}
                                />
                                <span className="font-mono">{capabilityKey}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-fg-2">Members</div>
              <div className="space-y-1">
                {selected.members.map((member) => (
                  <div key={member.id} className="text-xs text-fg-1 rounded bg-bg-2 px-2 py-1">
                    {member.displayName} · {member.role}
                  </div>
                ))}
                {selected.members.length === 0 && (
                  <div className="text-xs text-fg-2">No members assigned</div>
                )}
              </div>
            </div>

            {deployResult && (
              <div className="rounded-[var(--radius-sm)] border border-status-success/40 bg-status-success/10 text-status-success text-xs p-2">
                Deploy complete: created {deployResult.createdAgents.length}, existing {deployResult.existingAgents.length}, files written {deployResult.filesWritten.length}, files skipped {deployResult.filesSkipped.length}.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={instantiateAgents}
                variant="primary"
                size="sm"
                disabled={isInstantiating || isDeleting}
              >
                {isInstantiating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  'Deploy'
                )}
              </Button>
              <Button type="button" onClick={openEdit} variant="secondary" size="sm" disabled={isInstantiating || isDeleting}>Edit</Button>
              <Button type="button" onClick={exportTeam} variant="secondary" size="sm" disabled={isInstantiating || isDeleting}>
                <Download className="w-3.5 h-3.5" />
                Export
              </Button>
              <Button type="button" onClick={exportTeamPackage} variant="secondary" size="sm" disabled={isInstantiating || isDeleting}>
                <Download className="w-3.5 h-3.5" />
                Export Package
              </Button>
              <Button type="button" onClick={deleteTeam} variant="danger" size="sm" disabled={isInstantiating || isDeleting}>
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </RightDrawer>

      <TeamEditorModal
        open={showEditor}
        mode={editorMode}
        draft={draft}
        workflows={workflowOptions}
        templates={templateOptions}
        optionsLoading={editorOptionsLoading}
        optionsError={editorOptionsError}
        onClose={() => setShowEditor(false)}
        onChange={setDraft}
        onSubmit={saveTeam}
        isSubmitting={isSubmitting}
      />

      <ImportPackageModal
        open={showPackageImport}
        onClose={() => setShowPackageImport(false)}
        onDeployed={fetchTeams}
      />

      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        riskLevel={protectedAction.riskLevel}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </>
  )
}
