/**
 * Gateway Mirror Service
 *
 * Singleton service that maintains a WebSocket connection to the OpenClaw Gateway
 * and mirrors events to connected SSE clients.
 *
 * SECURITY: This runs server-side only. The browser NEVER connects to the Gateway directly.
 */

import { EventEmitter } from 'events'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type {
  MirrorConfig,
  MirrorStatus,
  MirrorMode,
  GatewayFrame,
  GatewayEvent,
  GraphNode,
  GraphEdge,
  GraphSnapshot,
  GraphDelta,
  GraphUpdate,
} from './types'
import { LiveGraphStore } from './graph-store'
import { normalizeFrame, eventToGraphUpdates, isSubagentEvent, createSpawnEdge } from './event-normalizer'
import { createWsAdapter, type WsAdapter } from '@clawcontrol/adapters-openclaw'
import type { AdapterConfig, DeviceIdentity } from '@clawcontrol/adapters-openclaw'

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let instance: GatewayMirrorService | null = null

export function getMirrorService(): GatewayMirrorService {
  if (!instance) {
    const config = buildConfigFromEnv()
    instance = new GatewayMirrorService(config)
    // Don't auto-start - let the SSE endpoint start it on first connection
  }
  return instance
}

/**
 * Build config from environment variables and defaults.
 */
function buildConfigFromEnv(): MirrorConfig {
  return {
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
    tokenPath: process.env.OPENCLAW_TOKEN_PATH,
    token: process.env.OPENCLAW_OPERATOR_TOKEN,
    reconnectDelayMs: parseInt(process.env.OPENCLAW_RECONNECT_DELAY_MS || '3000', 10),
    maxReconnectAttempts: parseInt(process.env.OPENCLAW_MAX_RECONNECT_ATTEMPTS || '10', 10),
    pollingIntervalMs: parseInt(process.env.OPENCLAW_POLLING_INTERVAL_MS || '5000', 10),
    maxEvents: parseInt(process.env.OPENCLAW_MAX_EVENTS || '2000', 10),
    maxNodes: parseInt(process.env.OPENCLAW_MAX_NODES || '500', 10),
    maxEdges: parseInt(process.env.OPENCLAW_MAX_EDGES || '800', 10),
    nodeTtlMs: parseInt(process.env.OPENCLAW_NODE_TTL_MS || String(5 * 60 * 1000), 10),
  }
}

// ============================================================================
// MIRROR SERVICE CLASS
// ============================================================================

export class GatewayMirrorService extends EventEmitter {
  private adapter: WsAdapter | null = null
  private unsubscribeEvents: (() => void) | null = null
  private store: LiveGraphStore
  private config: MirrorConfig
  private status: MirrorStatus
  private reconnectAttempt = 0
  private reconnectTimeout: NodeJS.Timeout | null = null
  private evictionInterval: NodeJS.Timeout | null = null
  private started = false

  private deltaFlushTimeout: NodeJS.Timeout | null = null
  private pendingDelta: {
    addedNodes: Map<string, GraphNode>
    updatedNodes: Map<string, GraphNode>
    removedNodeIds: Set<string>
    addedEdges: Map<string, GraphEdge>
    removedEdgeIds: Set<string>
    lastEventId: string
  } | null = null

  private readonly deltaFlushIntervalMs = 50

  constructor(config: MirrorConfig) {
    super()
    this.setMaxListeners(100) // Allow many SSE subscribers

    this.config = config
    this.store = new LiveGraphStore({
      maxEvents: config.maxEvents,
      maxNodes: config.maxNodes,
      maxEdges: config.maxEdges,
      nodeTtlMs: config.nodeTtlMs,
    })

    this.status = {
      mode: 'disconnected',
      connectedAt: null,
      lastEventAt: null,
      reconnectAttempt: 0,
      eventCount: 0,
      nodeCount: 0,
      edgeCount: 0,
      gatewayUrl: config.gatewayUrl,
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Start the mirror service.
   * Connects to Gateway WS and begins processing events.
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    console.log('[GatewayMirror] Starting mirror service...')

    // Start periodic eviction
    this.evictionInterval = setInterval(() => {
      const removed = this.store.evictExpiredNodes()
      if (removed.length > 0) {
        this.queueDelta({
          addedNodes: [],
          updatedNodes: [],
          removedNodeIds: removed,
          addedEdges: [],
          removedEdgeIds: [],
          lastEventId: this.store.getLastEventId() || '',
        })
      }
    }, 30_000) // Every 30 seconds

    // Attempt WS connection via the shared adapter implementation
    await this.connectAdapter()
  }

  /**
   * Stop the mirror service.
   */
  stop(): void {
    this.started = false

    if (this.deltaFlushTimeout) {
      clearTimeout(this.deltaFlushTimeout)
      this.deltaFlushTimeout = null
    }
    this.pendingDelta = null

    // Unsubscribe from events
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents()
      this.unsubscribeEvents = null
    }

    // Disconnect adapter
    if (this.adapter) {
      try {
        this.adapter.disconnect()
      } catch {
        // ignore
      }
      this.adapter = null
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.evictionInterval) {
      clearInterval(this.evictionInterval)
      this.evictionInterval = null
    }

    this.updateStatus('disconnected')
    console.log('[GatewayMirror] Mirror service stopped')
  }

