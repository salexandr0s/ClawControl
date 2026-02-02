import { NextResponse } from 'next/server'
import { getDefaultAdapter, resolveCliBin } from '@savorgos/adapters-openclaw'

/**
 * GET /api/maintenance
 * Get current gateway status and health
 *
 * Response includes CLI binary info for compatibility display:
 * - cliBin: 'openclaw' | 'clawdbot' | null
 * - cliVersion: version string
 * - cliSource: 'env' | 'auto' | 'fallback' | 'none'
 */
export async function GET() {
  const adapter = getDefaultAdapter()

  // Resolve CLI binary (supports both openclaw and clawdbot)
  const cliResolution = await resolveCliBin()

  try {
    const [health, status, probe] = await Promise.all([
      adapter.healthCheck(),
      adapter.gatewayStatus(),
      adapter.gatewayProbe(),
    ])

    return NextResponse.json({
      data: {
        mode: adapter.mode,
        // CLI binary info
        cliBin: cliResolution.bin,
        cliVersion: cliResolution.version,
        cliSource: cliResolution.source,
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
        // CLI binary info (even on error)
        cliBin: cliResolution.bin,
        cliVersion: cliResolution.version,
        cliSource: cliResolution.source,
        cliError: cliResolution.error,
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
