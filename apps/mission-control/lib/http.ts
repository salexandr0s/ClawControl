/**
 * HTTP Client for API Access
 *
 * Provides typed fetch wrappers for consistent API access across the UI.
 * All API responses follow a standard shape with proper error handling.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ApiError {
  error: string
  code?: string
  details?: Record<string, unknown>
}

export interface ApiResponse<T> {
  data: T
  meta?: {
    total?: number
    cursor?: string
    hasMore?: boolean
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path, window.location.origin)

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    })
  }

  return url.toString()
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: ApiError = { error: 'Request failed' }

    try {
      errorData = await response.json()
    } catch {
      errorData = { error: response.statusText || 'Request failed' }
    }

    throw new HttpError(
      errorData.error,
      response.status,
      errorData.code,
      errorData.details
    )
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

// ============================================================================
// API METHODS
// ============================================================================

/**
 * GET request with optional query parameters
 */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const url = buildUrl(path, params)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  return handleResponse<T>(response)
}

/**
 * POST request with JSON body
 */
export async function apiPost<T, B = unknown>(
  path: string,
  body?: B
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  return handleResponse<T>(response)
}

/**
 * PATCH request with JSON body
 */
export async function apiPatch<T, B = unknown>(
  path: string,
  body: B
): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  return handleResponse<T>(response)
}

/**
 * DELETE request
 */
export async function apiDelete<T = void>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  })

  return handleResponse<T>(response)
}

// ============================================================================
// TYPED API ENDPOINTS
// ============================================================================

import type {
  WorkOrderDTO,
  WorkOrderWithOpsDTO,
  OperationDTO,
  AgentDTO,
  ApprovalDTO,
  ActivityDTO,
  ReceiptDTO,
  SearchResult,
} from './repo'

// Work Orders
export const workOrdersApi = {
  list: (filters?: {
    state?: string
    priority?: string
    owner?: string
    q?: string
    limit?: number
    cursor?: string
  }) => apiGet<{ data: WorkOrderWithOpsDTO[]; meta?: { hasMore: boolean; cursor?: string } }>(
    '/api/work-orders',
    filters
  ),

  get: (id: string) => apiGet<{ data: WorkOrderWithOpsDTO }>(`/api/work-orders/${id}`),

  create: (data: {
    title: string
    goalMd: string
    priority?: string
    owner?: string
  }) => apiPost<{ data: WorkOrderDTO }>('/api/work-orders', data),

  update: (id: string, data: Partial<{
    title: string
    goalMd: string
    state: string
    priority: string
    owner: string
    blockedReason: string | null
    /** Required for protected state transitions (ship, cancel) */
    typedConfirmText: string
  }>) => apiPatch<{ data: WorkOrderDTO }>(`/api/work-orders/${id}`, data),
}

// Operations
export const operationsApi = {
  list: (filters?: {
    workOrderId?: string
    station?: string
    status?: string
    limit?: number
  }) => apiGet<{ data: OperationDTO[] }>('/api/operations', filters),

  get: (id: string) => apiGet<{ data: OperationDTO }>(`/api/operations/${id}`),

  create: (data: {
    workOrderId: string
    station: string
    title: string
    notes?: string | null
    dependsOnOperationIds?: string[]
    wipClass?: string
  }) => apiPost<{ data: OperationDTO }>('/api/operations', data),

  update: (id: string, data: Partial<{
    status: string
    notes: string | null
    blockedReason: string | null
  }>) => apiPatch<{ data: OperationDTO }>(`/api/operations/${id}`, data),
}

