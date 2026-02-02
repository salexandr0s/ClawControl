/**
 * Adapter factory and implementations
 */

import type {
  AdapterMode,
  AdapterConfig,
  OpenClawAdapter,
  HealthCheckResult,
  GatewayStatus,
  ProbeResult,
  ChannelsStatus,
  ModelsStatus,
  PluginInfo,
  PluginDoctorResult,
  CommandOutput,
} from './types'

import {
  runCommand,
  runCommandJson,
  executeCommand,
  checkOpenClawAvailable,
} from './command-runner'

/**
 * Create an OpenClaw adapter based on configuration
 */
export function createAdapter(config: AdapterConfig): OpenClawAdapter {
  switch (config.mode) {
    case 'mock':
      return new MockAdapter()
    case 'local_cli':
      return new LocalCliAdapter()
    case 'remote_http':
      if (!config.httpBaseUrl) {
        throw new Error('httpBaseUrl required for remote_http mode')
      }
      return new HttpAdapter(config)
    case 'remote_ws':
      throw new Error('WebSocket adapter not yet implemented')
    case 'remote_cli_over_ssh':
      throw new Error('SSH CLI adapter not yet implemented')
    default:
      throw new Error(`Unknown adapter mode: ${config.mode}`)
  }
}

/**
 * Get the default adapter (local_cli in production, mock in development)
 */
export function getDefaultAdapter(): OpenClawAdapter {
  const isDev = process.env.NODE_ENV === 'development'
  const mode: AdapterMode = isDev ? 'mock' : 'local_cli'
  return createAdapter({ mode })
}

/**
 * Mock Adapter for development
 */
class MockAdapter implements OpenClawAdapter {
  readonly mode: AdapterMode = 'mock'

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      status: 'ok',
      message: 'Mock gateway healthy',
      timestamp: new Date().toISOString(),
    }
  }

  async gatewayStatus(): Promise<GatewayStatus> {
    return {
      running: true,
      version: '1.0.0-mock',
      build: 'mock-build',
      uptime: 3600,
      clients: 2,
    }
  }

  async gatewayProbe(): Promise<ProbeResult> {
    return { ok: true, latencyMs: 5 }
  }

  async *tailLogs(options?: { limit?: number }): AsyncGenerator<string> {
    const logs = [
      '[INFO] Gateway started',
      '[INFO] Client connected: savorgBUILD',
      '[INFO] Client connected: savorgQA',
      '[INFO] Agent ready: savorgCEO',
      '[DEBUG] Health check passed',
    ]
    for (const log of logs.slice(0, options?.limit ?? 10)) {
      yield log
    }
  }

  async channelsStatus(): Promise<ChannelsStatus> {
    return {
      discord: { status: 'connected' },
      telegram: { status: 'connected' },
    }
  }

  async modelsStatus(): Promise<ModelsStatus> {
    return {
      models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
      default: 'claude-3-sonnet',
    }
  }

  async *sendToAgent(target: string, message: string): AsyncGenerator<string> {
    yield `[Mock] Received message for ${target}\n`
    yield `[Mock] Processing: "${message.slice(0, 50)}..."\n`
    await new Promise((r) => setTimeout(r, 100))
    yield `[Mock] Response from ${target}: Task acknowledged.\n`
  }

  async *runCommandTemplate(
    templateId: string,
    _args: Record<string, unknown>
  ): AsyncGenerator<CommandOutput> {
    yield { type: 'stdout', chunk: `[Mock] Running template: ${templateId}\n` }
    await new Promise((r) => setTimeout(r, 200))
    yield { type: 'stdout', chunk: '[Mock] Checking status...\n' }
    await new Promise((r) => setTimeout(r, 200))
    yield { type: 'stdout', chunk: '[Mock] Complete.\n' }
    yield { type: 'exit', code: 0 }
  }

  async gatewayRestart(): Promise<void> {
    // Mock restart - no-op
  }

  async listPlugins(): Promise<PluginInfo[]> {
    return [
      { id: 'plugin-discord', name: 'Discord', version: '1.0.0', enabled: true, status: 'ok' },
      { id: 'plugin-telegram', name: 'Telegram', version: '1.0.0', enabled: true, status: 'ok' },
      { id: 'plugin-mcp', name: 'MCP Server', version: '0.5.0', enabled: false, status: 'disabled' },
    ]
  }

  async pluginInfo(id: string): Promise<PluginInfo> {
    const plugins = await this.listPlugins()
    const plugin = plugins.find((p) => p.id === id)
    if (!plugin) throw new Error(`Plugin not found: ${id}`)
    return plugin
  }

  async pluginDoctor(): Promise<PluginDoctorResult> {
    return { ok: true, issues: [] }
  }

  async *installPlugin(spec: string): AsyncGenerator<string> {
    yield `[Mock] Installing ${spec}...\n`
    await new Promise((r) => setTimeout(r, 500))
    yield '[Mock] Installation complete.\n'
  }

  async enablePlugin(_id: string): Promise<void> {}
  async disablePlugin(_id: string): Promise<void> {}
}

