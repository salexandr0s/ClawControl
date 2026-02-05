/**
 * Data Layer Facade
 *
 * Single entry point for all data access in clawcontrol.
 * Pages/components should only import from this file.
 *
 * Architecture:
 *   UI Components -> data.ts -> repo layer -> DB/FS/CLI
 */

import { getRepos } from './repo'
import type { OpenClawResponse } from '@/lib/openclaw/availability'

import type {
  WorkOrderDTO,
  WorkOrderWithOpsDTO,
  WorkOrderFilters,
  OperationDTO,
  OperationFilters,
  AgentDTO,
  AgentFilters,
  ApprovalDTO,
  ApprovalFilters,
  ActivityDTO,
  ActivityFilters,
  PaginationOptions,
  DashboardStatsDTO,
  SkillDTO,
  SkillScope,
  PluginDTO,
  CronJobDTO,
  GatewayStatusDTO,
  WorkspaceFileDTO,
  SearchResult,
  SearchOptions,
  SearchScope,
} from './repo'

// ============================================================================
// WORK ORDERS
// ============================================================================

export async function getWorkOrders(filters?: WorkOrderFilters): Promise<WorkOrderDTO[]> {
  return getRepos().workOrders.list(filters)
}

export async function getWorkOrdersWithOps(filters?: WorkOrderFilters): Promise<WorkOrderWithOpsDTO[]> {
  return getRepos().workOrders.listWithOps(filters)
}

export async function getWorkOrderById(id: string): Promise<WorkOrderDTO | null> {
  return getRepos().workOrders.getById(id)
}

export async function getWorkOrderByCode(code: string): Promise<WorkOrderDTO | null> {
  return getRepos().workOrders.getByCode(code)
}

// ============================================================================
// OPERATIONS
// ============================================================================

export async function getOperations(filters?: OperationFilters): Promise<OperationDTO[]> {
  return getRepos().operations.list(filters)
}

export async function getOperationById(id: string): Promise<OperationDTO | null> {
  return getRepos().operations.getById(id)
}

export async function getOperationsForWorkOrder(workOrderId: string): Promise<OperationDTO[]> {
  return getRepos().operations.listForWorkOrder(workOrderId)
}

// ============================================================================
// AGENTS
// ============================================================================

export async function getAgents(filters?: AgentFilters): Promise<AgentDTO[]> {
  return getRepos().agents.list(filters)
}

export async function getAgentById(id: string): Promise<AgentDTO | null> {
  return getRepos().agents.getById(id)
}

export async function getAgentByName(name: string): Promise<AgentDTO | null> {
  return getRepos().agents.getByName(name)
}

// ============================================================================
// APPROVALS
// ============================================================================

export async function getApprovals(filters?: ApprovalFilters): Promise<ApprovalDTO[]> {
  return getRepos().approvals.list(filters)
}

export async function getApprovalById(id: string): Promise<ApprovalDTO | null> {
  return getRepos().approvals.getById(id)
}

export async function getPendingApprovals(): Promise<ApprovalDTO[]> {
  return getRepos().approvals.listPending()
}

// ============================================================================
// ACTIVITIES
// ============================================================================

export async function getActivities(
  filters?: ActivityFilters,
  pagination?: PaginationOptions
): Promise<ActivityDTO[]> {
  return getRepos().activities.list(filters, pagination)
}

export async function getRecentActivities(limit = 20): Promise<ActivityDTO[]> {
  return getRepos().activities.listRecent(limit)
}

export async function getActivitiesForEntity(
  entityType: string,
  entityId: string
): Promise<ActivityDTO[]> {
  return getRepos().activities.listForEntity(entityType, entityId)
}

// ============================================================================
// DASHBOARD STATS
// ============================================================================

export async function getDashboardStats(): Promise<DashboardStatsDTO> {
  const repos = getRepos()

  const [
    workOrderCounts,
    agentCounts,
    pendingApprovals,
    completedToday,
  ] = await Promise.all([
    repos.workOrders.countByState(),
    repos.agents.countByStatus(),
    repos.approvals.countPending(),
    repos.workOrders.countShippedToday(),
  ])

  return {
    activeWorkOrders: workOrderCounts['active'] ?? 0,
    blockedWorkOrders: workOrderCounts['blocked'] ?? 0,
    pendingApprovals,
    activeAgents: agentCounts['active'] ?? 0,
    totalAgents: Object.values(agentCounts).reduce((a, b) => a + b, 0),
    completedToday,
  }
}

