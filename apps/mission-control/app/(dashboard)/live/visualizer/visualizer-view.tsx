'use client'

import { useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useSseStream } from '@/lib/hooks/useSseStream'
import { RightDrawer } from '@/components/shell/right-drawer'
import {
  useVisualizerStore,
  type VisualizerNode,
  type VisualizerEntityType,
} from './visualizer-store'
import { LivePulseHeader } from './components/live-pulse-header'
import { OpenClawSessionsPanel } from './components/openclaw-sessions-panel'
import { Lane } from './components/lane'
import { ReceiptDetailPanel, EntityDetailPanel } from './components/receipt-detail-panel'
import { Play, Pause, Filter, AlertTriangle, Bell } from 'lucide-react'

export function VisualizerView() {
  const {
    state,
    actions,
    getFilteredNodes,
    getAttentionStats,
    quietStatus,
    summaryStats,
  } = useVisualizerStore()

  // Connect to SSE stream
  const { reconnect } = useSseStream({
    onActivity: actions.handleActivity,
    onConnectionChange: actions.handleConnectionChange,
  })

  // Get filtered nodes
  const filteredNodes = useMemo(() => getFilteredNodes(), [getFilteredNodes])

  // Get attention stats
  const attentionStats = useMemo(() => getAttentionStats(), [getAttentionStats])

  // Handle node selection
  const handleNodeClick = useCallback(
    (node: VisualizerNode) => {
      actions.selectNode({ entityType: node.entityType, id: node.id })
    },
    [actions]
  )

  // Handle drawer close
  const handleDrawerClose = useCallback(() => {
    actions.selectNode(null)
  }, [actions])

  // Correlation jump handlers
  const handleJumpToReceipt = useCallback(
    (receiptId: string) => {
      // Highlight the receipt node
      actions.highlightNode({ entityType: 'receipt', id: receiptId })
    },
    [actions]
  )

  const handleJumpToOperation = useCallback(
    (operationId: string) => {
      // Highlight the operation node
      actions.highlightNode({ entityType: 'operation', id: operationId })
    },
    [actions]
  )

  const handleJumpToWorkOrder = useCallback(
    (workOrderId: string) => {
      // Highlight the work order node
      actions.highlightNode({ entityType: 'work_order', id: workOrderId })
    },
    [actions]
  )

  // Get selected node details
  const selectedNode = useMemo(() => {
    if (!state.selectedNode) return null

    const { entityType, id } = state.selectedNode
    const collection =
      entityType === 'work_order'
        ? state.workOrders
        : entityType === 'operation'
          ? state.operations
          : state.receipts

    return collection.get(id) ?? null
  }, [state.selectedNode, state.workOrders, state.operations, state.receipts])

  // Get highlighted node ID per lane
  const highlightedWoId =
    state.highlightedNode?.entityType === 'work_order' ? state.highlightedNode.id : undefined
  const highlightedOpId =
    state.highlightedNode?.entityType === 'operation' ? state.highlightedNode.id : undefined
  const highlightedReceiptId =
    state.highlightedNode?.entityType === 'receipt' ? state.highlightedNode.id : undefined

  // Filter toggle handlers
  const toggleEntityTypeFilter = useCallback(
    (type: VisualizerEntityType) => {
      const newTypes = new Set(state.filters.entityTypes)
      if (newTypes.has(type)) {
        newTypes.delete(type)
      } else {
        newTypes.add(type)
      }
      actions.setFilter({ entityTypes: newTypes })
    },
    [state.filters.entityTypes, actions]
  )

  const toggleErrorsOnly = useCallback(() => {
    actions.setFilter({ errorsOnly: !state.filters.errorsOnly })
  }, [state.filters.errorsOnly, actions])

  const toggleAttentionOnly = useCallback(() => {
    actions.setFilter({ attentionOnly: !state.filters.attentionOnly })
  }, [state.filters.attentionOnly, actions])

  return (
    <div className="flex flex-col h-full">
      {/* Pulse Header with attention stats and quiet mode */}
      <LivePulseHeader
        connectionState={state.connectionState}
        eventsPerSecond={state.eventsPerSecond}
        lastEventTime={state.lastEventTime}
        onReconnect={reconnect}
        paused={state.paused}
        reconnectAttempt={state.reconnectAttempt}
        reconnectingIn={state.reconnectingIn}
        attentionStats={attentionStats}
        quietStatus={quietStatus}
        summaryStats={summaryStats}
      />

      {/* Controls */}
      <div className="flex items-center justify-between gap-4 py-3">
        {/* Left: Filter toggles */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-fg-3" />

          {/* Entity type filters */}
          {(['work_order', 'operation', 'receipt'] as VisualizerEntityType[]).map((type) => (
            <button
              key={type}
              onClick={() => toggleEntityTypeFilter(type)}
              className={cn(
                'px-2 py-1 text-xs font-medium rounded-[var(--radius-sm)] border transition-colors',
                state.filters.entityTypes.has(type)
                  ? 'bg-bg-3 text-fg-0 border-white/[0.12]'
                  : 'bg-transparent text-fg-3 border-transparent hover:border-white/[0.06]'
              )}
            >
              {type === 'work_order' ? 'WOs' : type === 'operation' ? 'Ops' : 'Receipts'}
            </button>
          ))}

          <span className="text-fg-3 hidden sm:inline">|</span>

          {/* Errors only toggle */}
          <button
            onClick={toggleErrorsOnly}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-[var(--radius-sm)] border transition-colors',
              state.filters.errorsOnly
                ? 'bg-status-danger/10 text-status-danger border-status-danger/30'
                : 'bg-transparent text-fg-3 border-transparent hover:border-white/[0.06]'
            )}
          >
            <AlertTriangle className="w-3 h-3" />
            Errors
          </button>

          {/* Attention only toggle */}
          <button
            onClick={toggleAttentionOnly}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-[var(--radius-sm)] border transition-colors',
              state.filters.attentionOnly
                ? 'bg-status-warning/10 text-status-warning border-status-warning/30'
                : 'bg-transparent text-fg-3 border-transparent hover:border-white/[0.06]'
            )}
          >
            <Bell className="w-3 h-3" />
            Attention
            {attentionStats.total > 0 && (
              <span className="ml-1 px-1 py-0.5 text-[10px] font-bold bg-status-danger text-white rounded-full min-w-[16px] text-center">
                {attentionStats.total}
              </span>
            )}
          </button>
        </div>

        {/* Right: Pause/Play */}
        <button
          onClick={actions.togglePause}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
            state.paused
              ? 'bg-status-warning/10 text-status-warning border-status-warning/30'
              : 'bg-bg-3 text-fg-1 border-white/[0.06] hover:border-bd-1'
          )}
        >
          {state.paused ? (
            <>
              <Play className="w-3.5 h-3.5" />
              Resume
            </>
          ) : (
            <>
              <Pause className="w-3.5 h-3.5" />
              Pause
            </>
          )}
        </button>
      </div>

      {/* OpenClaw Sessions (telemetry only) */}
      <div className="shrink-0 pb-4">
        <OpenClawSessionsPanel />
      </div>

      {/* Lanes Grid */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 h-full">
          {/* Work Orders Lane */}
          {state.filters.entityTypes.has('work_order') && (
            <div className="min-h-0 flex flex-col bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
              <Lane
                title="Work Orders"
                entityType="work_order"
                nodes={filteredNodes.workOrders}
                selectedId={
                  state.selectedNode?.entityType === 'work_order'
                    ? state.selectedNode.id
                    : undefined
                }
                highlightedId={highlightedWoId}
                onNodeClick={handleNodeClick}
                onPinNode={(id) => actions.pinNode('work_order', id)}
                onUnpinNode={(id) => actions.unpinNode('work_order', id)}
                onJumpToReceipt={handleJumpToReceipt}
                onJumpToOperation={handleJumpToOperation}
                onJumpToWorkOrder={handleJumpToWorkOrder}
              />
            </div>
          )}

          {/* Operations Lane */}
          {state.filters.entityTypes.has('operation') && (
            <div className="min-h-0 flex flex-col bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
              <Lane
                title="Operations"
                entityType="operation"
                nodes={filteredNodes.operations}
                selectedId={
                  state.selectedNode?.entityType === 'operation'
                    ? state.selectedNode.id
                    : undefined
                }
                highlightedId={highlightedOpId}
                onNodeClick={handleNodeClick}
                onPinNode={(id) => actions.pinNode('operation', id)}
                onUnpinNode={(id) => actions.unpinNode('operation', id)}
                onJumpToReceipt={handleJumpToReceipt}
                onJumpToOperation={handleJumpToOperation}
                onJumpToWorkOrder={handleJumpToWorkOrder}
              />
            </div>
          )}

          {/* Receipts Lane */}
          {state.filters.entityTypes.has('receipt') && (
            <div className="min-h-0 flex flex-col bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
              <Lane
                title="Receipts"
                entityType="receipt"
                nodes={filteredNodes.receipts}
                selectedId={
                  state.selectedNode?.entityType === 'receipt'
                    ? state.selectedNode.id
                    : undefined
                }
                highlightedId={highlightedReceiptId}
                onNodeClick={handleNodeClick}
                onPinNode={(id) => actions.pinNode('receipt', id)}
                onUnpinNode={(id) => actions.unpinNode('receipt', id)}
                onJumpToReceipt={handleJumpToReceipt}
                onJumpToOperation={handleJumpToOperation}
                onJumpToWorkOrder={handleJumpToWorkOrder}
              />
            </div>
          )}
        </div>
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedNode}
        onClose={handleDrawerClose}
        title={selectedNode?.displayId ?? ''}
        description={
          selectedNode?.entityType === 'receipt'
            ? 'Live output'
            : selectedNode?.entityType === 'work_order'
              ? 'Work Order'
              : 'Operation'
        }
        width="lg"
      >
        {selectedNode && (
          <>
            {selectedNode.entityType === 'receipt' ? (
              <ReceiptDetailPanel receiptId={selectedNode.id} />
            ) : (
              <EntityDetailPanel
                entityType={selectedNode.entityType}
                entityId={selectedNode.id}
                displayId={selectedNode.displayId}
                title={selectedNode.title}
                status={selectedNode.status}
                metadata={
                  selectedNode.entityType === 'work_order'
                    ? {
                        Priority: selectedNode.priority ?? null,
                        'Running Ops': selectedNode.runningOpsCount ?? 0,
                        'Pending Ops': selectedNode.pendingOpsCount ?? 0,
                      }
                    : {
                        'Work Order': selectedNode.workOrderCode ?? null,
                        'Active Receipt': selectedNode.activeReceiptId
                          ? selectedNode.activeReceiptId.slice(0, 8)
                          : null,
                      }
                }
              />
            )}
          </>
        )}
      </RightDrawer>
    </div>
  )
}