// Agents
export const agentsApi = {
  list: (filters?: {
    station?: string
    status?: string
  }) => apiGet<{ data: AgentDTO[] }>('/api/agents', filters),

  get: (id: string) => apiGet<{ data: AgentDTO }>(`/api/agents/${id}`),

  create: (data: {
    role: string
    purpose: string
    capabilities?: string[]
    customName?: string
    typedConfirmText: string
  }) =>
    fetch('/api/agents/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create agent')
      return json as { data: AgentDTO; files: Record<string, string>; receiptId: string }
    }),

  update: (id: string, data: Partial<{
    status: string
    currentWorkOrderId: string | null
    role: string
    station: string
    capabilities: Record<string, boolean>
    wipLimit: number
    sessionKey: string
    typedConfirmText: string
  }>) => apiPatch<{ data: AgentDTO }>(`/api/agents/${id}`, data),

  provision: (id: string, typedConfirmText: string) =>
    fetch(`/api/agents/${id}/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedConfirmText }),
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to provision agent')
      return json as { data: { mode: string; provisioned: boolean; message: string }; receiptId: string }
    }),

  test: (id: string, message?: string) =>
    fetch(`/api/agents/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to test agent')
      return json as { data: { mode: string; success: boolean; response: string; latencyMs: number }; receiptId: string }
    }),

  getTemplatePreview: (templateId: string) =>
    apiGet<{
      data: {
        template: {
          id: string
          name: string
          description: string
          version: string
          role: string
          isValid: boolean
          validationErrors: string[]
          validationWarnings: string[]
        }
        paramsSchema: {
          type: 'object'
          properties?: Record<string, {
            type: string
            description?: string
            default?: unknown
            enum?: unknown[]
          }>
          required?: string[]
        } | null
        defaults: Record<string, unknown>
        recommendations: {
          skills?: Array<{ name: string; scope: string; required: boolean }>
          plugins?: Array<{ name: string; required: boolean }>
        } | null
        renderTargets: Array<{ source: string; destination: string }>
      }
    }>(`/api/agents/create-from-template?templateId=${templateId}`),

  createFromTemplate: (data: {
    templateId: string
    params: Record<string, unknown>
    typedConfirmText: string
  }) =>
    fetch('/api/agents/create-from-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create agent from template')
      return json as {
        data: AgentDTO
        files: Array<{ source: string; destination: string; contentPreview: string }>
        template: { id: string; name: string; version: string }
        receiptId: string
      }
    }),
}

// Approvals
export const approvalsApi = {
  list: (filters?: {
    status?: string
    workOrderId?: string
    limit?: number
  }) => apiGet<{ data: ApprovalDTO[] }>('/api/approvals', filters),

  get: (id: string) => apiGet<{ data: ApprovalDTO }>(`/api/approvals/${id}`),

  create: (data: {
    workOrderId: string
    operationId?: string | null
    type: 'ship_gate' | 'risky_action' | 'scope_change' | 'cron_change' | 'external_side_effect'
    questionMd: string
  }) => apiPost<{ data: ApprovalDTO }>('/api/approvals', data),

  update: (id: string, data: {
    status: 'approved' | 'rejected'
    resolvedBy?: string
    /** Required when rejecting danger-level actions */
    note?: string
  }) => apiPatch<{ data: ApprovalDTO }>(`/api/approvals/${id}`, data),
}

// Activities
export const activitiesApi = {
  list: (filters?: {
    entityType?: string
    entityId?: string
    limit?: number
    cursor?: string
  }) => apiGet<{ data: ActivityDTO[]; meta?: { hasMore: boolean; cursor?: string } }>(
    '/api/activities',
    filters
  ),
}

// Receipts
export const receiptsApi = {
  list: (filters?: {
    workOrderId?: string
    operationId?: string
    kind?: string
    running?: boolean
  }) => apiGet<{ data: ReceiptDTO[] }>('/api/receipts', filters),

  get: (id: string) => apiGet<{ data: ReceiptDTO }>(`/api/receipts/${id}`),

  create: (data: {
    workOrderId: string
    operationId?: string | null
    kind: 'playbook_step' | 'cron_run' | 'agent_run' | 'manual'
    commandName: string
    commandArgs?: Record<string, unknown>
  }) => apiPost<{ data: ReceiptDTO }>('/api/receipts', data),

  append: (id: string, data: {
    stream: 'stdout' | 'stderr'
    chunk: string
  }) => apiPatch<{ data: ReceiptDTO }>(`/api/receipts/${id}/append`, data),

  finalize: (id: string, data: {
    exitCode: number
    durationMs: number
    parsedJson?: Record<string, unknown>
  }) => apiPatch<{ data: ReceiptDTO }>(`/api/receipts/${id}/finalize`, data),
}

// Search (already exists)
export const searchApi = {
  search: (query: string, options?: {
    scope?: string
    limit?: number
  }) => apiGet<{ results: SearchResult[] }>('/api/search', { q: query, ...options }),
}

// Workspace Files
export interface WorkspaceFileSummary {
  id: string
  name: string
  type: 'file' | 'folder'
  path: string
  size?: number
  modifiedAt: Date
}

export interface WorkspaceFileWithContent extends WorkspaceFileSummary {
  content: string
}