// ============================================================================
// SKILLS (FS-backed, returns data directly)
// ============================================================================

export async function getSkills(filters?: { scope?: SkillScope; agentId?: string; enabled?: boolean }): Promise<SkillDTO[]> {
  return getRepos().skills.list(filters)
}

export async function getSkillById(scope: SkillScope, id: string): Promise<SkillDTO | null> {
  return getRepos().skills.getById(scope, id)
}

// ============================================================================
// PLUGINS (CLI-backed via repo)
// ============================================================================

import type { PluginResponseMeta } from './repo/plugins'

export async function getPlugins(): Promise<{ data: PluginDTO[]; meta: PluginResponseMeta }> {
  return getRepos().plugins.list()
}

export async function getPluginById(id: string): Promise<{ data: PluginDTO | null; meta: PluginResponseMeta }> {
  const result = await getRepos().plugins.getById(id)
  // getById returns PluginWithConfigDTO | null, but data layer returns PluginDTO | null
  return {
    data: result.data,
    meta: result.meta,
  }
}

// ============================================================================
// CRON (OpenClaw-backed, availability-aware)
// ============================================================================

import type {
  CronStatusDTO as CronRepoStatusDTO,
  CronJobDTO as CronRepoJobDTO,
  CronRunDTO as CronRepoRunDTO,
} from './repo/cron'

export async function getCronStatus(): Promise<OpenClawResponse<CronRepoStatusDTO>> {
  return getRepos().cron.status()
}

export async function getCronJobs(): Promise<OpenClawResponse<CronRepoJobDTO[]>> {
  return getRepos().cron.list()
}

export async function getCronRuns(jobId: string): Promise<OpenClawResponse<CronRepoRunDTO[]>> {
  return getRepos().cron.runs(jobId)
}

// ============================================================================
// GATEWAY (OpenClaw-backed, availability-aware)
// ============================================================================

import type {
  GatewayStatusDTO as GatewayRepoStatusDTO,
  GatewayHealthDTO,
  GatewayProbeDTO,
} from './repo/gateway'

export async function getGatewayStatus(): Promise<OpenClawResponse<GatewayRepoStatusDTO>> {
  return getRepos().gateway.status()
}

export async function getGatewayHealth(): Promise<OpenClawResponse<GatewayHealthDTO>> {
  return getRepos().gateway.health()
}

export async function getGatewayProbe(): Promise<OpenClawResponse<GatewayProbeDTO>> {
  return getRepos().gateway.probe()
}

// ============================================================================
// WORKSPACE
// ============================================================================

export async function getWorkspaceFiles(path = '/'): Promise<WorkspaceFileDTO[]> {
  // Server-side listing via API helper so SSR pages work consistently.
  const { listWorkspace } = await import('./fs/workspace-fs')
  return listWorkspace(path)
}

// ============================================================================
// SEARCH
// ============================================================================

export async function search(
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  return getRepos().search.search(query, options)
}

// ============================================================================
// UTILITY
// ============================================================================

// ============================================================================
// TYPE RE-EXPORTS
// ============================================================================

export type {
  WorkOrderDTO,
  WorkOrderWithOpsDTO,
  WorkOrderFilters,
  OperationDTO,
  OperationFilters,
  AgentDTO,
  AgentFilters,
  ApprovalDTO,
  ApprovalFilters,
  ActivityDTO,
  ActivityFilters,
  PaginationOptions,
  DashboardStatsDTO,
  SkillDTO,
  SkillScope,
  PluginDTO,
  CronJobDTO,
  GatewayStatusDTO,
  WorkspaceFileDTO,
  SearchResult,
  SearchOptions,
  SearchScope,
}

// Re-export availability-aware types for OpenClaw-backed data
export type { OpenClawResponse } from '@/lib/openclaw/availability'
export type {
  CronStatusDTO as CronRepoStatusDTO,
  CronJobDTO as CronRepoJobDTO,
  CronRunDTO as CronRepoRunDTO,
} from './repo/cron'
export type {
  GatewayStatusDTO as GatewayRepoStatusDTO,
  GatewayHealthDTO,
  GatewayProbeDTO,
} from './repo/gateway'
