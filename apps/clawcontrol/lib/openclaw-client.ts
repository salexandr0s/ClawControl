import 'server-only'

import {
  checkGatewayHealth,
  discoverLocalConfig,
  type DiscoveredConfig,
} from '@clawcontrol/adapters-openclaw'

let cachedConfig: DiscoveredConfig | null = null
let lastCheckMs = 0
const CACHE_TTL_MS = 60_000

export async function getOpenClawConfig(forceRefresh = false): Promise<DiscoveredConfig | null> {
  const now = Date.now()

  if (!forceRefresh && cachedConfig && (now - lastCheckMs) < CACHE_TTL_MS) {
    return cachedConfig
  }

  cachedConfig = await discoverLocalConfig()
  lastCheckMs = now
  return cachedConfig
}

export async function isGatewayOnline(): Promise<boolean> {
  const config = await getOpenClawConfig()
  if (!config) return false
  return checkGatewayHealth(config.gatewayUrl, config.token ?? undefined)
}

