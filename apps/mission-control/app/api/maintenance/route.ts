import { NextResponse } from 'next/server'
import { getDefaultAdapter, checkOpenClaw, OPENCLAW_BIN, MIN_OPENCLAW_VERSION, runCommandJson } from '@savorg/adapters-openclaw'

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
  const adapter = getDefaultAdapter()

  // Check OpenClaw CLI availability
  const cliCheck = await checkOpenClaw()

  try {
    const [health, status, probe, gatewayCfg] = await Promise.all([
      adapter.healthCheck(),
      adapter.gatewayStatus(),
      adapter.gatewayProbe(),
      runCommandJson('config.gateway.json'),
    ])

    const localOnly = {
      missionControl: {
        expectedHost: '127.0.0.1',
        enforced: true,
      },
      openclawDashboard: {
        bind: (gatewayCfg as any)?.data?.bind ?? null,
        port: (gatewayCfg as any)?.data?.port ?? null,
        ok: (gatewayCfg as any)?.data?.bind === 'loopback',
      },
    }

    return NextResponse.json({
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
        // Gateway status
        health,
        status,
        probe,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    return NextResponse.json({
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
        health: {
          status: 'down',
          message: err instanceof Error ? err.message : 'Failed to check health',
          timestamp: new Date().toISOString(),
        },
        status: { running: false },
        probe: { ok: false, latencyMs: 0 },
        timestamp: new Date().toISOString(),
      },
    })
  }
}
