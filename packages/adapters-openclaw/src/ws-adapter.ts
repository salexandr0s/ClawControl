/**
 * WebSocket Adapter for OpenClaw Gateway
 *
 * Implements session-scoped messaging via the gateway's native WS protocol.
 * Schema-driven from OpenClaw gateway source.
 *
 * Features:
 * - connect handshake with protocol negotiation
 * - chat.send (session-targeted, triggers agent response)
 * - chat.inject (inject assistant message, no response)
 * - chat.history (get session transcript)
 * - chat.abort (abort running chat)
 * - sessions.list (list sessions with metadata)
 * - Event streaming for real-time updates
 *
 * Security:
 * - Loopback-only by default (ws://127.0.0.1:...)
 * - Token/password auth support
 * - Readonly vs readwrite modes
 */

import { randomUUID } from 'crypto'
import crypto from 'crypto'
import WebSocket from 'ws'
import type {
  AdapterConfig,
  AdapterMode,
  OpenClawWsAdapter,
  HealthCheckResult,
  GatewayStatus,
  ProbeResult,
  ChannelsStatus,
  ModelsStatus,
  PluginInfo,
  PluginDoctorResult,
  CommandOutput,
  WsRequestFrame,
  WsResponseFrame,
  WsEventFrame,
  WsConnectParams,
  WsHelloOk,
  WsErrorShape,
  ChatSendParams,
  ChatSendResult,
  ChatHistoryParams,
  ChatHistoryResult,
  ChatInjectParams,
  ChatInjectResult,
  ChatAbortParams,
  ChatAbortResult,
  ChatEvent,
  SessionsListParams,
  SessionsListResult,
  GatewayClientId,
  GatewayClientMode,
  DeviceIdentity as _DeviceIdentity,
} from './types'
import { WS_PROTOCOL_VERSION, GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from './types'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WS_URL = 'ws://127.0.0.1:18789'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const CONNECT_TIMEOUT_MS = 10000
const REQUEST_TIMEOUT_MS = 30000

// Client identification
const CLIENT_VERSION = '1.0.0'
const CLIENT_PLATFORM = 'nodejs'

// ============================================================================
// Helper Types
// ============================================================================

interface PendingRequest {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

type WsFrame = WsResponseFrame | WsEventFrame | WsHelloOk

// ============================================================================
// WsAdapter Implementation
// ============================================================================

export class WsAdapter implements OpenClawWsAdapter {
  readonly mode: AdapterMode = 'remote_ws'

  private config: AdapterConfig
  private ws: WebSocket | null = null
  private connected = false
  private helloOk: WsHelloOk | null = null
  private connectNonce: string | null = null

  // Request/response tracking
  private pendingRequests = new Map<string, PendingRequest>()
  private requestIdCounter = 0

  // Event listeners
  private chatEventListeners = new Map<string, Set<(event: ChatEvent) => void>>()
  private globalEventListeners = new Set<(event: unknown) => void>()

  constructor(config: AdapterConfig) {
    this.config = config
    this.validateConfig()
  }

  // ============================================================================
  // Configuration & Validation
  // ============================================================================

  private validateConfig(): void {
    const url = this.config.wsUrl ?? DEFAULT_WS_URL

    // Enforce loopback unless explicitly overridden
    if (!process.env.OPENCLAW_ALLOW_NON_LOOPBACK) {
      try {
        const parsed = new URL(url)
        if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
          throw new Error(
            `WsAdapter requires loopback address (got: ${parsed.hostname}). ` +
            `Set OPENCLAW_ALLOW_NON_LOOPBACK=true to override.`
          )
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('loopback')) {
          throw err
        }
        throw new Error(`Invalid WebSocket URL: ${url}`)
      }
    }
  }

  private get wsUrl(): string {
    return this.config.wsUrl ?? DEFAULT_WS_URL
  }

  private get clientId(): GatewayClientId {
    return this.config.wsClientId ?? GATEWAY_CLIENT_IDS.GATEWAY_CLIENT
  }

  private get clientMode(): GatewayClientMode {
    return this.config.wsClientMode ?? GATEWAY_CLIENT_MODES.BACKEND
  }

  private get isReadonly(): boolean {
    return this.config.wsReadonly ?? false
  }

  private get protocolVersion(): number {
    return this.config.wsProtocolVersion ?? WS_PROTOCOL_VERSION
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<WsHelloOk> {
    if (this.connected && this.ws && this.helloOk) {
      return this.helloOk
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanup()
        reject(new Error(`Connection timeout after ${CONNECT_TIMEOUT_MS}ms`))
      }, CONNECT_TIMEOUT_MS)

      try {
        this.ws = new WebSocket(this.wsUrl)

        this.ws.on('open', () => {
          // Don't send connect yet - wait for connect.challenge event
        })

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const frame = JSON.parse(data.toString()) as WsFrame

            // Handle event frames (including connect.challenge)
            if ('type' in frame && frame.type === 'event') {
              const eventFrame = frame as WsEventFrame

              // Handle connect.challenge - this triggers the connect request
              if (eventFrame.event === 'connect.challenge') {
                const payload = eventFrame.payload as { nonce?: string } | undefined
                if (payload?.nonce) {
                  this.connectNonce = payload.nonce
                }
                this.sendConnectRequest()
                return
              }

              this.handleEvent(eventFrame)
              return
            }

            // Handle response frames
            if ('type' in frame && frame.type === 'res') {
              const resFrame = frame as WsResponseFrame

              // Handle connect response (contains hello-ok in payload)
              if (resFrame.id === 'connect') {
                clearTimeout(timeout)
                if (!resFrame.ok) {
                  const error = resFrame.error as WsErrorShape | undefined
                  reject(new Error(error?.message ?? 'Connect failed'))
                  return
                }
                // hello-ok is inside the payload
                this.helloOk = resFrame.payload as WsHelloOk
                this.connected = true
                resolve(this.helloOk)
                return
              }

              this.handleResponse(resFrame)
              return
            }
          } catch (err) {
            console.error('[WsAdapter] Failed to parse message:', err)
          }
        })

        this.ws.on('error', (err) => {
          clearTimeout(timeout)
          this.cleanup()
          reject(new Error(`WebSocket error: ${err.message}`))
        })

        this.ws.on('close', (code, reason) => {
          clearTimeout(timeout)
          this.cleanup()
          if (!this.connected) {
            reject(new Error(`WebSocket closed before connect: ${code} ${reason}`))
          }
        })
      } catch (err) {
        clearTimeout(timeout)
        reject(err)
      }
    })
  }

  private sendConnectRequest(): void {
    const role = 'operator'
    // Use operator scopes that the gateway understands
    // operator.admin is sufficient for most methods (sessions.list, chat.send, chat.history)
    const scopes = this.isReadonly
      ? ['operator.admin']
      : ['operator.admin', 'operator.approvals', 'operator.pairing']

    const signedAtMs = Date.now()
    const nonce = this.connectNonce ?? undefined

    // Build device auth if we have device identity
    let device: WsConnectParams['device'] = undefined
    if (this.config.wsDeviceIdentity) {
      const payload = buildDeviceAuthPayload({
        deviceId: this.config.wsDeviceIdentity.deviceId,
        clientId: this.clientId,
        clientMode: this.clientMode,
        role,
        scopes,
        signedAtMs,
        token: this.config.wsToken ?? null,
        nonce,
      })
      const signature = signDevicePayload(this.config.wsDeviceIdentity.privateKeyPem, payload)
      device = {
        id: this.config.wsDeviceIdentity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(this.config.wsDeviceIdentity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      }
    }

    const params: WsConnectParams = {
      minProtocol: this.protocolVersion,
      maxProtocol: this.protocolVersion,
      client: {
        id: this.clientId,
        displayName: 'Mission Control',
        version: CLIENT_VERSION,
        platform: CLIENT_PLATFORM,
        mode: this.clientMode,
        instanceId: randomUUID().slice(0, 8),
      },
      role,
      scopes,
      device,
    }

    // Add auth if configured
    if (this.config.wsToken || this.config.wsPassword) {
      params.auth = {
        token: this.config.wsToken,
        password: this.config.wsPassword,
      }
    }

    const frame: WsRequestFrame = {
      type: 'req',
      id: 'connect',
      method: 'connect',
      params,
    }

    this.ws?.send(JSON.stringify(frame))
  }

  async disconnect(): Promise<void> {
    this.cleanup()
  }

  private cleanup(): void {
    this.connected = false
    this.helloOk = null

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Connection closed'))
      this.pendingRequests.delete(id)
    }

    // Close WebSocket
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore close errors
      }
      this.ws = null
    }
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  // ============================================================================
  // Request/Response Handling
  // ============================================================================

  private async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.isConnected()) {
      await this.connect()
    }

    const id = `req-${++this.requestIdCounter}-${Date.now()}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout for ${method} after ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(id, {
        resolve: (payload) => {
          clearTimeout(timeout)
          this.pendingRequests.delete(id)
          resolve(payload as T)
        },
        reject: (error) => {
          clearTimeout(timeout)
          this.pendingRequests.delete(id)
          reject(error)
        },
        timeout,
      })

      const frame: WsRequestFrame = {
        type: 'req',
        id,
        method,
        params,
      }

      this.ws?.send(JSON.stringify(frame))
    })
  }

  private handleResponse(frame: WsResponseFrame): void {
    const pending = this.pendingRequests.get(frame.id)
    if (!pending) {
      return
    }

    if (frame.ok) {
      pending.resolve(frame.payload)
    } else {
      const error = frame.error as WsErrorShape | undefined
      pending.reject(new Error(error?.message ?? 'Request failed'))
    }
  }

  private handleEvent(frame: WsEventFrame): void {
    // Notify global listeners
    for (const listener of this.globalEventListeners) {
      try {
        listener(frame)
      } catch (err) {
        console.error('[WsAdapter] Event listener error:', err)
      }
    }

    // Handle chat events specifically
    if (frame.event === 'chat' && frame.payload) {
      const chatEvent = frame.payload as ChatEvent
      const sessionKey = chatEvent.sessionKey

      // Notify session-specific listeners
      const listeners = this.chatEventListeners.get(sessionKey)
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(chatEvent)
          } catch (err) {
            console.error('[WsAdapter] Chat event listener error:', err)
          }
        }
      }

      // Also notify by runId
      const runListeners = this.chatEventListeners.get(chatEvent.runId)
      if (runListeners) {
        for (const listener of runListeners) {
          try {
            listener(chatEvent)
          } catch (err) {
            console.error('[WsAdapter] Chat event listener error:', err)
          }
        }
      }
    }
  }

  // ============================================================================
  // Chat Methods (Session-Scoped)
  // ============================================================================

  async chatSend(params: ChatSendParams): Promise<ChatSendResult> {
    if (this.isReadonly) {
      throw new Error('chatSend requires readwrite mode (wsReadonly: false)')
    }

    return this.request<ChatSendResult>('chat.send', params)
  }

  async chatHistory(params: ChatHistoryParams): Promise<ChatHistoryResult> {
    return this.request<ChatHistoryResult>('chat.history', params)
  }

  async chatInject(params: ChatInjectParams): Promise<ChatInjectResult> {
    if (this.isReadonly) {
      throw new Error('chatInject requires readwrite mode (wsReadonly: false)')
    }

    return this.request<ChatInjectResult>('chat.inject', params)
  }

  async chatAbort(params: ChatAbortParams): Promise<ChatAbortResult> {
    if (this.isReadonly) {
      throw new Error('chatAbort requires readwrite mode (wsReadonly: false)')
    }

    return this.request<ChatAbortResult>('chat.abort', params)
  }

  // ============================================================================
  // Sessions Methods
  // ============================================================================

  async sessionsList(params?: SessionsListParams): Promise<SessionsListResult> {
    return this.request<SessionsListResult>('sessions.list', params ?? {})
  }

  // ============================================================================
  // Event Streaming
  // ============================================================================

  streamChatEvents(
    sessionKeyOrRunId: string,
    callback: (event: ChatEvent) => void
  ): () => void {
    let listeners = this.chatEventListeners.get(sessionKeyOrRunId)
    if (!listeners) {
      listeners = new Set()
      this.chatEventListeners.set(sessionKeyOrRunId, listeners)
    }
    listeners.add(callback)

    // Return unsubscribe function
    return () => {
      listeners?.delete(callback)
      if (listeners?.size === 0) {
        this.chatEventListeners.delete(sessionKeyOrRunId)
      }
    }
  }

  subscribeEvents(callback: (event: unknown) => void): () => void {
    this.globalEventListeners.add(callback)
    return () => {
      this.globalEventListeners.delete(callback)
    }
  }

  // ============================================================================
  // OpenClawAdapter Interface Implementation (delegates to existing methods)
  // ============================================================================

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const hello = await this.connect()
      return {
        status: 'ok',
        message: `Connected to gateway v${hello.server.version}`,
        details: {
          connId: hello.server.connId,
          protocol: hello.protocol,
          methods: hello.features.methods,
        },
        timestamp: new Date().toISOString(),
      }
    } catch (err) {
      return {
        status: 'down',
        message: err instanceof Error ? err.message : 'Connection failed',
        timestamp: new Date().toISOString(),
      }
    }
  }

  async gatewayStatus(_options?: { deep?: boolean }): Promise<GatewayStatus> {
    try {
      const hello = await this.connect()
      return {
        running: true,
        version: hello.server.version,
        build: hello.server.commit,
      }
    } catch {
      return { running: false }
    }
  }

  async gatewayProbe(): Promise<ProbeResult> {
    const start = Date.now()
    try {
      await this.connect()
      return { ok: true, latencyMs: Date.now() - start }
    } catch {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }

  async *tailLogs(options?: { limit?: number }): AsyncGenerator<string> {
    // Attempt to subscribe to logs via WebSocket
    try {
      await this.connect()

      // Try to request logs via 'logs.tail' method
      const result = await this.request<{ logs?: string[] }>('logs.tail', {
        limit: options?.limit ?? 50,
      })

      if (result.logs && Array.isArray(result.logs)) {
        for (const log of result.logs) {
          yield log
        }
      }
    } catch (err) {
      // Method not supported - yield error message
      yield `[WsAdapter] Log tailing via WebSocket: ${err instanceof Error ? err.message : 'not supported'}`
    }
  }

  async channelsStatus(options?: { probe?: boolean }): Promise<ChannelsStatus> {
    try {
      await this.connect()

      // Try to get channel status via 'channels.status' method
      const result = await this.request<ChannelsStatus>('channels.status', {
        probe: options?.probe ?? false,
      })

      return result ?? {}
    } catch {
      // Method not supported - return empty status
      return {}
    }
  }

  async modelsStatus(options?: { check?: boolean }): Promise<ModelsStatus> {
    try {
      await this.connect()

      // Try to get models via 'models.list' method
      const result = await this.request<ModelsStatus>('models.list', {
        check: options?.check ?? false,
      })

      return result ?? { models: [] }
    } catch {
      // Method not supported - return empty list
      return { models: [] }
    }
  }

  async *sendToAgent(
    target: string,
    message: string,
    _options?: { stream?: boolean }
  ): AsyncGenerator<string> {
    // For compatibility: use chatSend with the target as sessionKey
    // Note: This assumes target is a sessionKey, not just agentId
    const result = await this.chatSend({
      sessionKey: target,
      message,
      idempotencyKey: randomUUID(),
    })

    // Set up streaming listener
    const chunks: string[] = []
    let done = false
    let error: Error | null = null

    const unsubscribe = this.streamChatEvents(result.runId, (event) => {
      if (event.state === 'delta' && event.message) {
        const content = extractTextContent(event.message)
        if (content) {
          chunks.push(content)
        }
      } else if (event.state === 'final') {
        done = true
      } else if (event.state === 'error') {
        error = new Error(event.errorMessage ?? 'Chat error')
        done = true
      } else if (event.state === 'aborted') {
        done = true
      }
    })

    try {
      // Yield chunks as they arrive
      while (!done) {
        if (chunks.length > 0) {
          yield chunks.shift()!
        } else {
          await new Promise((r) => setTimeout(r, 50))
        }
      }

      // Yield remaining chunks
      for (const chunk of chunks) {
        yield chunk
      }

      if (error) {
        throw error
      }
    } finally {
      unsubscribe()
    }
  }

  async *runCommandTemplate(
    templateId: string,
    args: Record<string, unknown>
  ): AsyncGenerator<CommandOutput> {
    try {
      await this.connect()

      // Try to run command template via 'command.run' method
      const result = await this.request<{ output?: string; exitCode?: number }>('command.run', {
        templateId,
        args,
      })

      if (result.output) {
        yield { type: 'stdout', chunk: result.output }
      }
      yield { type: 'exit', code: result.exitCode ?? 0 }
    } catch (err) {
      yield { type: 'stderr', chunk: `[WsAdapter] Command template: ${err instanceof Error ? err.message : 'not supported'}\n` }
      yield { type: 'exit', code: 1 }
    }
  }

  async gatewayRestart(): Promise<void> {
    try {
      await this.connect()

      // Try to restart gateway via 'gateway.restart' method
      await this.request<{ ok: boolean }>('gateway.restart', {})

      // Close our connection since gateway is restarting
      this.cleanup()
    } catch (err) {
      throw new Error(`Gateway restart via WebSocket: ${err instanceof Error ? err.message : 'not supported'}`)
    }
  }

  async listPlugins(): Promise<PluginInfo[]> {
    try {
      await this.connect()

      // Try to get plugins via 'plugins.list' method
      const result = await this.request<{ plugins?: PluginInfo[] }>('plugins.list', {})

      return result.plugins ?? []
    } catch {
      // Method not supported - return empty list
      return []
    }
  }

  async pluginInfo(id: string): Promise<PluginInfo> {
    try {
      await this.connect()

      // Try to get plugin info via 'plugins.info' method
      const result = await this.request<PluginInfo>('plugins.info', { id })

      if (!result) {
        throw new Error(`Plugin not found: ${id}`)
      }

      return result
    } catch (err) {
      // If method not supported, try to get from list
      const plugins = await this.listPlugins()
      const plugin = plugins.find((p) => p.id === id || p.name === id)

      if (plugin) {
        return plugin
      }

      throw new Error(`Plugin info via WebSocket: ${err instanceof Error ? err.message : 'not supported'}`)
    }
  }

  async pluginDoctor(): Promise<PluginDoctorResult> {
    try {
      await this.connect()

      // Try to run plugin doctor via 'plugins.doctor' method
      const result = await this.request<PluginDoctorResult>('plugins.doctor', {})

      return result ?? { ok: true, issues: [] }
    } catch {
      // Method not supported - return healthy status
      return { ok: true, issues: [] }
    }
  }

  async *installPlugin(spec: string): AsyncGenerator<string> {
    try {
      await this.connect()

      yield `[WsAdapter] Installing plugin: ${spec}\n`

      // Try to install plugin via 'plugins.install' method
      const result = await this.request<{ ok: boolean; message?: string }>('plugins.install', { spec })

      if (result.ok) {
        yield `[WsAdapter] Plugin installed successfully\n`
      } else {
        yield `[WsAdapter] Plugin install failed: ${result.message ?? 'unknown error'}\n`
      }
    } catch (err) {
      yield `[WsAdapter] Plugin install via WebSocket: ${err instanceof Error ? err.message : 'not supported'}\n`
    }
  }

  async enablePlugin(id: string): Promise<void> {
    try {
      await this.connect()

      // Try to enable plugin via 'plugins.enable' method
      await this.request<{ ok: boolean }>('plugins.enable', { id })
    } catch (err) {
      throw new Error(`Plugin enable via WebSocket: ${err instanceof Error ? err.message : 'not supported'}`)
    }
  }

  async disablePlugin(id: string): Promise<void> {
    try {
      await this.connect()

      // Try to disable plugin via 'plugins.disable' method
      await this.request<{ ok: boolean }>('plugins.disable', { id })
    } catch (err) {
      throw new Error(`Plugin disable via WebSocket: ${err instanceof Error ? err.message : 'not supported'}`)
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractTextContent(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null
  }

  const msg = message as Record<string, unknown>

  // Handle content array format
  if (Array.isArray(msg.content)) {
    for (const item of msg.content) {
      if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
        return String(item.text)
      }
    }
  }

  // Handle string content
  if (typeof msg.content === 'string') {
    return msg.content
  }

  return null
}

// ============================================================================
// Device Identity Helpers (ported from OpenClaw)
// ============================================================================

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem)
  const spki = key.export({ type: 'spki', format: 'der' }) as Buffer
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length)
  }
  return spki
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem))
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem)
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key)
  return base64UrlEncode(sig)
}

interface DeviceAuthPayloadParams {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token?: string | null
  nonce?: string | null
}

function buildDeviceAuthPayload(params: DeviceAuthPayloadParams): string {
  const version = params.nonce ? 'v2' : 'v1'
  const scopes = params.scopes.join(',')
  const token = params.token ?? ''
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ]
  if (version === 'v2') {
    base.push(params.nonce ?? '')
  }
  return base.join('|')
}
