/**
 * Repository Provider
 *
 * Single entry point for repository creation.
 * Switches between DB and mock implementations based on USE_MOCK_DATA env var.
 */

import { createDbWorkOrdersRepo, createMockWorkOrdersRepo, type WorkOrdersRepo } from './workOrders'
import { createDbOperationsRepo, createMockOperationsRepo, type OperationsRepo } from './operations'
import { createDbAgentsRepo, createMockAgentsRepo, type AgentsRepo } from './agents'
import { createDbApprovalsRepo, createMockApprovalsRepo, type ApprovalsRepo } from './approvals'
import { createDbActivitiesRepo, createMockActivitiesRepo, type ActivitiesRepo } from './activities'
import { createDbReceiptsRepo, createMockReceiptsRepo, type ReceiptsRepo } from './receipts'
import { createDbSearchRepo, createMockSearchRepo, type SearchRepo } from './search'

// ============================================================================
// REPOSITORY CONTAINER
// ============================================================================

export interface Repos {
  workOrders: WorkOrdersRepo
  operations: OperationsRepo
  agents: AgentsRepo
  approvals: ApprovalsRepo
  activities: ActivitiesRepo
  receipts: ReceiptsRepo
  search: SearchRepo
}

// ============================================================================
// PROVIDER
// ============================================================================

/**
 * Check if mock data mode is enabled.
 *
 * Resolution order (deterministic):
 * - USE_MOCK_DATA=true → mock
 * - default (unset or any other value) → DB
 */
export function useMockData(): boolean {
  return process.env.USE_MOCK_DATA === 'true'
}

// Track if we've logged the data mode (prevents spam on hot reload)
let hasLoggedMode = false

/**
 * Create the appropriate repository implementations
 * based on the USE_MOCK_DATA environment variable.
 */
export function createRepos(): Repos {
  const isMock = useMockData()

  // Log data mode once (server-side only)
  if (!hasLoggedMode && typeof window === 'undefined') {
    console.log(`[repo] Data mode: ${isMock ? 'MOCK' : 'DB'}`)
    hasLoggedMode = true
  }

  if (isMock) {
    return {
      workOrders: createMockWorkOrdersRepo(),
      operations: createMockOperationsRepo(),
      agents: createMockAgentsRepo(),
      approvals: createMockApprovalsRepo(),
      activities: createMockActivitiesRepo(),
      receipts: createMockReceiptsRepo(),
      search: createMockSearchRepo(),
    }
  }

  return {
    workOrders: createDbWorkOrdersRepo(),
    operations: createDbOperationsRepo(),
    agents: createDbAgentsRepo(),
    approvals: createDbApprovalsRepo(),
    activities: createDbActivitiesRepo(),
    receipts: createDbReceiptsRepo(),
    search: createDbSearchRepo(),
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
