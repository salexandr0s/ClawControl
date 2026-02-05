/**
 * Repository Layer Exports
 *
 * Single entry point for all repository functionality.
 */

// Provider (main entry point)
export { getRepos, createRepos, resetRepos, type Repos } from './provider'

// Individual repos (for type imports)
export type { WorkOrdersRepo } from './workOrders'
export type { OperationsRepo, CreateOperationInput } from './operations'
export type { AgentsRepo } from './agents'
export type { StationsRepo, CreateStationInput, UpdateStationInput } from './stations'
export type { ApprovalsRepo, CreateApprovalInput } from './approvals'
export type { ActivitiesRepo, CreateActivityInput } from './activities'
export type { ReceiptsRepo, CreateReceiptInput } from './receipts'
export type { SearchRepo, SearchResult, SearchOptions, SearchScope } from './search'
export type { SkillsRepo, SkillFilters, CreateSkillInput, UpdateSkillInput, SkillWithContentDTO, DuplicateSkillTarget } from './skills'
export type { PluginsRepo, PluginFilters, InstallPluginInput, UpdatePluginInput, PluginResponseMeta } from './plugins'
export { PluginUnsupportedError } from './plugins'
export type { GatewayRepo, GatewayStatusDTO as GatewayRepoStatusDTO, GatewayHealthDTO, GatewayProbeDTO } from './gateway'
export type { CronRepo, CronStatusDTO as CronRepoStatusDTO, CronJobDTO as CronRepoJobDTO, CronRunDTO as CronRepoRunDTO, CronSchedule, CronPayload } from './cron'

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
  StationDTO,
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
  SkillValidationResult,
  SkillValidationError,
  SkillValidationStatus,
  PluginDTO,
  PluginWithConfigDTO,
  PluginSourceType,
  PluginStatus,
  PluginDoctorResult,
  PluginDoctorCheck,
  PluginDoctorStatus,
  PluginConfigSchema,
  DashboardStatsDTO,
  GatewayStatusDTO,
  WorkspaceFileDTO,
} from './types'
