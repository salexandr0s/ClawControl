/**
 * OpenClaw Adapter Types
 */

export type AdapterMode =
  | 'mock'
  | 'local_cli'
  | 'remote_http'
  | 'remote_ws'
  | 'remote_cli_over_ssh'

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down'
  message?: string
  details?: Record<string, unknown>
  timestamp: string
}

export interface GatewayStatus {
  running: boolean
  version?: string
  build?: string
  uptime?: number
  clients?: number
}

export interface ProbeResult {
  ok: boolean
  latencyMs: number
  statusCode?: number
  reason?: 'ok' | 'auth_required' | 'unreachable'
}

export interface StreamChunk {
  type: 'stdout' | 'stderr'
  chunk: string
}

export interface ExitResult {
  type: 'exit'
  code: number
}

export type CommandOutput = StreamChunk | ExitResult

export interface ChannelsStatus {
  discord?: { status: string; error?: string }
  telegram?: { status: string; error?: string }
}

export interface ModelsStatus {
  models: string[]
  default?: string
}

export interface PluginInfo {
  id: string
  name: string
  version?: string
  enabled: boolean
  status: 'ok' | 'error' | 'disabled'
  configSchema?: Record<string, unknown>
}

export interface PluginDoctorResult {
  ok: boolean
  issues: Array<{
    pluginId: string
    severity: 'error' | 'warning'
    message: string
  }>
}

/**
 * OpenClaw Adapter Interface
 *
 * All OpenClaw interactions go through this adapter.
 * Implementations exist for mock, local CLI, remote HTTP, etc.
 */
export interface OpenClawAdapter {
  /**
   * Current adapter mode
   */
  readonly mode: AdapterMode

  /**
   * Health & Status
   */
  healthCheck(): Promise<HealthCheckResult>
  gatewayStatus(options?: { deep?: boolean }): Promise<GatewayStatus>
  gatewayProbe(): Promise<ProbeResult>

  /**
   * Logs
   */
  tailLogs(options?: {
    limit?: number
    follow?: boolean
  }): AsyncGenerator<string, void, unknown>

  /**
   * Channels
   */
  channelsStatus(options?: { probe?: boolean }): Promise<ChannelsStatus>

  /**
   * Models
   */
  modelsStatus(options?: { check?: boolean }): Promise<ModelsStatus>

  /**
   * Agent Messaging
   */
  sendToAgent(
    target: string,
    message: string,
    options?: { stream?: boolean }
  ): AsyncGenerator<string, void, unknown>

  /**
   * Command Execution
   */
  runCommandTemplate(
    templateId: string,
    args: Record<string, unknown>
  ): AsyncGenerator<CommandOutput, void, unknown>

  /**
   * Gateway Control
   */
  gatewayRestart(): Promise<void>

  /**
   * Plugin Management
   */
  listPlugins(): Promise<PluginInfo[]>
  pluginInfo(id: string): Promise<PluginInfo>
  pluginDoctor(): Promise<PluginDoctorResult>
  installPlugin(spec: string): AsyncGenerator<string, void, unknown>
  enablePlugin(id: string): Promise<void>
  disablePlugin(id: string): Promise<void>

  /**
   * Events (optional - for richer Live View)
   */
  subscribeEvents?(
    callback: (event: unknown) => void
  ): () => void
}

/**
 * Adapter configuration
 */
export interface AdapterConfig {
  mode: AdapterMode

  // For remote_http mode
  httpBaseUrl?: string
  httpToken?: string
  httpPassword?: string

  // For remote_ws mode
  wsUrl?: string
  wsToken?: string
  wsPassword?: string
  wsClientId?: GatewayClientId
  wsClientMode?: GatewayClientMode
  wsReadonly?: boolean  // If true, skip write methods (chat.send, chat.inject, chat.abort)
  wsProtocolVersion?: number
  wsDeviceIdentity?: DeviceIdentity  // For device-based authentication

  // For remote_cli_over_ssh mode
  sshHost?: string
  sshUser?: string
  sshKeyPath?: string
}

// ============================================================================
// Device Identity Types
// ============================================================================