export const workspaceApi = {
  list: (path = '/') => apiGet<{ data: WorkspaceFileSummary[] }>('/api/workspace', { path }),

  get: (id: string) => apiGet<{ data: WorkspaceFileWithContent }>(`/api/workspace/${id}`),

  update: (id: string, data: {
    content: string
    /** Required for protected files (AGENTS.md, etc) */
    typedConfirmText?: string
  }) => fetch(`/api/workspace/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: WorkspaceFileWithContent }>
  }),
}

// Playbooks
export interface PlaybookSummary {
  id: string
  name: string
  description: string
  severity: 'info' | 'warn' | 'critical'
  modifiedAt: Date
}

export interface PlaybookWithContent extends PlaybookSummary {
  content: string
}

export const playbooksApi = {
  list: () => apiGet<{ data: PlaybookSummary[] }>('/api/playbooks'),

  get: (id: string) => apiGet<{ data: PlaybookWithContent }>(`/api/playbooks/${id}`),

  update: (id: string, data: {
    content: string
    typedConfirmText?: string
  }) => fetch(`/api/playbooks/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: PlaybookWithContent }>
  }),
}

// Skills
export interface SkillSummary {
  id: string
  name: string
  description: string
  version: string
  scope: 'global' | 'agent'
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

export interface SkillWithContent extends SkillSummary {
  skillMd: string
  config?: string
  validation?: SkillValidationResult
}

export const skillsApi = {
  list: (filters?: {
    scope?: 'global' | 'agent'
    agentId?: string
  }) => apiGet<{ data: SkillSummary[] }>('/api/skills', filters),

  get: (scope: 'global' | 'agent', id: string) =>
    apiGet<{ data: SkillWithContent }>(`/api/skills/${scope}/${id}`),

  install: (data: {
    name: string
    description?: string
    scope: 'global' | 'agent'
    agentId?: string
    typedConfirmText: string
  }) => fetch('/api/skills', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: SkillSummary }>
  }),

  update: (scope: 'global' | 'agent', id: string, data: {
    enabled?: boolean
    skillMd?: string
    config?: string
    typedConfirmText: string
  }) => fetch(`/api/skills/${scope}/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: SkillWithContent }>
  }),

  uninstall: (scope: 'global' | 'agent', id: string, typedConfirmText: string) =>
    fetch(`/api/skills/${scope}/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ typedConfirmText }),
    }).then(async (res) => {
      if (!res.ok) {
        const errorData = await res.json()
        throw new HttpError(
          errorData.error,
          res.status,
          errorData.error,
          { policy: errorData.policy }
        )
      }
      return res.json() as Promise<{ success: boolean }>
    }),

  validate: (scope: 'global' | 'agent', id: string) =>
    apiPost<{ data: { validation: SkillValidationResult } }>(`/api/skills/${scope}/${id}/validate`),

  export: (scope: 'global' | 'agent', id: string) =>
    fetch(`/api/skills/${scope}/${id}/export`).then((res) => {
      if (!res.ok) {
        throw new HttpError('Export failed', res.status)
      }
      return res.blob()
    }),

  duplicate: (
    scope: 'global' | 'agent',
    id: string,
    data: {
      targetScope: 'global' | 'agent'
      targetAgentId?: string
      newName?: string
      typedConfirmText: string
    }
  ) => fetch(`/api/skills/${scope}/${id}/duplicate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: SkillSummary }>
  }),
}

// Skill validation result type for client
export interface SkillValidationResult {
  status: 'valid' | 'warnings' | 'invalid' | 'unchecked'
  errors: Array<{ code: string; message: string; path?: string }>
  warnings: Array<{ code: string; message: string; path?: string }>
  summary: string
  validatedAt: Date
}

// Plugins
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

export interface PluginSummary {
  id: string
  name: string
  description: string
  version: string
  author: string
  enabled: boolean
  status: PluginStatus
  sourceType: PluginSourceType
  sourcePath?: string
  npmSpec?: string
  hasConfig: boolean
  doctorResult?: PluginDoctorResult
  restartRequired: boolean
  lastError?: string
  installedAt: Date
  updatedAt: Date
}

export interface PluginWithConfig extends PluginSummary {
  configJson?: Record<string, unknown>
  configSchema?: PluginConfigSchema
}

export const pluginsApi = {
  list: (filters?: {
    status?: PluginStatus
    enabled?: boolean
  }) => apiGet<{ data: PluginSummary[] }>('/api/plugins', filters as Record<string, string | number | boolean | undefined>),

  get: (id: string) => apiGet<{ data: PluginWithConfig }>(`/api/plugins/${id}`),

  update: (id: string, data: {
    enabled?: boolean
    typedConfirmText: string
  }) => fetch(`/api/plugins/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: PluginWithConfig }>
  }),

  doctor: (id: string, typedConfirmText?: string) => fetch(`/api/plugins/${id}/doctor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ typedConfirmText }),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: { doctorResult: PluginDoctorResult; receiptId: string } }>
  }),

  install: (data: {
    sourceType: 'local' | 'npm' | 'tgz' | 'git'
    spec: string
    typedConfirmText: string
  }) => fetch('/api/plugins', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: PluginWithConfig; receiptId: string }>
  }),

  uninstall: (id: string, typedConfirmText: string) => fetch(`/api/plugins/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ typedConfirmText }),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ success: boolean; receiptId: string }>
  }),

  updateConfig: (id: string, data: {
    config: Record<string, unknown>
    typedConfirmText: string
  }) => fetch(`/api/plugins/${id}/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy, validationErrors: errorData.validationErrors }
      )
    }
    return res.json() as Promise<{ data: PluginWithConfig; receiptId: string }>
  }),

  restart: (typedConfirmText: string) => fetch('/api/plugins/restart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ typedConfirmText }),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{
      data: { status: string; pluginsRestarted: string[]; message: string }
      receiptId: string
    }>
  }),
}

// ============================================================================
// MAINTENANCE API
// ============================================================================

export interface MaintenanceStatus {
  mode: string
  cliBin: string
  cliAvailable: boolean
  cliVersion: string | null
  minVersion: string
  belowMinVersion?: boolean
  cliError?: string
  health: {
    status: 'ok' | 'degraded' | 'down'
    message?: string
    details?: Record<string, unknown>
    timestamp: string
  }
  status: {
    running: boolean
    version?: string
    build?: string
    uptime?: number
    clients?: number
  }
  probe: {
    ok: boolean
    latencyMs: number
  }
  timestamp: string
}

export interface MaintenanceActionResult {
  action: string
  exitCode: number
  stdout: string
  stderr: string
  parsedJson?: Record<string, unknown>
  receiptId: string
}

export interface RecoveryStep {
  step: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  message?: string
  receiptId?: string
}

export interface RecoveryState {
  currentStep: string
  steps: RecoveryStep[]
  finalStatus: 'healthy' | 'recovered' | 'needs_manual_intervention' | 'failed' | null
}

export const maintenanceApi = {
  getStatus: () => apiGet<{ data: MaintenanceStatus }>('/api/maintenance'),

  runAction: (action: string, typedConfirmText?: string) => fetch(`/api/maintenance/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ typedConfirmText }),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: MaintenanceActionResult }>
  }),

  recover: (typedConfirmText: string) => fetch('/api/maintenance/recover', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ typedConfirmText }),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: RecoveryState; receiptId: string }>
  }),
}

