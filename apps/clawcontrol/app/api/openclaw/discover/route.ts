import { NextResponse } from 'next/server'
import { checkGatewayHealth } from '@clawcontrol/adapters-openclaw'
import { getOpenClawConfig } from '@/lib/openclaw-client'

export async function GET() {
  const config = await getOpenClawConfig(true)

  if (!config) {
    return NextResponse.json(
      {
        status: 'not_found',
        message: 'OpenClaw config not found at ~/.openclaw/openclaw.json',
      },
      { status: 404 }
    )
  }

  const online = await checkGatewayHealth(config.gatewayUrl, config.token ?? undefined)

  return NextResponse.json({
    status: online ? 'connected' : 'offline',
    gatewayUrl: config.gatewayUrl,
    hasToken: !!config.token,
    agentCount: config.agents.length,
    agents: config.agents.map((a) => ({
      id: a.id,
      identity: a.identity ?? a.id,
    })),
  })
}