  /**
   * Force an immediate reconnect attempt.
   */
  reconnect(): void {
    if (this.adapter) {
      try {
        this.adapter.disconnect()
      } catch {
        // ignore
      }
    }
    this.reconnectAttempt = 0
    this.connectAdapter()
  }

  // ==========================================================================
  // WEBSOCKET CONNECTION (via @clawcontrol/adapters-openclaw)
  // ==========================================================================

  private async connectAdapter(): Promise<void> {
    // Clean up previous adapter and subscriptions
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents()
      this.unsubscribeEvents = null
    }

    if (this.adapter) {
      try {
        this.adapter.disconnect()
      } catch {
        // ignore
      }
      this.adapter = null
    }

    this.updateStatus('disconnected')
    console.log(`[GatewayMirror] Connecting (adapter) to ${this.config.gatewayUrl}...`)

    try {
      const deviceIdentity = this.loadDeviceIdentity()

      // Token resolution order:
      // 1) Explicit env/config token
      // 2) Cached device auth token (preferred for local paired gateways)
      // 3) ~/.openclaw/openclaw.json gateway.auth.token
      const token =
        this.config.token ||
        (deviceIdentity ? this.loadDeviceAuthToken(deviceIdentity.deviceId, 'operator') : undefined) ||
        this.loadGatewayTokenFromConfigFile()

      const cfg: Omit<AdapterConfig, 'mode'> = {
        wsUrl: this.config.gatewayUrl,
        wsToken: token,
        wsClientId: 'cli',
        wsClientMode: 'backend',
        wsReadonly: true,
        wsProtocolVersion: 3,
        ...(deviceIdentity ? { wsDeviceIdentity: deviceIdentity } : {}),
      }

      this.adapter = createWsAdapter(cfg)

      const probe = await this.adapter.gatewayProbe()
      if (!probe.ok) {
        throw new Error('Gateway probe failed')
      }

      // Subscribe to gateway events
      this.unsubscribeEvents = this.adapter.subscribeEvents((evt: unknown) => {
        // We expect WsEventFrame: { type:'event', event, payload, ... }
        const anyEvt = evt as { type?: string; event?: string; payload?: unknown }
        if (anyEvt?.type !== 'event' || !anyEvt.event) return

        const legacyFrame: GatewayFrame = {
          event: anyEvt.event as GatewayFrame['event'],
          data: anyEvt.payload as any,
        }

        const normalized = normalizeFrame(legacyFrame)
        if (!normalized) return
        this.processEvent(normalized)
      })

      this.updateStatus('websocket')
      this.reconnectAttempt = 0
      console.log('[GatewayMirror] Connected (adapter) and subscribed to events')
    } catch (error) {
      console.error('[GatewayMirror] Adapter connect failed:', error)
      this.updateStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  private loadDeviceIdentity(): DeviceIdentity | undefined {
    // Prefer explicit env path if provided
    const identityPath = process.env.OPENCLAW_DEVICE_IDENTITY_PATH
      ? process.env.OPENCLAW_DEVICE_IDENTITY_PATH
      : join(homedir(), '.openclaw', 'identity', 'device.json')

    if (!existsSync(identityPath)) return undefined

    try {
      const raw = JSON.parse(readFileSync(identityPath, 'utf-8'))
      // Expected shape in adapters-openclaw: {deviceId, publicKeyPem, privateKeyPem}
      if (raw?.version === 1 && raw?.deviceId && raw?.publicKeyPem && raw?.privateKeyPem) {
        return {
          deviceId: raw.deviceId,
          publicKeyPem: raw.publicKeyPem,
          privateKeyPem: raw.privateKeyPem,
        }
      }
    } catch {
      // ignore
    }

    return undefined
  }

  private loadDeviceAuthToken(deviceId: string, role: string): string | undefined {
    const authPath = join(homedir(), '.openclaw', 'identity', 'device-auth.json')
    if (!existsSync(authPath)) return undefined

    try {
      const raw = JSON.parse(readFileSync(authPath, 'utf-8'))
      if (raw?.version === 1 && raw?.deviceId === deviceId && raw?.tokens?.[role]?.token) {
        return raw.tokens[role].token as string
      }
    } catch {
      // ignore
    }

    return undefined
  }

  private loadGatewayTokenFromConfigFile(): string | undefined {
    const tokenPath = this.config.tokenPath || join(homedir(), '.openclaw', 'openclaw.json')
    if (!existsSync(tokenPath)) return undefined

    try {
      const raw = JSON.parse(readFileSync(tokenPath, 'utf-8'))
      return (
        raw?.gateway?.auth?.token ||
        raw?.auth?.token ||
        raw?.token ||
        raw?.operator_token
      )
    } catch {
      return undefined
    }
  }

  private scheduleReconnect(): void {
    if (!this.started) return
    if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
      console.log('[GatewayMirror] Max reconnect attempts reached, staying disconnected')
      // TODO: Could implement polling fallback here
      return
    }

    this.reconnectAttempt++
    this.status.reconnectAttempt = this.reconnectAttempt

    // Exponential backoff with jitter
    const delay = Math.min(
      this.config.reconnectDelayMs * Math.pow(1.5, this.reconnectAttempt - 1) +
        Math.random() * 1000,
      30_000 // Max 30 seconds
    )

    console.log(`[GatewayMirror] Scheduling reconnect attempt ${this.reconnectAttempt} in ${Math.round(delay)}ms`)

    this.reconnectTimeout = setTimeout(() => {
      this.connectAdapter()
    }, delay)
  }

