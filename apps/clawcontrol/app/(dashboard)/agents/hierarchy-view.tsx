'use client'

import { useEffect, useMemo, useState } from 'react'
import { EmptyState, PageSection } from '@clawcontrol/ui'
import { Bot, Loader2, RefreshCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  AgentHierarchyData,
  AgentHierarchyEdge,
  AgentHierarchyEdgeType,
  AgentHierarchyNode,
} from '@/lib/http'

interface HierarchyViewProps {
  data: AgentHierarchyData | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

type EdgeFilterState = Record<AgentHierarchyEdgeType, boolean>

type PositionedNode = {
  node: AgentHierarchyNode
  x: number
  y: number
}

type LayoutResult = {
  width: number
  height: number
  positioned: PositionedNode[]
}

const NODE_WIDTH = 220
const NODE_HEIGHT = 110
const COLUMN_GAP = 88
const ROW_GAP = 34
const CANVAS_PADDING = 52

const EDGE_LABELS: Record<AgentHierarchyEdgeType, string> = {
  reports_to: 'Reports To',
  delegates_to: 'Delegates To',
  receives_from: 'Receives From',
  can_message: 'Can Message',
}

const EDGE_STROKE: Record<AgentHierarchyEdgeType, string> = {
  reports_to: '#3b82f6',
  delegates_to: '#f59e0b',
  receives_from: '#10b981',
  can_message: '#64748b',
}

const ALL_EDGE_TYPES: AgentHierarchyEdgeType[] = ['reports_to', 'delegates_to', 'receives_from', 'can_message']

function defaultEdgeFilters(): EdgeFilterState {
  return {
    reports_to: true,
    delegates_to: true,
    receives_from: true,
    can_message: true,
  }
}

function buildLayout(nodes: AgentHierarchyNode[], edges: AgentHierarchyEdge[]): LayoutResult {
  if (nodes.length === 0) {
    return {
      width: 680,
      height: 420,
      positioned: [],
    }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const childrenByParent = new Map<string, Set<string>>()
  const parentByChild = new Map<string, string>()

  for (const edge of edges) {
    if (edge.type !== 'reports_to') continue
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue

    parentByChild.set(edge.from, edge.to)

    const bucket = childrenByParent.get(edge.to) ?? new Set<string>()
    bucket.add(edge.from)
    childrenByParent.set(edge.to, bucket)
  }

  const roots = nodes
    .filter((node) => !parentByChild.has(node.id))
    .sort((a, b) => a.label.localeCompare(b.label))

  const levelById = new Map<string, number>()
  const queue: Array<{ id: string; level: number }> = roots.map((node) => ({ id: node.id, level: 0 }))

  while (queue.length > 0) {
    const next = queue.shift()
    if (!next) continue

    const currentLevel = levelById.get(next.id)
    if (currentLevel !== undefined && currentLevel <= next.level) continue

    levelById.set(next.id, next.level)

    const children = Array.from(childrenByParent.get(next.id) ?? []).sort((a, b) => a.localeCompare(b))
    for (const childId of children) {
      queue.push({ id: childId, level: next.level + 1 })
    }
  }

  let maxLevel = Math.max(0, ...Array.from(levelById.values()))

  for (const node of nodes) {
    if (!levelById.has(node.id)) {
      maxLevel += 1
      levelById.set(node.id, maxLevel)
    }
  }

  const columns = new Map<number, AgentHierarchyNode[]>()
  for (const node of nodes) {
    const level = levelById.get(node.id) ?? 0
    const bucket = columns.get(level) ?? []
    bucket.push(node)
    columns.set(level, bucket)
  }

  const sortedLevels = Array.from(columns.keys()).sort((a, b) => a - b)
  for (const level of sortedLevels) {
    const bucket = columns.get(level)
    if (!bucket) continue
    bucket.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'agent' ? -1 : 1
      return a.label.localeCompare(b.label)
    })
  }

  const maxRows = Math.max(1, ...Array.from(columns.values()).map((bucket) => bucket.length))
  const width =
    CANVAS_PADDING * 2 +
    sortedLevels.length * NODE_WIDTH +
    Math.max(0, sortedLevels.length - 1) * COLUMN_GAP
  const height = CANVAS_PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP

  const positioned: PositionedNode[] = []
  sortedLevels.forEach((level, columnIndex) => {
    const bucket = columns.get(level) ?? []
    bucket.forEach((node, rowIndex) => {
      const x = CANVAS_PADDING + NODE_WIDTH / 2 + columnIndex * (NODE_WIDTH + COLUMN_GAP)
      const y = CANVAS_PADDING + NODE_HEIGHT / 2 + rowIndex * (NODE_HEIGHT + ROW_GAP)
      positioned.push({ node, x, y })
    })
  })

