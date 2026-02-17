/**
 * Core domain types for clawcontrol
 */

// Work Order types
export type WorkOrderState =
  | 'planned'
  | 'active'
  | 'blocked'
  | 'review'
  | 'shipped'
  | 'archived'
  | 'cancelled'

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

/**
 * Work order owner.
 * Built-in values include `user` and `clawcontrolceo`, but this can also hold
 * dynamic agent names when work is assigned from the Planned queue.
 */
export type Owner = string

export interface WorkOrder {
  id: string
  code: string
  title: string
  goalMd: string
  state: WorkOrderState
  priority: Priority
  owner: Owner
  tags: string[]
  workflowId: string | null
  currentStage: number
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
  shippedAt: Date | null
}

// Operation types
export type OperationStation =
  | 'strategic'
  | 'orchestration'
  | 'spec'
  | 'build'
  | 'qa'
  | 'security'
  | 'ops'
  | 'update'
  | 'ship'
  | 'compound'

// Backward-compat alias used throughout routing/workflow code.
export type Station = OperationStation

// Canonical station identifiers for v1 agent categorization.
export const CANONICAL_STATION_IDS = [
  'strategic',
  'orchestration',
  'spec',
  'build',
  'qa',
  'security',
  'ops',
  'ship',
  'compound',
  'update',
] as const

export type CanonicalStationId = (typeof CANONICAL_STATION_IDS)[number]

const CANONICAL_STATION_ID_SET = new Set<string>(CANONICAL_STATION_IDS)

export function normalizeStationId(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function isCanonicalStationId(value: string | null | undefined): value is CanonicalStationId {
  return CANONICAL_STATION_ID_SET.has(normalizeStationId(value))
}

// Station identifiers stored on agents can still be dynamic in legacy data.
export type StationId = string

export type OperationStatus =
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'rework'

export interface Operation {
  id: string
  workOrderId: string
  station: OperationStation
  title: string
  notes: string | null
  status: OperationStatus
  workflowId: string | null
  workflowStageIndex: number
  iterationCount: number
  executionType: 'single' | 'loop'
  currentStoryId: string | null
  retryCount: number
  maxRetries: number
  claimedBy: string | null
  claimExpiresAt: Date | null
  lastClaimedAt: Date | null
  timeoutCount: number
  assigneeAgentIds: string[]
  dependsOnOperationIds: string[]
  wipClass: string
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
}

// Agent types
export type AgentStatus = 'idle' | 'active' | 'blocked' | 'error'

export type AutonomyLevel = 'intern' | 'specialist' | 'lead'

export interface Agent {
  id: string
  name: string
  role: string
  station: StationId
  teamId?: string | null
  status: AgentStatus
  sessionKey: string
  capabilities: Record<string, boolean>
  wipLimit: number
  lastSeenAt: Date | null
  lastHeartbeatAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type AgentTeamSource = 'custom' | 'imported' | 'builtin'
export type AgentTeamHealth = 'healthy' | 'warning' | 'degraded' | 'unknown'

export interface AgentTeam {
  id: string
  slug: string
  name: string
  description: string | null
  source: AgentTeamSource
  workflowIds: string[]
  templateIds: string[]
  healthStatus: AgentTeamHealth
  createdAt: Date
  updatedAt: Date
}

export type WorkflowSource = 'builtin' | 'custom'

export interface WorkflowDefinition {
  id: string
  description: string
  source: WorkflowSource
  stages: Array<{
    ref: string
    agent: string
    condition?: string
    optional?: boolean
    loopTarget?: string
    maxIterations?: number
    canVeto?: boolean
    type?: 'single' | 'loop'
    loop?: {
      over: 'stories'
      completion: 'all_done'
      verifyEach?: boolean
      verifyStageRef?: string
      maxStories?: number
    }
  }>
}

export type PackageKind = 'agent_template' | 'agent_team' | 'workflow' | 'team_with_workflows'

// Artifact types
export type ArtifactType =
  | 'pr'
  | 'doc'
  | 'file'
  | 'link'
  | 'patch'
  | 'screenshot'
  | 'report'

export interface Artifact {
  id: string
  workOrderId: string
  operationId: string | null
  type: ArtifactType
  title: string
  pathOrUrl: string
  createdBy: string
  createdAt: Date
}

// Receipt types
export type ReceiptKind =
  | 'playbook_step'
  | 'cron_run'
  | 'agent_run'
  | 'manual'

export interface Receipt {
  id: string
  workOrderId: string
  operationId: string | null
  kind: ReceiptKind
  commandName: string
  commandArgsJson: Record<string, unknown>
  exitCode: number | null
  durationMs: number | null
  stdoutExcerpt: string
  stderrExcerpt: string
  parsedJson: unknown | null
  startedAt: Date
  endedAt: Date | null
}

// Approval types
export type ApprovalType =
  | 'ship_gate'
  | 'risky_action'
  | 'scope_change'
  | 'cron_change'
  | 'external_side_effect'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface Approval {
  id: string
  workOrderId: string
  operationId: string | null
  type: ApprovalType
  questionMd: string
  status: ApprovalStatus
  resolvedBy: string | null
  createdAt: Date
  resolvedAt: Date | null
}

// Activity types
export interface Activity {
  id: string
  ts: Date
  type: string
  category?: string
  riskLevel?: RiskLevel
  actor: string
  entityType: string
  entityId: string
  summary: string
  payloadJson: Record<string, unknown>
}

// Playbook types
export type PlaybookSeverity = 'info' | 'warn' | 'critical'

export interface Playbook {
  id: string
  name: string
  description: string
  severity: PlaybookSeverity
  allowAutoRun: boolean
  createdAt: Date
  updatedAt: Date
}

export type PlaybookRunStatus = 'running' | 'paused' | 'failed' | 'completed'

// Command template types
export type RiskLevel = 'safe' | 'caution' | 'danger'

export interface CommandTemplate {
  id: string
  name: string
  commandJson: Record<string, unknown>
  timeoutMs: number
  requiresApproval: boolean
  riskLevel: RiskLevel
  createdAt: Date
  updatedAt: Date
}

// Skill types
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

export interface Skill {
  id: string
  name: string
  description: string
  version: string
  scope: SkillScope
  agentId?: string // Only for agent-scoped skills
  enabled: boolean
  usageCount: number
  lastUsedAt: Date | null
  installedAt: Date
  modifiedAt: Date
  // File structure info
  hasConfig: boolean
  hasEntrypoint: boolean
  // Validation
  validation?: SkillValidationResult
}

// Skill manifest for export
export interface SkillManifest {
  name: string
  version: string
  scope: SkillScope
  agentId?: string
  description: string
  exportedAt: Date
  files: string[]
}

export * from './security-scan'

// Plugin types
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

export interface Plugin {
  id: string
  name: string
  description: string
  version: string
  author: string
  enabled: boolean
  status: PluginStatus
  // Source info
  sourceType: PluginSourceType
  sourcePath?: string // For local/tgz/git
  npmSpec?: string // For npm (e.g., "@scope/plugin@^1.0.0")
  // Configuration
  configJson?: Record<string, unknown>
  configSchema?: PluginConfigSchema
  hasConfig: boolean
  // Doctor
  doctorResult?: PluginDoctorResult
  // Runtime
  restartRequired: boolean
  lastError?: string
  // Timestamps
  installedAt: Date
  updatedAt: Date
}