  // ==========================================================================
  // EVENT PROCESSING
  // ==========================================================================

  private processEvent(event: GatewayEvent): void {
    // Store the raw event
    this.store.addEvent(event)
    this.status.eventCount++
    this.status.lastEventAt = event.ts

    // Convert to graph updates
    const { nodes, edges } = eventToGraphUpdates(event)

    const addedNodes: typeof nodes = []
    const updatedNodes: typeof nodes = []
    const addedEdges: typeof edges = []

    // Upsert nodes
    for (const node of nodes) {
      const result = this.store.upsertNode(node)
      if (result.isNew) {
        addedNodes.push(result.node)
      } else {
        updatedNodes.push(result.node)
      }
    }

    // Add edges
    for (const edge of edges) {
      const result = this.store.addEdge(edge)
      if (result.isNew) {
        addedEdges.push(result.edge)
      }
    }

    // Handle subagent spawn detection
    if (isSubagentEvent(event)) {
      const parentMatch = this.store.findParentSession(event.sessionKey, event.ts)
      if (parentMatch) {
        const spawnEdge = createSpawnEdge(
          parentMatch.parentId,
          `session:${event.sessionId}`,
          parentMatch.confidence
        )
        const edgeResult = this.store.addEdge(spawnEdge)
        if (edgeResult.isNew) {
          addedEdges.push(edgeResult.edge)
        }
      }
    }

    // Update stats
    const stats = this.store.getStats()
    this.status.nodeCount = stats.nodeCount
    this.status.edgeCount = stats.edgeCount

    // Emit delta to subscribers
    if (addedNodes.length > 0 || updatedNodes.length > 0 || addedEdges.length > 0) {
      this.queueDelta({
        addedNodes,
        updatedNodes,
        removedNodeIds: [],
        addedEdges,
        removedEdgeIds: [],
        lastEventId: event.id,
      })
    }
  }

  // ==========================================================================
  // STATUS & SUBSCRIPTIONS
  // ==========================================================================

  private updateStatus(mode: MirrorMode): void {
    this.status.mode = mode
    if (mode === 'websocket') {
      this.status.connectedAt = new Date()
    } else {
      this.status.connectedAt = null
    }
    this.emit('status', this.status)
  }

  getStatus(): MirrorStatus {
    return { ...this.status }
  }

  getSnapshot(): GraphSnapshot {
    return this.store.getSnapshot()
  }

