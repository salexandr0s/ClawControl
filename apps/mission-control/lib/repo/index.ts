/**
 * Repository Layer Exports
 *
 * Single entry point for all repository functionality.
 */

// Provider (main entry point)
export { getRepos, createRepos, resetRepos, useMockData, type Repos } from './provider'

// Individual repos (for type imports)
export type { WorkOrdersRepo } from './workOrders'
export type { OperationsRepo, CreateOperationInput } from './operations'
export type { AgentsRepo } from './agents'
export type { ApprovalsRepo, CreateApprovalInput } from './approvals'
export type { ActivitiesRepo, CreateActivityInput } from './activities'
export type { ReceiptsRepo, CreateReceiptInput } from './receipts'
export type { SearchRepo, SearchResult, SearchOptions, SearchScope } from './search'

// Types (DTOs for UI consumption)
export type {
  WorkOrderDTO,
  WorkOrderWithOpsDTO,
  WorkOrderFilters,
  OperationDTO,
  OperationSummaryDTO,
  OperationFilters,
  AgentDTO,
  AgentFilters,
  ApprovalDTO,
  ApprovalFilters,
  ActivityDTO,
  ActivityFilters,
  ReceiptDTO,
  ReceiptFilters,
  PaginationOptions,
  CronJobDTO,
  SkillDTO,
  SkillScope,
  PluginDTO,
  DashboardStatsDTO,
  GatewayStatusDTO,
  WorkspaceFileDTO,
} from './types'
