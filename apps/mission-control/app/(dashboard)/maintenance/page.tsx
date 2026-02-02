import { getGatewayStatus } from '@/lib/data'
import { mockPlaybooks } from '@savorgos/core'
import { MaintenanceClient } from './maintenance-client'

export default async function MaintenancePage() {
  const gateway = await getGatewayStatus()

  // Get playbook summaries (without content)
  const playbooks = mockPlaybooks.map(({ id, name, description, severity, modifiedAt }) => ({
    id,
    name,
    description,
    severity,
    modifiedAt,
  }))

  return <MaintenanceClient gateway={gateway} playbooks={playbooks} />
}