/**
 * Device identity for authenticated connections.
 * Load from ~/.openclaw/identity/device.json
 */
export interface DeviceIdentity {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
}

/**
 * Device auth token cached after pairing.
 * Load from ~/.openclaw/identity/device-auth.json
 */
export interface DeviceAuthTokenCache {
  version: 1
  deviceId: string
  tokens: Record<string, {
    token: string
    role: string
    scopes: string[]
    updatedAtMs: number
  }>
}

// ============================================================================
// WebSocket Protocol Types (schema-driven from OpenClaw gateway)
// ============================================================================

/**
 * Protocol version - should match gateway's PROTOCOL_VERSION
 * As of OpenClaw latest: PROTOCOL_VERSION = 3
 */
export const WS_PROTOCOL_VERSION = 3

/**
 * WebSocket request frame
 */
export interface WsRequestFrame {
  type: 'req'
  id: string
  method: string
  params?: unknown
}

/**
 * WebSocket response frame
 */
export interface WsResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: WsErrorShape
}

/**
 * WebSocket event frame
 */
export interface WsEventFrame {
  type: 'event'
  event: string
  payload?: unknown
  seq?: number
  stateVersion?: unknown
}

/**
 * WebSocket error shape
 */
export interface WsErrorShape {
  code: string
  message: string
  details?: unknown
  retryable?: boolean
  retryAfterMs?: number
}

/**
 * Gateway client IDs - must match gateway's GATEWAY_CLIENT_IDS
 */
export const GATEWAY_CLIENT_IDS = {
  WEBCHAT_UI: 'webchat-ui',
  CONTROL_UI: 'openclaw-control-ui',
  WEBCHAT: 'webchat',
  CLI: 'cli',
  GATEWAY_CLIENT: 'gateway-client',
  MACOS_APP: 'openclaw-macos',
  IOS_APP: 'openclaw-ios',
  ANDROID_APP: 'openclaw-android',
  NODE_HOST: 'node-host',
  TEST: 'test',
  FINGERPRINT: 'fingerprint',
  PROBE: 'openclaw-probe',
} as const

export type GatewayClientId = (typeof GATEWAY_CLIENT_IDS)[keyof typeof GATEWAY_CLIENT_IDS]

/**
 * Gateway client modes - must match gateway's GATEWAY_CLIENT_MODES
 */
export const GATEWAY_CLIENT_MODES = {
  WEBCHAT: 'webchat',
  CLI: 'cli',
  UI: 'ui',
  BACKEND: 'backend',
  NODE: 'node',
  PROBE: 'probe',
  TEST: 'test',
} as const

export type GatewayClientMode = (typeof GATEWAY_CLIENT_MODES)[keyof typeof GATEWAY_CLIENT_MODES]

/**
 * Connect params (handshake)
 */
export interface WsConnectParams {
  minProtocol: number
  maxProtocol: number
  client: {
    id: GatewayClientId
    displayName?: string
    version: string
    platform: string
    deviceFamily?: string
    modelIdentifier?: string
    mode: GatewayClientMode
    instanceId?: string
  }
  caps?: string[]
  commands?: string[]
  permissions?: Record<string, boolean>
  pathEnv?: string
  role?: string
  scopes?: string[]
  device?: {
    id: string
    publicKey: string
    signature: string
    signedAt: number
    nonce?: string
  }
  auth?: {
    token?: string
    password?: string
  }
  locale?: string
  userAgent?: string
}

/**
 * Hello-ok response after successful connect
 */
export interface WsHelloOk {
  type: 'hello-ok'
  protocol: number
  server: {
    version: string
    commit?: string
    host?: string
    connId: string
  }
  features: {
    methods: string[]
    events: string[]
  }
  snapshot: unknown
  canvasHostUrl?: string
  auth?: {
    deviceToken: string
    role: string
    scopes: string[]
    issuedAtMs?: number
  }
  policy: {
    maxPayload: number
    maxBufferedBytes: number
    tickIntervalMs: number
  }
}

// ============================================================================
// Chat Types (session-scoped messaging)
// ============================================================================

/**
 * chat.send params
 */