// ============================================================================
// AGENT TEMPLATES API
// ============================================================================

export interface TemplateSummary {
  id: string
  name: string
  description: string
  version: string
  role: string
  path: string
  isValid: boolean
  validationErrors: string[]
  validationWarnings: string[]
  hasReadme: boolean
  hasSoul: boolean
  hasOverlay: boolean
  createdAt: string
  updatedAt: string
}

export interface TemplateFile {
  id: string
  name: string
  path: string
}

export interface TemplateWithFiles extends TemplateSummary {
  readme: string | null
  files: TemplateFile[]
  config?: Record<string, unknown>
}

export const templatesApi = {
  list: (filters?: {
    role?: string
    rescan?: boolean
  }) => apiGet<{ data: TemplateSummary[]; count: number }>('/api/agent-templates', filters as Record<string, string | number | boolean | undefined>),

  get: (id: string) => apiGet<{ data: TemplateWithFiles }>(`/api/agent-templates/${id}`),

  create: (data: {
    id: string
    name: string
    role: string
    typedConfirmText: string
  }) => fetch('/api/agent-templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ data: TemplateSummary; receiptId: string }>
  }),

  delete: (id: string, typedConfirmText: string) => fetch(`/api/agent-templates/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ typedConfirmText }),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy }
      )
    }
    return res.json() as Promise<{ success: boolean; receiptId: string }>
  }),

  getFile: (id: string, fileId: string) =>
    apiGet<{ data: { fileId: string; content: string } }>(`/api/agent-templates/${id}/files/${fileId}`),

  export: (id: string) =>
    fetch(`/api/agent-templates/${id}/export`).then((res) => {
      if (!res.ok) {
        throw new HttpError('Export failed', res.status)
      }
      return res.blob()
    }),

  import: (data: {
    template: {
      templateId: string
      name: string
      version: string
      exportedAt: string
      files: Record<string, string>
    }
    typedConfirmText: string
  }) => fetch('/api/agent-templates/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      throw new HttpError(
        errorData.error,
        res.status,
        errorData.error,
        { policy: errorData.policy, validationErrors: errorData.validationErrors }
      )
    }
    return res.json() as Promise<{
      data: TemplateSummary
      validation: { valid: boolean; errors: unknown[]; warnings: unknown[] }
      receiptId: string
    }>
  }),
}