  /**
   * Subscribe to graph updates.
   * Returns an unsubscribe function.
   */
  subscribe(callback: (update: GraphUpdate) => void): () => void {
    const handler = (delta: GraphDelta) => {
      callback({ type: 'delta', delta })
    }

    this.on('delta', handler)

    // Start the service if not already started
    if (!this.started) {
      this.start()
    }

    return () => {
      this.off('delta', handler)
    }
  }

  private emitDelta(delta: GraphDelta): void {
    this.emit('delta', delta)
  }

  private queueDelta(delta: GraphDelta): void {
    if (!this.pendingDelta) {
      this.pendingDelta = {
        addedNodes: new Map(),
        updatedNodes: new Map(),
        removedNodeIds: new Set(),
        addedEdges: new Map(),
        removedEdgeIds: new Set(),
        lastEventId: delta.lastEventId,
      }
    }

    const pending = this.pendingDelta

    for (const id of delta.removedNodeIds) {
      pending.removedNodeIds.add(id)
      pending.addedNodes.delete(id)
      pending.updatedNodes.delete(id)
    }
    for (const id of delta.removedEdgeIds) {
      pending.removedEdgeIds.add(id)
      pending.addedEdges.delete(id)
    }

    for (const node of delta.addedNodes) {
      pending.addedNodes.set(node.id, node)
      pending.updatedNodes.delete(node.id)
      pending.removedNodeIds.delete(node.id)
    }

    for (const node of delta.updatedNodes) {
      if (pending.addedNodes.has(node.id)) {
        pending.addedNodes.set(node.id, node)
      } else {
        pending.updatedNodes.set(node.id, node)
      }
      pending.removedNodeIds.delete(node.id)
    }

    for (const edge of delta.addedEdges) {
      pending.addedEdges.set(edge.id, edge)
      pending.removedEdgeIds.delete(edge.id)
    }

    pending.lastEventId = delta.lastEventId

    if (!this.deltaFlushTimeout) {
      this.deltaFlushTimeout = setTimeout(() => {
        this.deltaFlushTimeout = null
        this.flushQueuedDelta()
      }, this.deltaFlushIntervalMs)
    }
  }

  private flushQueuedDelta(): void {
    const pending = this.pendingDelta
    if (!pending) return

    const delta: GraphDelta = {
      addedNodes: [...pending.addedNodes.values()],
      updatedNodes: [...pending.updatedNodes.values()],
      removedNodeIds: [...pending.removedNodeIds.values()],
      addedEdges: [...pending.addedEdges.values()],
      removedEdgeIds: [...pending.removedEdgeIds.values()],
      lastEventId: pending.lastEventId,
    }

    this.pendingDelta = null

    if (
      delta.addedNodes.length === 0 &&
      delta.updatedNodes.length === 0 &&
      delta.removedNodeIds.length === 0 &&
      delta.addedEdges.length === 0 &&
      delta.removedEdgeIds.length === 0
    ) {
      return
    }

    this.emitDelta(delta)
  }

  // ==========================================================================
  // STORE ACCESS
  // ==========================================================================

  /**
   * Pin a node to prevent eviction.
   */
  pinNode(nodeId: string): boolean {
    return this.store.pinNode(nodeId)
  }

  /**
   * Unpin a node.
   */
  unpinNode(nodeId: string): boolean {
    return this.store.unpinNode(nodeId)
  }

  /**
   * Get a specific node.
   */
  getNode(nodeId: string) {
    return this.store.getNode(nodeId)
  }

  /**
   * Get nodes filtered by various criteria.
   */
  getFilteredSnapshot(filters: {
    agentId?: string
    sessionKeyPattern?: string
    channel?: string
  }): GraphSnapshot {
    const snapshot = this.store.getSnapshot()

    // Apply filters
    let nodes = snapshot.nodes
    let edges = snapshot.edges

    if (filters.agentId) {
      nodes = nodes.filter((n) => n.agentId === filters.agentId)
    }

    if (filters.sessionKeyPattern) {
      const pattern = new RegExp(filters.sessionKeyPattern, 'i')
      nodes = nodes.filter((n) => n.sessionKey && pattern.test(n.sessionKey))
    }

    if (filters.channel) {
      nodes = nodes.filter(
        (n) => n.kind === 'chat' && n.metadata.channel === filters.channel
      )
    }

    // Filter edges to only include those connecting remaining nodes
    const nodeIds = new Set(nodes.map((n) => n.id))
    edges = edges.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))

    return {
      nodes,
      edges,
      lastEventId: snapshot.lastEventId,
      ts: snapshot.ts,
    }
  }
}
