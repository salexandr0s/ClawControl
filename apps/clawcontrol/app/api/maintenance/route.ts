import { NextResponse } from 'next/server'
import { createAdapter, checkOpenClaw, OPENCLAW_BIN, MIN_OPENCLAW_VERSION, runCommandJson } from '@clawcontrol/adapters-openclaw'

const CACHE_TTL_MS = 30_000

type MaintenanceResponseBody = {
  data: {
    mode: string
    localOnly: unknown
    cliBin: string
    cliAvailable: boolean
    cliVersion: string | null
    minVersion: string
    belowMinVersion?: boolean
    cliError?: string
    health: {
      status: 'ok' | 'degraded' | 'down'
      message?: string
      timestamp: string
    }
    status: unknown
    probe: unknown
    pollIntervalMs: number
    timestamp: string
  }
}

let cached: { body: MaintenanceResponseBody; createdAtMs: number } | null = null
let inFlight: Promise<MaintenanceResponseBody> | null = null

function parsePollIntervalMs(): number {
  const raw = process.env.MAINTENANCE_POLL_INTERVAL_MS
  if (!raw) return 30_000

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30_000
  return parsed
}

function responseWithHeaders(body: MaintenanceResponseBody, cacheStatus: 'HIT' | 'MISS') {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': `private, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
      'X-Cache': cacheStatus,
    },
  })
}

/**
 * GET /api/maintenance
 * Get current gateway status and health
 *
 * Response includes CLI info:
 * - cliAvailable: boolean
 * - cliVersion: version string or null
 * - cliBin: 'openclaw' (constant)
 * - minVersion: minimum required version
 */
export async function GET() {
  const now = Date.now()
  if (cached && now - cached.createdAtMs < CACHE_TTL_MS) {
    return responseWithHeaders(cached.body, 'HIT')
  }

  if (!inFlight) {
    inFlight = (async (): Promise<MaintenanceResponseBody> => {
      const adapter = createAdapter({ mode: 'local_cli' })

      // Check OpenClaw CLI availability
      const cliCheck = await checkOpenClaw()
      const pollIntervalMs = parsePollIntervalMs()

      try {
        const [health, status, probe, gatewayCfg] = await Promise.all([
          adapter.healthCheck(),
          adapter.gatewayStatus(),
          adapter.gatewayProbe(),
          runCommandJson('config.gateway.json'),
        ])

        const localOnly = {
          clawcontrol: {
            expectedHost: '127.0.0.1',
            enforced: true,
          },
          openclawDashboard: {
            bind: (gatewayCfg as any)?.data?.bind ?? null,
            port: (gatewayCfg as any)?.data?.port ?? null,
            ok: (gatewayCfg as any)?.data?.bind === 'loopback',
          },
        }

        const body: MaintenanceResponseBody = {
          data: {
            mode: adapter.mode,
            localOnly,
            // CLI info
            cliBin: OPENCLAW_BIN,
            cliAvailable: cliCheck.available,
            cliVersion: cliCheck.version,
            minVersion: MIN_OPENCLAW_VERSION,
            belowMinVersion: cliCheck.belowMinVersion,
            cliError: cliCheck.error,
            // Gateway status (lean)
            health: {
              status: health.status,
              message: health.message,
              timestamp: health.timestamp,
            },
            status,
            probe,
            pollIntervalMs,
            timestamp: new Date().toISOString(),
          },
        }

        return body
      } catch (err) {
        const body: MaintenanceResponseBody = {
          data: {
            mode: adapter.mode,
            // CLI info (even on error)
            cliBin: OPENCLAW_BIN,
            cliAvailable: cliCheck.available,
            cliVersion: cliCheck.version,
            minVersion: MIN_OPENCLAW_VERSION,
            belowMinVersion: cliCheck.belowMinVersion,
            cliError: cliCheck.error,
            // Error state
            localOnly: null,
            health: {
              status: 'down',
              message: err instanceof Error ? err.message : 'Failed to check health',
              timestamp: new Date().toISOString(),
            },
            status: { running: false },
            probe: { ok: false, latencyMs: 0 },
            pollIntervalMs,
            timestamp: new Date().toISOString(),
          },
        }

        return body
      }
    })()
      .then((body) => {
        cached = { body, createdAtMs: Date.now() }
        return body
      })
      .finally(() => {
        inFlight = null
      })
  }

  try {
    const body = await inFlight
    return responseWithHeaders(body, 'MISS')
  } catch (err) {
    const body: MaintenanceResponseBody = {
      data: {
        mode: 'unknown',
        localOnly: null,
        cliBin: OPENCLAW_BIN,
        cliAvailable: false,
        cliVersion: null,
        minVersion: MIN_OPENCLAW_VERSION,
        health: {
          status: 'down',
          message: err instanceof Error ? err.message : 'Failed to check health',
          timestamp: new Date().toISOString(),
        },
        status: { running: false },
        probe: { ok: false, latencyMs: 0 },
        pollIntervalMs: parsePollIntervalMs(),
        timestamp: new Date().toISOString(),
      },
    }
    cached = { body, createdAtMs: Date.now() }
    return responseWithHeaders(body, 'MISS')
  }
}