export interface ChatSendParams {
  sessionKey: string
  message: string
  idempotencyKey: string
  thinking?: string
  deliver?: boolean
  attachments?: unknown[]
  timeoutMs?: number
}

/**
 * chat.send response
 */
export interface ChatSendResult {
  runId: string
  status: 'started' | 'in_flight' | 'ok' | 'error'
  summary?: string
}

/**
 * chat.history params
 */
export interface ChatHistoryParams {
  sessionKey: string
  limit?: number
}

/**
 * chat.history response
 */
export interface ChatHistoryResult {
  sessionKey: string
  sessionId?: string
  messages: ChatMessage[]
  thinkingLevel?: string
}

/**
 * Chat message from history
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: unknown
  timestamp?: number
  stopReason?: string
  usage?: unknown
}

/**
 * chat.inject params
 */
export interface ChatInjectParams {
  sessionKey: string
  message: string
  label?: string
}

/**
 * chat.inject response
 */
export interface ChatInjectResult {
  ok: boolean
  messageId: string
}

/**
 * chat.abort params
 */
export interface ChatAbortParams {
  sessionKey: string
  runId?: string
}

/**
 * chat.abort response
 */
export interface ChatAbortResult {
  ok: boolean
  aborted: boolean
  runIds: string[]
}

/**
 * Chat event (streaming)
 */
export interface ChatEvent {
  runId: string
  sessionKey: string
  seq: number
  state: 'delta' | 'final' | 'aborted' | 'error'
  message?: unknown
  errorMessage?: string
  usage?: unknown
  stopReason?: string
}

// ============================================================================
// Sessions Types
// ============================================================================

/**
 * sessions.list params
 */
export interface SessionsListParams {
  agentId?: string
  state?: string
  kind?: string
  limit?: number
}

/**
 * Session entry from sessions.list
 */
export interface SessionEntry {
  key: string
  sessionId?: string
  agentId?: string
  channel?: string
  chatType?: string
  model?: string
  thinkingLevel?: string
  updatedAt?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  label?: string
  /** Inactivity-based idle timeout in hours (OpenClaw v2026.2.27+) */
  idleHours?: number
  /** Maximum session age in hours (OpenClaw v2026.2.27+) */
  maxAgeHours?: number
  /** Thread lifecycle state (OpenClaw v2026.2.27+) */
  threadState?: 'active' | 'idle' | 'expired'
}

/**
 * sessions.list response
 */
export interface SessionsListResult {
  sessions: SessionEntry[]
  total?: number
}

/**
 * sessions.delete params
 */
export interface SessionsDeleteParams {
  key: string
  deleteTranscript?: boolean
}

/**
 * sessions.delete response
 */
export interface SessionsDeleteResult {
  ok: boolean
  key: string
  deleted: boolean
  archived?: string[]
}

// ============================================================================
// Extended Adapter Interface for WebSocket
// ============================================================================

/**
 * Extended adapter interface with session-scoped chat methods.
 * Used by WsAdapter for true session messaging.
 */
export interface OpenClawWsAdapter extends OpenClawAdapter {
  /**
   * Session-scoped chat: send message to specific session
   */
  chatSend(params: ChatSendParams): Promise<ChatSendResult>

  /**
   * Session-scoped chat: get history for session
   */
  chatHistory(params: ChatHistoryParams): Promise<ChatHistoryResult>

  /**
   * Session-scoped chat: inject assistant message into transcript
   */
  chatInject(params: ChatInjectParams): Promise<ChatInjectResult>

  /**
   * Session-scoped chat: abort running chat
   */
  chatAbort(params: ChatAbortParams): Promise<ChatAbortResult>

  /**
   * List sessions with metadata
   */
  sessionsList(params?: SessionsListParams): Promise<SessionsListResult>

  /**
   * Delete/archive a session
   */
  sessionsDelete(params: SessionsDeleteParams): Promise<SessionsDeleteResult>

  /**
   * Stream chat events for a session/run
   */
  streamChatEvents(
    sessionKey: string,
    callback: (event: ChatEvent) => void
  ): () => void

  /**
   * Check if connected
   */
  isConnected(): boolean

  /**
   * Disconnect from gateway
   */
  disconnect(): Promise<void>
}