/**
 * Local CLI Adapter (default) - uses `openclaw` commands
 */
class LocalCliAdapter implements OpenClawAdapter {
  readonly mode: AdapterMode = 'local_cli'
  private _available: boolean | null = null
  private _degradedReason: string | null = null

  /**
   * Check if OpenClaw CLI is available, cache result
   */
  private async ensureAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available

    const check = await checkOpenClawAvailable()
    this._available = check.available
    if (!check.available) {
      this._degradedReason = check.error || 'OpenClaw CLI not available'
    }
    return this._available
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const available = await this.ensureAvailable()

    if (!available) {
      return {
        status: 'degraded',
        message: this._degradedReason || 'OpenClaw CLI not available',
        timestamp: new Date().toISOString(),
      }
    }

    const result = await runCommandJson<{
      status: string
      version?: string
      message?: string
    }>('health.json')

    if (result.error) {
      return {
        status: 'degraded',
        message: result.error,
        timestamp: new Date().toISOString(),
      }
    }

    return {
      status: result.data?.status === 'ok' ? 'ok' : 'degraded',
      message: result.data?.message,
      details: result.data as unknown as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    }
  }

  async gatewayStatus(_options?: { deep?: boolean }): Promise<GatewayStatus> {
    const available = await this.ensureAvailable()

    if (!available) {
      return { running: false }
    }

    const result = await runCommandJson<{
      running: boolean
      version?: string
      build?: string
      uptime?: number
      clients?: number
    }>('status.json')

    if (result.error || !result.data) {
      return { running: false }
    }

    return result.data
  }

  async gatewayProbe(): Promise<ProbeResult> {
    const start = Date.now()
    const available = await this.ensureAvailable()

    if (!available) {
      return { ok: false, latencyMs: Date.now() - start }
    }

    const result = await runCommand('probe')
    return {
      ok: result.exitCode === 0,
      latencyMs: result.durationMs,
    }
  }

  async *tailLogs(_options?: { limit?: number }): AsyncGenerator<string> {
    const available = await this.ensureAvailable()

    if (!available) {
      yield `[DEGRADED] ${this._degradedReason}`
      return
    }

    // Use streaming execution for logs
    for await (const chunk of executeCommand('logs')) {
      if (chunk.type === 'stdout') {
        yield chunk.chunk
      }
    }
  }

  async channelsStatus(): Promise<ChannelsStatus> {
    // Channels status not in allowlist yet, return empty
    return {}
  }

  async modelsStatus(): Promise<ModelsStatus> {
    // Models status not in allowlist yet, return empty
    return { models: [] }
  }

  async *sendToAgent(_target: string, _message: string): AsyncGenerator<string> {
    yield '[LocalCLI] Agent messaging requires OpenClaw CLI support'
  }

  async *runCommandTemplate(
    templateId: string,
    _args: Record<string, unknown>
  ): AsyncGenerator<CommandOutput> {
    const available = await this.ensureAvailable()

    if (!available) {
      yield { type: 'stderr', chunk: `[DEGRADED] ${this._degradedReason}\n` }
      yield { type: 'exit', code: 1 }
      return
    }

    // Map template IDs to allowed commands
    const commandMap: Record<string, 'health' | 'doctor' | 'doctor.fix' | 'gateway.restart'> = {
      'health-check': 'health',
      'doctor': 'doctor',
      'doctor-fix': 'doctor.fix',
      'gateway-restart': 'gateway.restart',
    }

    const commandId = commandMap[templateId]
    if (!commandId) {
      yield { type: 'stderr', chunk: `Unknown template: ${templateId}\n` }
      yield { type: 'exit', code: 1 }
      return
    }

    for await (const chunk of executeCommand(commandId)) {
      yield chunk
    }
  }

  async gatewayRestart(): Promise<void> {
    const available = await this.ensureAvailable()
    if (!available) {
      throw new Error(this._degradedReason || 'OpenClaw CLI not available')
    }

    const result = await runCommand('gateway.restart')
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'Gateway restart failed')
    }
  }

  async listPlugins(): Promise<PluginInfo[]> {
    // Plugin commands removed from allowlist - not documented in official docs
    // See docs/audit/openclaw-command-allowlist.md
    return []
  }

  async pluginInfo(_id: string): Promise<PluginInfo> {
    // Plugin commands removed from allowlist - not documented in official docs
    throw new Error('Plugin commands not available - see openclaw-command-allowlist.md')
  }

  async pluginDoctor(): Promise<PluginDoctorResult> {
    // Plugin commands removed from allowlist - not documented in official docs
    return { ok: true, issues: [] }
  }

  async *installPlugin(_spec: string): AsyncGenerator<string> {
    yield '[LocalCLI] Plugin install requires direct CLI execution'
  }

  async enablePlugin(_id: string): Promise<void> {
    // Would need openclaw plugins enable <id>
  }

  async disablePlugin(_id: string): Promise<void> {
    // Would need openclaw plugins disable <id>
  }
}

