/**
 * Plugins Repository
 *
 * Provides data access for plugins. OpenClaw is the authoritative source.
 *
 * Architecture:
 * - OpenClaw CLI is the canonical source of truth for plugin state
 * - clawcontrol probes capabilities to detect available features
 * - Graceful degradation when plugin commands are not supported
 * - DB is only used for caching/history, never as canonical truth
 */

import { getDefaultAdapter, runDynamicCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  getOpenClawCapabilities,
  type OpenClawCapabilities,
  type PluginCapabilities,
} from '../openclaw'
import type {
  PluginDTO,
  PluginWithConfigDTO,
  PluginSourceType,
  PluginStatus,
  PluginDoctorResult,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

export interface PluginFilters {
  status?: PluginStatus
  enabled?: boolean
  sourceType?: PluginSourceType
}

export interface InstallPluginInput {
  sourceType: PluginSourceType
  spec: string
}

export interface UpdatePluginInput {
  enabled?: boolean
  config?: Record<string, unknown>
}

/**
 * Response metadata for plugin operations
 */
export interface PluginResponseMeta {
  /** Where the data came from */
  source: 'openclaw_cli' | 'openclaw_status' | 'cache' | 'unsupported'
  /** Current capabilities */
  capabilities: PluginCapabilities
  /** Whether running in degraded mode */
  degraded: boolean
  /** Human-readable message about state */
  message?: string
}

/**
 * Error thrown when a plugin operation is not supported
 */
export class PluginUnsupportedError extends Error {
  readonly code = 'PLUGIN_UNSUPPORTED'
  readonly httpStatus = 501

  constructor(
    public readonly operation: string,
    public readonly capabilities: PluginCapabilities
  ) {
    super(`Plugin operation "${operation}" is not supported by this OpenClaw version`)
    this.name = 'PluginUnsupportedError'
  }
}

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface PluginsRepo {
  list(filters?: PluginFilters): Promise<{ data: PluginDTO[]; meta: PluginResponseMeta }>
  getById(id: string): Promise<{ data: PluginWithConfigDTO | null; meta: PluginResponseMeta }>
  getByName(name: string): Promise<PluginWithConfigDTO | null>
  install(input: InstallPluginInput): Promise<{ data: PluginDTO; meta: PluginResponseMeta }>
  update(id: string, input: UpdatePluginInput): Promise<{ data: PluginDTO | null; meta: PluginResponseMeta }>
  uninstall(id: string): Promise<{ success: boolean; meta: PluginResponseMeta }>
  doctor(id: string): Promise<{ data: PluginDoctorResult; meta: PluginResponseMeta }>
  doctorAll(): Promise<{ data: PluginDoctorResult; meta: PluginResponseMeta }>
  restart(): Promise<{ data: { pluginsRestarted: string[] }; meta: PluginResponseMeta }>
  /** Get current capabilities */
  getCapabilities(): Promise<OpenClawCapabilities>
  /** Check if plugin management is available */
  isAvailable(): Promise<boolean>
}

// ============================================================================
// OPENCLAW CLI IMPLEMENTATION (Capability-Aware)
// ============================================================================

export function createCliPluginsRepo(): PluginsRepo {
  const adapter = getDefaultAdapter()

  /**
   * Build response metadata from capabilities
   */
  async function buildMeta(source: PluginResponseMeta['source'] = 'openclaw_cli'): Promise<PluginResponseMeta> {
    const caps = await getOpenClawCapabilities()
    const degraded = !caps.plugins.supported || !caps.plugins.listJson

    return {
      source,
      capabilities: caps.plugins,
      degraded,
      message: caps.degradedReason,
    }
  }

  /**
   * Build unsupported meta for when plugin commands don't exist
   */
  function buildUnsupportedMeta(caps: OpenClawCapabilities): PluginResponseMeta {
    return {
      source: 'unsupported',
      capabilities: caps.plugins,
      degraded: true,
      message: caps.degradedReason || 'Plugin management not supported by this OpenClaw version',
    }
  }

  return {
    async list(filters?: PluginFilters) {
      const caps = await getOpenClawCapabilities()

      // If plugins not supported, return empty with unsupported flag
      if (!caps.plugins.supported || !caps.plugins.listJson) {
        return {
          data: [],
          meta: buildUnsupportedMeta(caps),
        }
      }

      try {
        const rawPlugins = await adapter.listPlugins()

        let plugins = rawPlugins.map(adapterToDTO)

        if (filters?.status) {
          plugins = plugins.filter((p) => p.status === filters.status)
        }
        if (filters?.enabled !== undefined) {
          plugins = plugins.filter((p) => p.enabled === filters.enabled)
        }
        if (filters?.sourceType) {
          plugins = plugins.filter((p) => p.sourceType === filters.sourceType)
        }

        return {
          data: plugins,
          meta: await buildMeta('openclaw_cli'),
        }
      } catch (err) {
        console.error('[plugins] Failed to list plugins from CLI:', err)
        return {
          data: [],
          meta: {
            ...(await buildMeta('openclaw_cli')),
            degraded: true,
            message: `Failed to list plugins: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        }
      }
    },

    async getById(id: string) {
      const caps = await getOpenClawCapabilities()

      if (!caps.plugins.supported || !caps.plugins.infoJson) {
        return {
          data: null,
          meta: buildUnsupportedMeta(caps),
        }
      }

      try {
        const plugin = await adapter.pluginInfo(id)
        return {
          data: {
            ...adapterToDTO(plugin),
            configJson: {},
          },
          meta: await buildMeta('openclaw_cli'),
        }
      } catch {
        return {
          data: null,
          meta: await buildMeta('openclaw_cli'),
        }
      }
    },

    async getByName(name: string) {
      const { data: plugins } = await this.list()
      const plugin = plugins.find((p) => p.name === name)
      if (!plugin) return null

      return {
        ...plugin,
        configJson: {},
      }
    },

    async install(input: InstallPluginInput) {
      const caps = await getOpenClawCapabilities()

      if (!caps.plugins.supported || !caps.plugins.install) {
        throw new PluginUnsupportedError('install', caps.plugins)
      }

      const chunks: string[] = []
      for await (const chunk of adapter.installPlugin(input.spec)) {
        chunks.push(chunk)
      }

      const name = extractPluginName(input.sourceType, input.spec)
      const plugin = await this.getByName(name)

      if (plugin) {
        return {
          data: plugin,
          meta: await buildMeta('openclaw_cli'),
        }
      }

      // Return a placeholder if we can't find it
      return {
        data: {
          id: `plugin_${Date.now()}`,
          name,
          description: `Installed from ${input.sourceType}`,
          version: '1.0.0',
          author: 'unknown',
          enabled: false,
          status: 'inactive',
          sourceType: input.sourceType,
          sourcePath: input.sourceType === 'local' ? input.spec : undefined,
          npmSpec: input.sourceType === 'npm' ? input.spec : undefined,
          hasConfig: false,
          restartRequired: true,
          installedAt: new Date(),
          updatedAt: new Date(),
        },
        meta: await buildMeta('openclaw_cli'),
      }
    },

    async update(id: string, input: UpdatePluginInput) {
      const caps = await getOpenClawCapabilities()

      // Check capabilities for the specific operation
      if (input.enabled !== undefined) {
        const requiredCap = input.enabled ? 'enable' : 'disable'
        if (!caps.plugins.supported || !caps.plugins[requiredCap]) {
          throw new PluginUnsupportedError(requiredCap, caps.plugins)
        }
      }

      if (input.config !== undefined && !caps.plugins.setConfig) {
        throw new PluginUnsupportedError('setConfig', caps.plugins)
      }

      try {
        if (input.enabled !== undefined) {
          if (input.enabled) {
            await adapter.enablePlugin(id)
          } else {
            await adapter.disablePlugin(id)
          }
        }

        const { data } = await this.getById(id)
        return {
          data,
          meta: await buildMeta('openclaw_cli'),
        }
      } catch (err) {
        if (err instanceof PluginUnsupportedError) throw err

        return {
          data: null,
          meta: {
            ...(await buildMeta('openclaw_cli')),
            degraded: true,
            message: `Update failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        }
      }
    },

    async uninstall(id: string) {
      const caps = await getOpenClawCapabilities()

      if (!caps.plugins.supported || !caps.plugins.uninstall) {
        throw new PluginUnsupportedError('uninstall', caps.plugins)
      }

      try {
        const result = await runDynamicCommandJson<{ ok?: boolean; message?: string }>('plugins.uninstall', { id })

        if (result.error) {
          return {
            success: false,
            meta: {
              ...(await buildMeta('openclaw_cli')),
              degraded: true,
              message: result.error,
            },
          }
        }

        return {
          success: true,
          meta: await buildMeta('openclaw_cli'),
        }
      } catch (err) {
        return {
          success: false,
          meta: {
            ...(await buildMeta('openclaw_cli')),
            degraded: true,
            message: `Uninstall failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        }
      }
    },

    async doctor(_id: string) {
      const caps = await getOpenClawCapabilities()

      if (!caps.plugins.supported || !caps.plugins.doctor) {
        throw new PluginUnsupportedError('doctor', caps.plugins)
      }

      try {
        const result = await adapter.pluginDoctor()
        return {
          data: {
            status: result.ok ? 'healthy' : 'unhealthy',
            checks: result.issues.map((i) => ({
              name: 'Issue',
              status: 'fail' as const,
              message: i.message || 'Unknown issue',
            })),
            summary: result.ok ? 'All checks passed' : `${result.issues.length} issues found`,
            checkedAt: new Date(),
          },
          meta: await buildMeta('openclaw_cli'),
        }
      } catch (err) {
        return {
          data: {
            status: 'unhealthy',
            checks: [{ name: 'Doctor', status: 'fail' as const, message: String(err) }],
            summary: 'Doctor check failed',
            checkedAt: new Date(),
          },
          meta: {
            ...(await buildMeta('openclaw_cli')),
            degraded: true,
            message: `Doctor failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        }
      }
    },

    async doctorAll() {
      return this.doctor('all')
    },

    async restart() {
      const caps = await getOpenClawCapabilities()

      if (!caps.available) {
        return {
          data: { pluginsRestarted: [] },
          meta: buildUnsupportedMeta(caps),
        }
      }

      try {
        await adapter.gatewayRestart()

        const { data: plugins } = await this.list()
        const restarted = plugins
          .filter((p) => p.enabled)
          .map((p) => p.name)

        return {
          data: { pluginsRestarted: restarted },
          meta: await buildMeta('openclaw_cli'),
        }
      } catch (err) {
        console.error('[plugins] Restart failed:', err)
        return {
          data: { pluginsRestarted: [] },
          meta: {
            ...(await buildMeta('openclaw_cli')),
            degraded: true,
            message: `Restart failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        }
      }
    },

    async getCapabilities() {
      return getOpenClawCapabilities()
    },

    async isAvailable() {
      const caps = await getOpenClawCapabilities()
      return caps.plugins.supported && caps.plugins.listJson
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function extractPluginName(sourceType: PluginSourceType, spec: string): string {
  switch (sourceType) {
    case 'npm': {
      // @scope/name@version -> name
      // name@version -> name
      const npmMatch = spec.match(/^(?:@[^/]+\/)?([^@]+)/)
      return npmMatch?.[1] ?? spec
    }

    case 'git': {
      // https://github.com/org/repo.git -> repo
      const gitMatch = spec.match(/\/([^/]+?)(?:\.git)?$/)
      return gitMatch?.[1] ?? spec
    }

    case 'local':
    case 'tgz': {
      // /path/to/plugin -> plugin
      const parts = spec.split('/')
      return parts[parts.length - 1].replace(/\.(tgz|tar\.gz)$/, '')
    }

    default:
      return spec
  }
}

function adapterToDTO(plugin: {
  id: string
  name: string
  version?: string
  enabled: boolean
  status: 'ok' | 'error' | 'disabled'
}): PluginDTO {
  return {
    id: plugin.id,
    name: plugin.name,
    description: '',
    version: plugin.version ?? '0.0.0',
    author: 'unknown',
    enabled: plugin.enabled,
    status: (plugin.status === 'ok' ? 'active' : plugin.status === 'disabled' ? 'inactive' : 'error') as PluginStatus,
    sourceType: 'npm', // Default assumption
    hasConfig: false,
    restartRequired: false,
    installedAt: new Date(),
    updatedAt: new Date(),
  }
}