  return { width, height, positioned }
}

function edgeCountByType(edges: AgentHierarchyEdge[]): Record<AgentHierarchyEdgeType, number> {
  return edges.reduce(
    (acc, edge) => {
      acc[edge.type] += 1
      return acc
    },
    {
      reports_to: 0,
      delegates_to: 0,
      receives_from: 0,
      can_message: 0,
    } as Record<AgentHierarchyEdgeType, number>
  )
}

function CapabilityBadge({ label }: { label: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded border border-bd-0 bg-bg-3 text-[10px] uppercase tracking-wide text-fg-1">
      {label}
    </span>
  )
}

export function HierarchyView({ data, loading, error, onRetry }: HierarchyViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [stationFilter, setStationFilter] = useState<string>('all')
  const [showExternalNodes, setShowExternalNodes] = useState<boolean>(true)
  const [edgeFilters, setEdgeFilters] = useState<EdgeFilterState>(defaultEdgeFilters)

  const stationOptions = useMemo(() => {
    if (!data) return []

    const stations = new Set<string>()
    for (const node of data.nodes) {
      if (node.kind !== 'agent') continue
      if (!node.station) continue
      stations.add(node.station)
    }

    return Array.from(stations).sort((a, b) => a.localeCompare(b))
  }, [data])

  const visibleGraph = useMemo(() => {
    if (!data) {
      return {
        nodes: [] as AgentHierarchyNode[],
        edges: [] as AgentHierarchyEdge[],
      }
    }

    const nodeById = new Map(data.nodes.map((node) => [node.id, node]))

    const baseEdges = data.edges.filter((edge) => edgeFilters[edge.type])

    const visibleAgentIds = new Set(
      data.nodes
        .filter((node) => node.kind === 'agent')
        .filter((node) => stationFilter === 'all' || node.station === stationFilter)
        .map((node) => node.id)
    )

    const externalIds = new Set<string>()
    if (showExternalNodes) {
      if (stationFilter === 'all') {
        for (const node of data.nodes) {
          if (node.kind === 'external') externalIds.add(node.id)
        }
      } else {
        for (const edge of baseEdges) {
          const from = nodeById.get(edge.from)
          const to = nodeById.get(edge.to)
          if (!from || !to) continue

          if (from.kind === 'external' && visibleAgentIds.has(to.id)) {
            externalIds.add(from.id)
          }
          if (to.kind === 'external' && visibleAgentIds.has(from.id)) {
            externalIds.add(to.id)
          }
        }
      }
    }

    const visibleIds = new Set<string>([...visibleAgentIds, ...externalIds])

    const nodes = data.nodes.filter((node) => visibleIds.has(node.id))
    const edges = baseEdges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))

    return { nodes, edges }
  }, [data, edgeFilters, showExternalNodes, stationFilter])

  const layout = useMemo(() => buildLayout(visibleGraph.nodes, visibleGraph.edges), [visibleGraph])

  const nodeById = useMemo(() => {
    const map = new Map<string, AgentHierarchyNode>()
    for (const node of visibleGraph.nodes) {
      map.set(node.id, node)
    }
    return map
  }, [visibleGraph.nodes])

  const edgeTypeCounts = useMemo(() => edgeCountByType(visibleGraph.edges), [visibleGraph.edges])

  useEffect(() => {
    if (!data || visibleGraph.nodes.length === 0) {
      setSelectedNodeId(null)
      return
    }

    if (selectedNodeId && nodeById.has(selectedNodeId)) {
      return
    }

    setSelectedNodeId(visibleGraph.nodes[0]?.id ?? null)
  }, [data, nodeById, selectedNodeId, visibleGraph.nodes])

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null

  const selectedEdges = useMemo(() => {
    if (!selectedNode) {
      return {
        inbound: [] as AgentHierarchyEdge[],
        outbound: [] as AgentHierarchyEdge[],
      }
    }

    const inbound = visibleGraph.edges.filter((edge) => edge.to === selectedNode.id)
    const outbound = visibleGraph.edges.filter((edge) => edge.from === selectedNode.id)
    return { inbound, outbound }
  }, [selectedNode, visibleGraph.edges])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-status-danger/10 border border-status-danger/30 rounded-[var(--radius-lg)] p-4">
        <p className="text-sm text-status-danger">{error}</p>
        <button
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:bg-bg-3/80"
        >
          <RefreshCcw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    )
  }

  if (!data || data.nodes.length === 0) {
    return (
      <EmptyState
        icon={<Bot className="w-8 h-8" />}
        title="No hierarchy data"
        description="No agents or relationships were discovered from available sources."
      />
    )
  }

  return (
    <div className="space-y-4">
      {data.meta.warnings.length > 0 && (
        <div className="p-3 rounded-[var(--radius-md)] border border-status-warning/30 bg-status-warning/10">
          <p className="text-xs font-medium text-status-warning">Hierarchy warnings</p>
          <div className="mt-2 space-y-1">
            {data.meta.warnings.slice(0, 6).map((warning) => (
              <p key={`${warning.code}-${warning.message}`} className="text-xs text-fg-1">
                {warning.message}
              </p>
            ))}
            {data.meta.warnings.length > 6 && (
              <p className="text-xs text-fg-2">+{data.meta.warnings.length - 6} more warnings</p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-[var(--radius-md)] border border-bd-0 bg-bg-2">
            <div className="flex items-center gap-2">
              {ALL_EDGE_TYPES.map((edgeType) => (
                <button
                  key={edgeType}
                  onClick={() => setEdgeFilters((prev) => ({ ...prev, [edgeType]: !prev[edgeType] }))}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] text-xs border transition-colors',
                    edgeFilters[edgeType]
                      ? 'border-bd-1 bg-bg-3 text-fg-0'
                      : 'border-bd-0 bg-bg-1 text-fg-2'
                  )}
                >
                  <span
                    className="h-1.5 w-3 rounded-full"
                    style={{ backgroundColor: EDGE_STROKE[edgeType] }}
                  />
                  {EDGE_LABELS[edgeType]} ({edgeTypeCounts[edgeType]})
                </button>
              ))}
            </div>

            <div className="h-5 w-px bg-bd-0" />

            <select
              value={stationFilter}
              onChange={(event) => setStationFilter(event.target.value)}
              className="px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-bd-0 bg-bg-1 text-fg-1"
            >
              <option value="all">All stations</option>
              {stationOptions.map((station) => (
                <option key={station} value={station}>
                  {station}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-2 text-xs text-fg-1">
              <input
                type="checkbox"
                checked={showExternalNodes}
                onChange={(event) => setShowExternalNodes(event.target.checked)}
                className="rounded border-bd-1 bg-bg-1"
              />
              Show external nodes
            </label>
          </div>

          <div className="relative h-[560px] overflow-auto rounded-[var(--radius-lg)] border border-bd-0 bg-bg-2">
            <div style={{ width: layout.width, height: layout.height }} className="relative">
              <svg className="absolute inset-0" width={layout.width} height={layout.height}>
                <defs>
                  <marker
                    id="hierarchy-arrow"
                    markerWidth="8"
                    markerHeight="6"
                    refX="7"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L8,3 L0,6 Z" fill="#94a3b8" />
                  </marker>
                </defs>

                {visibleGraph.edges.map((edge) => {
                  const from = layout.positioned.find((positioned) => positioned.node.id === edge.from)
                  const to = layout.positioned.find((positioned) => positioned.node.id === edge.to)
                  if (!from || !to) return null

                  const direction = to.x >= from.x ? 1 : -1
                  const bend = Math.max(46, Math.abs(to.x - from.x) * 0.35)
                  const c1x = from.x + bend * direction
                  const c2x = to.x - bend * direction

                  return (
                    <path
                      key={edge.id}
                      d={`M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`}
                      fill="none"
                      stroke={EDGE_STROKE[edge.type]}
                      strokeOpacity={edge.type === 'can_message' ? 0.7 : 0.92}
                      strokeWidth={edge.type === 'can_message' ? 1.6 : 2.2}
                      markerEnd="url(#hierarchy-arrow)"
                    />
                  )
                })}
              </svg>

              {layout.positioned.map(({ node, x, y }) => {
                const isSelected = node.id === selectedNodeId

                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    className={cn(
                      'absolute text-left p-3 rounded-[var(--radius-md)] border transition-colors shadow-sm',
                      'bg-bg-1 hover:bg-bg-3',
                      node.kind === 'external' ? 'border-status-warning/30' : 'border-bd-0',
                      isSelected && 'border-status-progress/60 ring-1 ring-status-progress/40'
                    )}
                    style={{
                      width: NODE_WIDTH,
                      minHeight: NODE_HEIGHT,
                      left: x - NODE_WIDTH / 2,
                      top: y - NODE_HEIGHT / 2,
                    }}
                  >
                    <p className="text-sm font-medium text-fg-0 truncate">{node.label}</p>
                    <p className="text-[11px] text-fg-2 truncate">{node.id}</p>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {node.capabilities.delegate && <CapabilityBadge label="delegate" />}
                      {node.capabilities.message && <CapabilityBadge label="message" />}
                      {node.capabilities.exec && <CapabilityBadge label="exec" />}
                      {node.capabilities.write && <CapabilityBadge label="write" />}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
            {ALL_EDGE_TYPES.map((edgeType) => (
              <div key={edgeType} className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-6 rounded-full" style={{ backgroundColor: EDGE_STROKE[edgeType] }} />
                {EDGE_LABELS[edgeType]}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <PageSection title="Node Details">
            {!selectedNode ? (
              <p className="text-sm text-fg-2">Select a node to inspect details.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-fg-0">{selectedNode.label}</p>
                  <p className="text-xs text-fg-2 font-mono">{selectedNode.id}</p>
                </div>

                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-fg-2">Type</dt>
                  <dd className="text-fg-1">{selectedNode.kind}</dd>
                  <dt className="text-fg-2">Role</dt>
                  <dd className="text-fg-1">{selectedNode.role ?? 'n/a'}</dd>
                  <dt className="text-fg-2">Station</dt>
                  <dd className="text-fg-1">{selectedNode.station ?? 'n/a'}</dd>
                  <dt className="text-fg-2">Status</dt>
                  <dd className="text-fg-1">{selectedNode.status ?? 'n/a'}</dd>
                </dl>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-fg-1">Outbound Edges</p>
                  {selectedEdges.outbound.length === 0 ? (
                    <p className="text-xs text-fg-2">None</p>
                  ) : (
                    <div className="space-y-1">
                      {selectedEdges.outbound.map((edge) => (
                        <p key={edge.id} className="text-xs text-fg-1">
                          <span className="text-fg-2">{EDGE_LABELS[edge.type]}:</span> {edge.to}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-fg-1">Inbound Edges</p>
                  {selectedEdges.inbound.length === 0 ? (
                    <p className="text-xs text-fg-2">None</p>
                  ) : (
                    <div className="space-y-1">
                      {selectedEdges.inbound.map((edge) => (
                        <p key={edge.id} className="text-xs text-fg-1">
                          <span className="text-fg-2">{EDGE_LABELS[edge.type]}:</span> {edge.from}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-fg-1">Tool Permission Snapshot</p>
                  {selectedNode.toolPolicy ? (
                    <div className="space-y-1 text-xs text-fg-1">
                      <p>
                        <span className="text-fg-2">Source:</span> {selectedNode.toolPolicy.source}
                      </p>
                      <p>
                        <span className="text-fg-2">Exec security:</span>{' '}
                        {selectedNode.toolPolicy.execSecurity ?? 'n/a'}
                      </p>
                      <p>
                        <span className="text-fg-2">Allow:</span>{' '}
                        {selectedNode.toolPolicy.allow.length > 0
                          ? selectedNode.toolPolicy.allow.join(', ')
                          : '(empty)'}
                      </p>
                      <p>
                        <span className="text-fg-2">Deny:</span>{' '}
                        {selectedNode.toolPolicy.deny.length > 0
                          ? selectedNode.toolPolicy.deny.join(', ')
                          : '(empty)'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-fg-2">No tool policy snapshot available for this node.</p>
                  )}
                </div>
              </div>
            )}
          </PageSection>

          <PageSection title="Sources">
            <div className="space-y-2 text-xs text-fg-1">
              <p>
                <span className="text-fg-2">YAML:</span>{' '}
                {data.meta.sources.yaml.available ? 'available' : 'unavailable'}
              </p>
              <p>
                <span className="text-fg-2">Runtime:</span>{' '}
                {data.meta.sources.runtime.available ? 'available' : 'unavailable'}
              </p>
              <p>
                <span className="text-fg-2">Fallback:</span>{' '}
                {data.meta.sources.fallback.used
                  ? 'used'
                  : data.meta.sources.fallback.available
                    ? 'available (not used)'
                    : 'unavailable'}
              </p>
              <p>
                <span className="text-fg-2">DB agents:</span> {data.meta.sources.db.count}
              </p>
            </div>
          </PageSection>
        </div>
      </div>
    </div>
  )
}
