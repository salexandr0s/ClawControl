import { getRepos } from '@/lib/repo'
import { ApprovalsClient } from './approvals-client'

/**
 * Approvals Page
 *
 * Server component that fetches approvals data and renders the client.
 */
export default async function ApprovalsPage() {
  const repos = getRepos()

  const [approvals, workOrders] = await Promise.all([
    repos.approvals.list({}),
    repos.workOrders.list({}),
  ])

  // Create work order lookup for display
  const workOrderMap = new Map(workOrders.map((wo) => [wo.id, wo]))

  return (
    <ApprovalsClient
      approvals={approvals}
      workOrderMap={Object.fromEntries(workOrderMap)}
    />
  )
}