/**
 * HTTP Adapter for remote Gateway
 */
class HttpAdapter implements OpenClawAdapter {
  readonly mode: AdapterMode = 'remote_http'

  constructor(private config: AdapterConfig) {}

  private get baseUrl(): string {
    return this.config.httpBaseUrl!
  }

  private get headers(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    if (this.config.httpToken) {
      headers['Authorization'] = `Bearer ${this.config.httpToken}`
    } else if (this.config.httpPassword) {
      headers['Authorization'] = `Bearer ${this.config.httpPassword}`
    }
    return headers
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers,
      })

      if (!res.ok) {
        return {
          status: 'down',
          message: `HTTP ${res.status}`,
          timestamp: new Date().toISOString(),
        }
      }

      const data = await res.json()
      return {
        status: data.healthy ? 'ok' : 'degraded',
        details: data,
        timestamp: new Date().toISOString(),
      }
    } catch (err) {
      return {
        status: 'down',
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }
    }
  }

  async gatewayStatus(options?: { deep?: boolean }): Promise<GatewayStatus> {
    const url = options?.deep
      ? `${this.baseUrl}/gateway/status?deep=true`
      : `${this.baseUrl}/gateway/status`
    const res = await fetch(url, { headers: this.headers })
    return res.json()
  }

  async gatewayProbe(): Promise<ProbeResult> {
    const start = Date.now()
    try {
      await fetch(`${this.baseUrl}/gateway/probe`, { headers: this.headers })
      return { ok: true, latencyMs: Date.now() - start }
    } catch {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }

  async *tailLogs(_options?: { limit?: number }): AsyncGenerator<string> {
    yield '[HTTP] Log streaming not yet implemented'
  }

  async channelsStatus(): Promise<ChannelsStatus> {
    const res = await fetch(`${this.baseUrl}/channels/status`, { headers: this.headers })
    return res.json()
  }

  async modelsStatus(): Promise<ModelsStatus> {
    const res = await fetch(`${this.baseUrl}/models/status`, { headers: this.headers })
    return res.json()
  }

  async *sendToAgent(
    target: string,
    message: string,
    options?: { stream?: boolean }
  ): AsyncGenerator<string> {
    const shouldStream = options?.stream ?? true

    if (!shouldStream) {
      // Non-streaming: single request/response
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          ...this.headers,
          'x-openclaw-agent-id': target,
        },
        body: JSON.stringify({
          model: `openclaw:${target}`,
          messages: [{ role: 'user', content: message }],
          stream: false,
        }),
      })

      if (!res.ok) {
        yield `[Error] HTTP ${res.status}: ${res.statusText}`
        return
      }

      const data = await res.json()
      yield data.choices?.[0]?.message?.content ?? ''
      return
    }

    // SSE streaming: parse Server-Sent Events from OpenAI-compatible endpoint
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'x-openclaw-agent-id': target,
      },
      body: JSON.stringify({
        model: `openclaw:${target}`,
        messages: [{ role: 'user', content: message }],
        stream: true,
      }),
    })

    if (!res.ok) {
      yield `[Error] HTTP ${res.status}: ${res.statusText}`
      return
    }

    if (!res.body) {
      yield '[Error] No response body'
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6)
            if (data === '[DONE]') return

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content
              if (content) yield content
            } catch {
              // Ignore malformed JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async *runCommandTemplate(
    _templateId: string,
    _args: Record<string, unknown>
  ): AsyncGenerator<CommandOutput> {
    yield { type: 'stdout', chunk: '[HTTP] Command execution not yet implemented\n' }
    yield { type: 'exit', code: 0 }
  }

  async gatewayRestart(): Promise<void> {
    await fetch(`${this.baseUrl}/gateway/restart`, {
      method: 'POST',
      headers: this.headers,
    })
  }

  async listPlugins(): Promise<PluginInfo[]> {
    const res = await fetch(`${this.baseUrl}/plugins`, { headers: this.headers })
    return res.json()
  }

  async pluginInfo(id: string): Promise<PluginInfo> {
    const res = await fetch(`${this.baseUrl}/plugins/${id}`, { headers: this.headers })
    return res.json()
  }

  async pluginDoctor(): Promise<PluginDoctorResult> {
    const res = await fetch(`${this.baseUrl}/plugins/doctor`, { headers: this.headers })
    return res.json()
  }

  async *installPlugin(_spec: string): AsyncGenerator<string> {
    yield '[HTTP] Plugin install not yet implemented'
  }

  async enablePlugin(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/plugins/${id}/enable`, {
      method: 'POST',
      headers: this.headers,
    })
  }

  async disablePlugin(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/plugins/${id}/disable`, {
      method: 'POST',
      headers: this.headers,
    })
  }
}
