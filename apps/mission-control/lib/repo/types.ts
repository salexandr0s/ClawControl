/**
 * Repository Types - Stable DTOs for UI consumption
 *
 * These types decouple UI from Prisma models and will match
 * future API response shapes. UI should only use these types.
 */

// ============================================================================
// WORK ORDERS
// ============================================================================

export interface WorkOrderDTO {
  id: string
  code: string
  title: string
  goalMd: string
  state: 'planned' | 'active' | 'blocked' | 'review' | 'shipped' | 'cancelled'
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  owner: 'user' | 'savorgceo'
  routingTemplate: string
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
  shippedAt: Date | null
}

export interface WorkOrderWithOpsDTO extends WorkOrderDTO {
  operations: OperationSummaryDTO[]
}

export interface WorkOrderFilters {
  state?: string | string[]
  priority?: string | string[]
  owner?: string
}

// ============================================================================
// OPERATIONS
// ============================================================================

export interface OperationDTO {
  id: string
  workOrderId: string
  station: string
  title: string
  notes: string | null
  status: 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'rework'
  assigneeAgentIds: string[]
  dependsOnOperationIds: string[]
  wipClass: string
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface OperationSummaryDTO {
  id: string
  status: string
}

export interface OperationFilters {
  workOrderId?: string
  status?: string | string[]
  station?: string | string[]
}

// ============================================================================
// AGENTS
// ============================================================================

export interface AgentDTO {
  id: string
  name: string
  role: string
  station: string
  status: 'idle' | 'active' | 'blocked' | 'error'
  sessionKey: string
  capabilities: Record<string, boolean>
  wipLimit: number
  avatarPath: string | null
  model: string | null
  lastSeenAt: Date | null
  lastHeartbeatAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentFilters {
  status?: string | string[]
  station?: string | string[]
}

// ============================================================================
// APPROVALS
// ============================================================================

export interface ApprovalDTO {
  id: string
  workOrderId: string
  operationId: string | null
  type: 'ship_gate' | 'risky_action' | 'scope_change' | 'cron_change' | 'external_side_effect'
  questionMd: string
  status: 'pending' | 'approved' | 'rejected'
  resolvedBy: string | null
  createdAt: Date
  resolvedAt: Date | null
}

export interface ApprovalFilters {
  status?: string | string[]
  type?: string | string[]
  workOrderId?: string
}

// ============================================================================
// ACTIVITIES
// ============================================================================

export interface ActivityDTO {
  id: string
  ts: Date
  type: string
  actor: string
  entityType: string
  entityId: string
  summary: string
  payloadJson: Record<string, unknown>
}

export interface ActivityFilters {
  entityType?: string
  entityId?: string
  type?: string
}

export interface PaginationOptions {
  limit?: number
  offset?: number
  cursor?: string
}

// ============================================================================
// RECEIPTS
// ============================================================================

export interface ReceiptDTO {
  id: string
  workOrderId: string
  operationId: string | null
  kind: 'playbook_step' | 'cron_run' | 'agent_run' | 'manual'
  commandName: string
  commandArgsJson: Record<string, unknown>
  exitCode: number | null
  durationMs: number | null
  stdoutExcerpt: string
  stderrExcerpt: string
  parsedJson: Record<string, unknown> | null
  startedAt: Date
  endedAt: Date | null
}

export interface ReceiptFilters {
  workOrderId?: string
  operationId?: string
  kind?: string | string[]
  running?: boolean
}

// ============================================================================
// CRON JOBS
// ============================================================================

export interface CronJobDTO {
  id: string
  name: string
  schedule: string
  description: string
  enabled: boolean
  lastRunAt: Date | null
  nextRunAt: Date | null
  lastStatus: 'success' | 'failed' | 'running' | null
  runCount: number
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// SKILLS
// ============================================================================

export type SkillScope = 'global' | 'agent'

export type SkillValidationStatus = 'valid' | 'warnings' | 'invalid' | 'unchecked'

export interface SkillValidationError {
  code: string
  message: string
  path?: string
}

export interface SkillValidationResult {
  status: SkillValidationStatus
  errors: SkillValidationError[]
  warnings: SkillValidationError[]
  summary: string
  validatedAt: Date
}

export interface SkillDTO {
  id: string
  name: string
  description: string
  version: string
  scope: SkillScope
  agentId?: string
  agentName?: string
  enabled: boolean
  usageCount: number
  lastUsedAt: Date | null
  installedAt: Date
  modifiedAt: Date
  hasConfig: boolean
  hasEntrypoint: boolean
  validation?: SkillValidationResult
}

// ============================================================================
// PLUGINS
// ============================================================================

export type PluginSourceType = 'local' | 'npm' | 'tgz' | 'git'
export type PluginStatus = 'active' | 'inactive' | 'error' | 'updating'
export type PluginDoctorStatus = 'healthy' | 'warning' | 'unhealthy' | 'unchecked'

export interface PluginDoctorCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  details?: string
}

export interface PluginDoctorResult {
  status: PluginDoctorStatus
  checks: PluginDoctorCheck[]
  summary: string
  checkedAt: Date
  receiptId?: string
}

export interface PluginConfigSchema {
  type: 'object'
  properties: Record<string, {
    type: string
    description?: string
    default?: unknown
    required?: boolean
  }>
  required?: string[]
}

export interface PluginDTO {
  id: string
  name: string
  description: string
  version: string
  author: string
  enabled: boolean
  status: PluginStatus
  // Source info
  sourceType: PluginSourceType
  sourcePath?: string
  npmSpec?: string
  // Configuration
  hasConfig: boolean
  configSchema?: PluginConfigSchema
  // Doctor
  doctorResult?: PluginDoctorResult
  // Runtime
  restartRequired: boolean
  lastError?: string
  // Timestamps
  installedAt: Date
  updatedAt: Date
}

export interface PluginWithConfigDTO extends PluginDTO {
  configJson?: Record<string, unknown>
}

// ============================================================================
// DASHBOARD
// ============================================================================

export interface DashboardStatsDTO {
  activeWorkOrders: number
  blockedWorkOrders: number
  pendingApprovals: number
  activeAgents: number
  totalAgents: number
  completedToday: number
}

// ============================================================================
// GATEWAY
// ============================================================================

export interface GatewayStatusDTO {
  status: 'ok' | 'degraded' | 'down'
  lastCheckAt: Date
  latencyMs: number
  version: string
  uptime: number
  connections: {
    openClaw: 'connected' | 'disconnected' | 'error'
    database: 'connected' | 'disconnected' | 'error'
    redis: 'connected' | 'disconnected' | 'error'
  }
}

// ============================================================================
// WORKSPACE
// ============================================================================

export interface WorkspaceFileDTO {
  id: string
  name: string
  type: 'file' | 'folder'
  path: string
  size?: number
  modifiedAt: Date
}
