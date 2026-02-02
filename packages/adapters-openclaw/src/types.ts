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

  // For remote_cli_over_ssh mode
  sshHost?: string
  sshUser?: string
  sshKeyPath?: string
}
