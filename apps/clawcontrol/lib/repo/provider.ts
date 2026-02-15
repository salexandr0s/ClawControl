/**
 * Repository Provider
 *
 * Single entry point for repository creation.
 */

import { createDbWorkOrdersRepo, type WorkOrdersRepo } from './workOrders'
import { createDbOperationsRepo, type OperationsRepo } from './operations'
import { createDbAgentsRepo, type AgentsRepo } from './agents'
import { createDbStationsRepo, type StationsRepo } from './stations'
import { createDbApprovalsRepo, type ApprovalsRepo } from './approvals'
import { createDbActivitiesRepo, type ActivitiesRepo } from './activities'
import { createDbReceiptsRepo, type ReceiptsRepo } from './receipts'
import { createDbSearchRepo, type SearchRepo } from './search'
import { createDbAgentTeamsRepo, type AgentTeamsRepo } from './agentTeams'
import { createFsSkillsRepo, type SkillsRepo } from './skills'
import { createCliPluginsRepo, type PluginsRepo } from './plugins'
import { createCliGatewayRepo, type GatewayRepo } from './gateway'
import { createCliCronRepo, type CronRepo } from './cron'
import { createDbClawHubInstallsRepo, type ClawHubInstallsRepo } from './clawhubInstalls'

// ============================================================================
// REPOSITORY CONTAINER
// ============================================================================

export interface Repos {
  // DB-backed repos (always real, no mock fallback in always-on)
  workOrders: WorkOrdersRepo
  operations: OperationsRepo
  agents: AgentsRepo
  agentTeams: AgentTeamsRepo
  stations: StationsRepo
  approvals: ApprovalsRepo
  activities: ActivitiesRepo
  receipts: ReceiptsRepo
  search: SearchRepo
  clawhubInstalls: ClawHubInstallsRepo

  // FS-backed repos
  skills: SkillsRepo

  // CLI-backed repos
  plugins: PluginsRepo

  // OpenClaw-backed repos (availability-aware)
  gateway: GatewayRepo
  cron: CronRepo
}

// ============================================================================
// PROVIDER
// ============================================================================

/**
 * Create the appropriate repository implementations
 */
export function createRepos(): Repos {
  return {
    workOrders: createDbWorkOrdersRepo(),
    operations: createDbOperationsRepo(),
    agents: createDbAgentsRepo(),
    agentTeams: createDbAgentTeamsRepo(),
    stations: createDbStationsRepo(),
    approvals: createDbApprovalsRepo(),
    activities: createDbActivitiesRepo(),
    receipts: createDbReceiptsRepo(),
    search: createDbSearchRepo(),
    clawhubInstalls: createDbClawHubInstallsRepo(),
    skills: createFsSkillsRepo(),
    plugins: createCliPluginsRepo(),
    gateway: createCliGatewayRepo(),
    cron: createCliCronRepo(),
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let reposInstance: Repos | null = null

/**
 * Get the singleton repository instance.
 * Creates on first call, reuses on subsequent calls.
 */
export function getRepos(): Repos {
  if (!reposInstance) {
    reposInstance = createRepos()
  }
  return reposInstance
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetRepos(): void {
  reposInstance = null
}
