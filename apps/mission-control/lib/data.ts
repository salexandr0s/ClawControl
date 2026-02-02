/**
 * Data Layer Facade
 *
 * Single entry point for all data access in Mission Control.
 * Pages/components should only import from this file.
 *
 * Architecture:
 *   UI Components -> data.ts -> repo layer -> DB or Mock
 */

import { getRepos, useMockData } from './repo'
import {
  mockGlobalSkills,
  mockAgentSkills,
  mockAgents,
  mockPlugins,
  mockCronJobs,
  mockGatewayStatus,
  mockWorkspaceFiles,
} from '@savorg/core'

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
// SKILLS
// ============================================================================

export async function getSkills(scope?: 'global' | 'agent'): Promise<SkillDTO[]> {
  const allSkills = [...mockGlobalSkills, ...mockAgentSkills]

  const filtered = scope
    ? allSkills.filter((s) => s.scope === scope)
    : allSkills

  return filtered.map((s) => {
    const agentName = s.scope === 'agent' && s.agentId
      ? mockAgents.find((a) => a.id === s.agentId)?.name
      : undefined

    return {
      id: s.id,
      name: s.name,
      description: s.description,
      version: s.version,
      scope: s.scope,
      agentId: s.agentId,
      agentName,
      enabled: s.enabled,
      usageCount: s.usageCount,
      lastUsedAt: s.lastUsedAt,
      installedAt: s.installedAt,
      modifiedAt: s.modifiedAt,
      hasConfig: s.hasConfig,
      hasEntrypoint: s.hasEntrypoint,
    }
  })
}

export async function getSkillById(scope: 'global' | 'agent', id: string): Promise<SkillDTO | null> {
  const skills = scope === 'global' ? mockGlobalSkills : mockAgentSkills
  const skill = skills.find((s) => s.id === id)
  if (!skill) return null

  const agentName = skill.scope === 'agent' && skill.agentId
    ? mockAgents.find((a) => a.id === skill.agentId)?.name
    : undefined

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    scope: skill.scope,
    agentId: skill.agentId,
    agentName,
    enabled: skill.enabled,
    usageCount: skill.usageCount,
    lastUsedAt: skill.lastUsedAt,
    installedAt: skill.installedAt,
    modifiedAt: skill.modifiedAt,
    hasConfig: skill.hasConfig,
    hasEntrypoint: skill.hasEntrypoint,
  }
}

// ============================================================================
// PLUGINS (mock only for now)
// ============================================================================

export async function getPlugins(): Promise<PluginDTO[]> {
  return mockPlugins.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    version: p.version,
    author: p.author,
    enabled: p.enabled,
    status: p.status,
    sourceType: p.sourceType,
    sourcePath: p.sourcePath,
    npmSpec: p.npmSpec,
    hasConfig: p.hasConfig,
    doctorResult: p.doctorResult,
    restartRequired: p.restartRequired,
    lastError: p.lastError,
    installedAt: p.installedAt,
    updatedAt: p.updatedAt,
  }))
}

export async function getPluginById(id: string): Promise<PluginDTO | null> {
  const plugin = mockPlugins.find((p) => p.id === id)
  if (!plugin) return null
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    author: plugin.author,
    enabled: plugin.enabled,
    status: plugin.status,
    sourceType: plugin.sourceType,
    sourcePath: plugin.sourcePath,
    npmSpec: plugin.npmSpec,
    hasConfig: plugin.hasConfig,
    doctorResult: plugin.doctorResult,
    restartRequired: plugin.restartRequired,
    lastError: plugin.lastError,
    installedAt: plugin.installedAt,
    updatedAt: plugin.updatedAt,
  }
}

// ============================================================================
// CRON JOBS (mock only for now)
// ============================================================================

export async function getCronJobs(): Promise<CronJobDTO[]> {
  return mockCronJobs.map((c) => ({
    id: c.id,
    name: c.name,
    schedule: c.schedule,
    description: c.description,
    enabled: c.enabled,
    lastRunAt: c.lastRunAt,
    nextRunAt: c.nextRunAt,
    lastStatus: c.lastStatus,
    runCount: c.runCount,
    createdAt: c.lastRunAt ?? new Date(), // mock doesn't have createdAt
    updatedAt: c.lastRunAt ?? new Date(),
  }))
}

// ============================================================================
// GATEWAY (mock only for now)
// ============================================================================

export async function getGatewayStatus(): Promise<GatewayStatusDTO> {
  return mockGatewayStatus
}

// ============================================================================
// WORKSPACE
// ============================================================================

export async function getWorkspaceFiles(path = '/'): Promise<WorkspaceFileDTO[]> {
  if (useMockData()) {
    return mockWorkspaceFiles
      .filter((f) => f.path === path)
      .map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        path: f.path,
        size: f.size,
        modifiedAt: f.modifiedAt,
      }))
  }

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

export { useMockData }

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
