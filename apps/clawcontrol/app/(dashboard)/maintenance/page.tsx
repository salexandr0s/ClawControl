import { getGatewayStatus, type GatewayRepoStatusDTO, type GatewayStatusDTO } from '@/lib/data'
import { MaintenanceClient } from './maintenance-client'
import { AvailabilityBadge } from '@/components/availability-badge'
import { listPlaybooks } from '@/lib/fs/playbooks-fs'

/**
 * Map OpenClaw GatewayRepoStatusDTO to the UI's GatewayStatusDTO format.
 */
function mapToUiDto(data: GatewayRepoStatusDTO | null, latencyMs: number): GatewayStatusDTO {
  if (!data) {
    return {
      status: 'down',
      lastCheckAt: new Date(),
      latencyMs,
      version: 'unknown',
      uptime: 0,
      connections: {
        openClaw: 'disconnected',
        database: 'disconnected',
        redis: 'disconnected',
      },
    }
  }

  return {
    status: data.running ? 'ok' : 'down',
    lastCheckAt: new Date(),
    latencyMs,
    version: data.version ?? 'unknown',
    uptime: data.uptime ?? 0,
    connections: {
      openClaw: data.running ? 'connected' : 'disconnected',
      database: 'connected', // Not available from CLI, assume connected if gateway is up
      redis: 'connected', // Not available from CLI, assume connected if gateway is up
    },
  }
}

export default async function MaintenancePage() {
  const response = await getGatewayStatus()

  // Map OpenClaw DTO to UI DTO
  const gateway = mapToUiDto(response.data, response.latencyMs)

  // Get playbook summaries (without content)
  const playbooks = await listPlaybooks()

  return (
    <div>
      <div className="mb-4">
        <AvailabilityBadge
          status={response.status}
          latencyMs={response.latencyMs}
          cached={response.cached}
          staleAgeMs={response.staleAgeMs}
          label="Gateway"
        />
      </div>

      {response.status === 'unavailable' ? (
        <div className="p-4 bg-status-error/10 rounded-md text-status-error mb-4">
          <p className="font-medium">OpenClaw Unavailable</p>
          <p className="text-sm mt-1">{response.error ?? 'Unable to connect to gateway'}</p>
        </div>
      ) : null}

      <MaintenanceClient gateway={gateway} playbooks={playbooks} />
    </div>
  )
}
