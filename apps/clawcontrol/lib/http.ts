/**
 * HTTP Client for API Access
 *
 * Provides typed fetch wrappers for consistent API access across the UI.
 * All API responses follow a standard shape with proper error handling.
 */

import { timedClientFetch } from './perf/client-timing'

const CSRF_HEADER = 'x-clawcontrol-csrf'
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const AUTH_BOOTSTRAP_PATH = '/api/auth/bootstrap'

let csrfTokenCache: string | null = null
let bootstrapInFlight: Promise<string> | null = null

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

function formatApiErrorMessage(error: string): string {
  switch (error) {
    case 'NOT_IMPLEMENTED':
      return 'This action is not implemented in ClawControl yet.'
    case 'OPENCLAW_UNAVAILABLE':
      return 'OpenClaw is unavailable. Check your OpenClaw installation/connection.'
    case 'OPENCLAW_REGISTER_FAILED':
      return 'Failed to register the agent in OpenClaw. Check ~/.openclaw/openclaw.json permissions/format.'
    default:
      return error
  }
}

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

function inferActivePage(): string {
  if (typeof window === 'undefined') return 'unknown'
  const path = window.location.pathname || ''
  const parts = path.split('/').filter(Boolean)
  return parts[0] || 'root'
}

function toFetchName(path: string, method: string): string {
  const baseOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const url = path.startsWith('http://') || path.startsWith('https://')
    ? new URL(path)
    : new URL(path, baseOrigin)

  const targetPath = url.pathname
  if (url.search) {
    return `${method.toUpperCase()} ${targetPath}${url.search}`
  }
  return `${method.toUpperCase()} ${targetPath}`
}

async function timedRequest(path: string, init: RequestInit): Promise<Response> {
  const method = typeof init.method === 'string' ? init.method : 'GET'
  return timedClientFetch(path, init, {
    page: inferActivePage(),
    name: toFetchName(path, method),
  })
}

function normalizeHeaders(headers: HeadersInit | undefined): Headers {
  if (!headers) return new Headers()
  if (headers instanceof Headers) return new Headers(headers)
  return new Headers(headers)
}

function getPathname(path: string): string {
  const baseOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const url = path.startsWith('http://') || path.startsWith('https://')
    ? new URL(path)
    : new URL(path, baseOrigin)
  return url.pathname
}

async function bootstrapOperatorSession(): Promise<string> {
  if (csrfTokenCache) return csrfTokenCache
  if (typeof window === 'undefined') return ''
  if (bootstrapInFlight) return bootstrapInFlight

  bootstrapInFlight = (async () => {
    const response = await timedRequest(AUTH_BOOTSTRAP_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    const payload = await response.json().catch(() => ({})) as {
      success?: boolean
      csrfToken?: string
      error?: string
    }
    if (!response.ok || !payload.success || !payload.csrfToken) {
      throw new HttpError(payload.error || 'Failed to bootstrap operator session', response.status)
    }
    csrfTokenCache = payload.csrfToken
    return csrfTokenCache
  })()

  try {
    return await bootstrapInFlight
  } finally {
    bootstrapInFlight = null
  }
}

async function withOperatorAuth(path: string, init: RequestInit): Promise<RequestInit> {
  const method = (init.method ?? 'GET').toString().toUpperCase()
  const headers = normalizeHeaders(init.headers)

  if (
    MUTATING_METHODS.has(method)
    && getPathname(path).startsWith('/api/')
    && getPathname(path) !== AUTH_BOOTSTRAP_PATH
  ) {
    const csrfToken = await bootstrapOperatorSession()
    if (csrfToken) headers.set(CSRF_HEADER, csrfToken)
  }

  return {
    ...init,
    headers,
    credentials: 'same-origin',
  }
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const withAuth = await withOperatorAuth(path, init)
  return timedRequest(path, withAuth)
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

  const response = await apiFetch(url, {
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
  const response = await apiFetch(path, {
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
  const response = await apiFetch(path, {
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
  const response = await apiFetch(path, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  })

  return handleResponse<T>(response)
}

/**
 * DELETE request with JSON body
 */
export async function apiDeleteJson<T, B = unknown>(
  path: string,
  body: B
): Promise<T> {
  const response = await apiFetch(path, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
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
  StationDTO,
  ApprovalDTO,
  ActivityDTO,
  ReceiptDTO,
  SearchResult,
} from './repo'

export type AgentHierarchyEdgeType = 'reports_to' | 'delegates_to' | 'receives_from' | 'can_message'
export type AgentHierarchyEdgeConfidence = 'high' | 'medium'
export type AgentHierarchyNodeKind = 'agent' | 'external'

export interface AgentHierarchyNodeCapabilities {
  delegate: boolean
  message: boolean
  exec: boolean
  write: boolean
}

export interface AgentHierarchyToolPolicy {
  allow: string[]
  deny: string[]
  execSecurity: string | null
  source: 'runtime' | 'fallback'
}

export interface AgentHierarchyNode {
  id: string
  normalizedId: string
  kind: AgentHierarchyNodeKind
  label: string
  dbAgentId: string | null
  role: string | null
  station: string | null
  status: string | null
  agentKind: string | null
  runtimeAgentId: string | null
  capabilities: AgentHierarchyNodeCapabilities
  toolPolicy: AgentHierarchyToolPolicy | null
  sources: string[]
}

export interface AgentHierarchyEdge {
  id: string
  type: AgentHierarchyEdgeType
  from: string
  to: string
  confidence: AgentHierarchyEdgeConfidence
  source: string
  sources: string[]
}

export interface AgentHierarchyWarning {
  code: string
  message: string
  source?: string
  relatedNodeId?: string
}

export interface AgentHierarchySourceStatus {
  yaml: {
    available: boolean
    path: string
    error?: string
  }
  runtime: {
    available: boolean
    command: 'config.agents.list.json'
    error?: string
  }
  fallback: {
    available: boolean
    used: boolean
    path: string
    error?: string
  }
  db: {
    available: boolean
    count: number
  }
}

export interface AgentHierarchyData {
  nodes: AgentHierarchyNode[]
  edges: AgentHierarchyEdge[]
  meta: {
    sources: AgentHierarchySourceStatus
    warnings: AgentHierarchyWarning[]
  }
}

// Work Orders
export const workOrdersApi = {
  list: (filters?: {
    state?: string
    priority?: string
    owner?: string
    ownerType?: 'user' | 'agent' | 'system'
    ownerAgentId?: string
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
    ownerType?: 'user' | 'agent' | 'system'
    ownerAgentId?: string | null
    tags?: string[]
    workflowId?: string
  }) => apiPost<{ data: WorkOrderDTO }>('/api/work-orders', data),

  start: (id: string, data?: {
    context?: Record<string, unknown>
    force?: boolean
  }) => apiPost<{
    success: true
    workOrderId: string
    workflowId: string
    operationId: string
    stageIndex: number
    agentId: string
    agentName: string
    sessionKey: string | null
  }>(`/api/work-orders/${id}/start`, data),

  update: (id: string, data: Partial<{
    title: string
    goalMd: string
    state: string
    priority: string
    owner: string
    ownerType: 'user' | 'agent' | 'system'
    ownerAgentId: string | null
    tags: string[]
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

  stories: (id: string) => apiGet<{
    data: Array<{
      id: string
      operationId: string
      workOrderId: string
      storyIndex: number
      storyKey: string
      title: string
      description: string
      acceptanceCriteria: string[]
      status: 'pending' | 'running' | 'done' | 'failed'
      output: string | null
      retryCount: number
      maxRetries: number
      createdAt: Date
      updatedAt: Date
    }>
  }>(`/api/operations/${id}/stories`),
}

// Agents
export const agentsApi = {
  list: (filters?: {
    station?: string
    status?: string
    mode?: 'full' | 'light'
    includeSessionOverlay?: boolean
    includeModelOverlay?: boolean
    syncSessions?: boolean
    cacheTtlMs?: number
  }) => apiGet<{ data: AgentDTO[] }>('/api/agents', filters),

  get: (id: string) => apiGet<{ data: AgentDTO }>(`/api/agents/${id}`),

  hierarchy: () => apiGet<{ data: AgentHierarchyData }>('/api/agents/hierarchy'),

  create: (data: {
    role: string
    purpose: string
    capabilities?: string[]
    displayName?: string
    customName?: string
    typedConfirmText: string
  }) =>
    apiFetch('/api/agents/create', {
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
    displayName: string
    model: string
    fallbacks: string[] | string
    typedConfirmText: string
  }>) => apiPatch<{ data: AgentDTO }>(`/api/agents/${id}`, data),

  provision: (id: string, typedConfirmText: string) =>
    apiFetch(`/api/agents/${id}/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typedConfirmText }),
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) {
        const receiptId = (json as { receiptId?: string }).receiptId
        throw new HttpError(
          formatApiErrorMessage(json.error || 'Failed to provision agent'),
          res.status,
          json.error,
          receiptId ? { receiptId } : undefined
        )
      }
      return json as { data: { mode: string; provisioned: boolean; message: string }; receiptId: string }
    }),

  test: (id: string, message?: string) =>
    apiFetch(`/api/agents/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) {
        const receiptId = (json as { receiptId?: string }).receiptId
        throw new HttpError(
          formatApiErrorMessage(json.error || 'Failed to test agent'),
          res.status,
          json.error,
          receiptId ? { receiptId } : undefined
        )
      }
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

  previewFromTemplate: (data: { templateId: string; params: Record<string, unknown>; displayName?: string }) =>
    apiPost<{
      data: {
        template: { id: string; name: string; version: string; role: string }
        agentDisplayName: string
        agentSlug: string
        agentName: string // legacy alias
        sessionKey: string
        files: Array<{ source: string; destination: string; contentPreview: string }>
      }
    }>('/api/agents/create-from-template/preview', data),

  createFromTemplate: (data: {
    templateId: string
    params: Record<string, unknown>
    displayName?: string
    typedConfirmText: string
  }) =>
    apiFetch('/api/agents/create-from-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create agent from template')
      return json as {
        data: AgentDTO
        agentDisplayName?: string
        agentSlug?: string
        files: Array<{ source: string; destination: string; contentPreview: string }>
        template: { id: string; name: string; version: string }
        receiptId: string
      }
    }),
}

// Stations
export const stationsApi = {
  list: () => apiGet<{ data: StationDTO[] }>('/api/stations'),

  create: (data: {
    name: string
    icon: string
    description?: string | null
    color?: string | null
    sortOrder?: number
    typedConfirmText: string
  }) => apiPost<{ data: StationDTO; receiptId?: string }>('/api/stations', data),

  update: (
    id: string,
    data: Partial<{
      name: string
      icon: string
      description: string | null
      color: string | null
      sortOrder: number
      typedConfirmText: string
    }>
  ) => apiPatch<{ data: StationDTO; receiptId?: string }>(`/api/stations/${id}`, data),

  delete: (id: string, data: { typedConfirmText: string }) =>
    apiDeleteJson<{ ok: true; receiptId?: string }>(`/api/stations/${id}`, data),
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

  batchUpdate: (data: {
    ids: string[]
    status: 'approved' | 'rejected'
    resolvedBy?: string
  }) => apiPost<{ data: { updated: ApprovalDTO[]; failed: string[] } }>('/api/approvals/batch', data),
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
  createdAt: Date | null
  lastEditedAt: Date
}

export interface WorkspaceFileWithContent extends WorkspaceFileSummary {
  content: string
}

export const workspaceApi = {
  list: (
    path = '/',
    options?: { sort?: 'name' | 'recentlyEdited' | 'newestCreated' | 'oldestCreated' }
  ) => apiGet<{ data: WorkspaceFileSummary[] }>('/api/workspace', { path, sort: options?.sort }),

  get: (id: string) => apiGet<{ data: WorkspaceFileWithContent }>(`/api/workspace/${id}`),

  update: (id: string, data: {
    content: string
    /** Required for protected files (AGENTS.md, etc) */
    typedConfirmText?: string
  }) => apiFetch(`/api/workspace/${id}`, {
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

  create: (data: {
    path: string
    name: string
    type: 'file' | 'folder'
    content?: string
    typedConfirmText: string
  }) => apiFetch('/api/workspace', {
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
    return res.json() as Promise<{ data: WorkspaceFileSummary }>
  }),

  delete: (id: string, typedConfirmText: string) => apiFetch(`/api/workspace/${id}`, {
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
}

export interface WorkspaceFavoritesResponse {
  favorites: string[]
  recents: Array<{ path: string; touchedAt: string }>
  pinToday?: boolean
}

export const workspaceFavoritesApi = {
  get: () => apiGet<{ data: WorkspaceFavoritesResponse }>('/api/workspace/favorites'),
  update: (action: 'add' | 'remove' | 'toggle', path: string) =>
    apiPost<{ data: WorkspaceFavoritesResponse }, { action: 'add' | 'remove' | 'toggle'; path: string }>(
      '/api/workspace/favorites',
      { action, path }
    ),
  touchRecent: (path: string) =>
    apiPost<{ data: WorkspaceFavoritesResponse }, { path: string }>('/api/workspace/recents', { path }),
}

export interface WorkspaceCalendarDay {
  day: string
  count: number
  files: Array<{
    id: string
    path: string
    name: string
    createdAt: string | null
    lastEditedAt: string
  }>
}

export interface WorkspaceCalendarResponse {
  month: string
  root: string
  folder: string
  days: WorkspaceCalendarDay[]
}

export const workspaceCalendarApi = {
  get: (params: { month: string; root?: string; folder?: string }) =>
    apiGet<{ data: WorkspaceCalendarResponse }>('/api/workspace/calendar', params),
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

export interface PlaybookRunResult {
  playbookId: string
  playbookName: string
  status: 'completed' | 'failed'
  steps: Array<{
    index: number
    name: string
    status: 'success' | 'failed' | 'skipped'
    message: string
    durationMs: number
  }>
  totalDurationMs: number
}

export const playbooksApi = {
  list: () => apiGet<{ data: PlaybookSummary[] }>('/api/playbooks'),

  get: (id: string) => apiGet<{ data: PlaybookWithContent }>(`/api/playbooks/${id}`),

  update: (id: string, data: {
    content: string
    typedConfirmText?: string
  }) => apiFetch(`/api/playbooks/${id}`, {
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

  run: (id: string, data: {
    typedConfirmText: string
    workOrderId?: string
  }) => apiFetch(`/api/playbooks/${id}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) {
      const errorData = await res.json()
      const receiptId = (errorData as { receiptId?: string }).receiptId
      throw new HttpError(
        formatApiErrorMessage(errorData.error),
        res.status,
        errorData.error,
        { policy: errorData.policy, ...(receiptId ? { receiptId } : {}) }
      )
    }
    return res.json() as Promise<{ data: PlaybookRunResult; receiptId: string }>
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
  marketplace?: SkillMarketplaceInstallSummary | null
}

export interface SkillMarketplaceInstallSummary {
  provider: 'clawhub'
  slug: string
  scope: 'global' | 'agent'
  scopeKey: string
  version: string
  sourceUrl: string
  installMethod: string
  manifestHash: string | null
  installedAt: Date
  installedBy: string
  lastReceiptId: string | null
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
  }) => apiFetch('/api/skills', {
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
  }) => apiFetch(`/api/skills/${scope}/${id}`, {
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
    apiFetch(`/api/skills/${scope}/${id}`, {
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
    apiFetch(`/api/skills/${scope}/${id}/export`, {
      method: 'GET',
      headers: {
        Accept: 'application/zip,application/octet-stream',
      },
    }).then((res) => {
      if (!res.ok) {
        throw new HttpError('Export failed', res.status)
      }
      return res.blob()
    }),

  importZip: (data: {
    file: File
    scope: 'global' | 'agent'
    agentId?: string
    typedConfirmText: string
  }) => {
    const formData = new FormData()
    formData.set('file', data.file)
    formData.set('scope', data.scope)
    if (data.agentId) formData.set('agentId', data.agentId)
    formData.set('typedConfirmText', data.typedConfirmText)

    return apiFetch('/api/skills/import', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
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
    })
  },

  duplicate: (
    scope: 'global' | 'agent',
    id: string,
    data: {
      targetScope: 'global' | 'agent'
      targetAgentId?: string
      newName?: string
      typedConfirmText: string
    }
  ) => apiFetch(`/api/skills/${scope}/${id}/duplicate`, {
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

// ============================================================================
// CLAWHUB MARKETPLACE
// ============================================================================

export type ClawHubListSort = 'downloads' | 'stars' | 'updated'

export interface ClawHubOwnerSummary {
  handle: string
  displayName: string
  image: string | null
}

export interface ClawHubModerationSummary {
  isSuspicious: boolean
  isMalwareBlocked: boolean
}

export interface ClawHubInstalledSummary {
  any: boolean
  global: { version: string; installedAt: Date; lastReceiptId: string | null } | null
  agents: Array<{ agentSlug: string; version: string; installedAt: Date; lastReceiptId: string | null }>
  agentCount: number
}

export interface ClawHubStatsSummary {
  comments: number
  downloads: number
  installsAllTime: number
  installsCurrent: number
  stars: number
  versions: number
}

export interface ClawHubLatestVersionSummary {
  version: string
  createdAt: number
  changelog: string
}

export interface ClawHubMarketplaceSkillListItem {
  slug: string
  displayName: string
  summary: string
  tags: { latest: string } | null
  stats: ClawHubStatsSummary | null
  createdAt: number
  updatedAt: number
  latestVersion: ClawHubLatestVersionSummary | null
  owner: ClawHubOwnerSummary | null
  moderation: ClawHubModerationSummary | null
  installed: ClawHubInstalledSummary
}

export interface ClawHubMarketplaceSkillDetail {
  skill: {
    slug: string
    displayName: string
    summary: string
    tags: { latest: string } | null
    stats: ClawHubStatsSummary
    createdAt: number
    updatedAt: number
  }
  latestVersion: ClawHubLatestVersionSummary | null
  owner: {
    handle: string
    userId: string
    displayName: string
    image: string | null
  } | null
  moderation: ClawHubModerationSummary | null
  installed: ClawHubInstalledSummary
}

export interface ClawHubVersionsListItem {
  version: string
  createdAt: number
  changelog: string
  changelogSource: string | null
}

export interface ClawHubVersionFileEntry {
  path: string
  size: number
  sha256: string
  contentType: string | null
}

export interface ClawHubSkillVersionDetail {
  skill: { slug: string; displayName: string }
  version: {
    version: string
    createdAt: number
    changelog: string
    changelogSource: string | null
    files: ClawHubVersionFileEntry[]
  }
  manifestHash: string
}

export interface ClawHubLocalScanWarning {
  code: string
  severity: 'info' | 'warning' | 'danger'
  message: string
}

export interface ClawHubLocalScanResult {
  blocked: boolean
  moderation: ClawHubModerationSummary | null
  warnings: ClawHubLocalScanWarning[]
  stats: { fileCount: number; totalBytes: number }
}

export const clawhubApi = {
  listSkills: (params?: {
    q?: string
    sort?: ClawHubListSort
    limit?: number
    cursor?: string
    nonSuspiciousOnly?: boolean
  }) => apiGet<{ data: ClawHubMarketplaceSkillListItem[]; meta: { cursor: string | null; hasMore: boolean } }>(
    '/api/clawhub/skills',
    params
  ),

  getSkill: (slug: string) => apiGet<{ data: ClawHubMarketplaceSkillDetail }>(`/api/clawhub/skills/${slug}`),

  listVersions: (slug: string, params?: { limit?: number; cursor?: string }) =>
    apiGet<{ data: ClawHubVersionsListItem[]; meta: { cursor: string | null; hasMore: boolean } }>(
      `/api/clawhub/skills/${slug}/versions`,
      params
    ),

  getVersion: (slug: string, version: string) =>
    apiGet<{ data: ClawHubSkillVersionDetail }>(`/api/clawhub/skills/${slug}/versions/${version}`),

  getFileText: (slug: string, version: string, path: string) =>
    apiFetch(`/api/clawhub/skills/${slug}/file?version=${encodeURIComponent(version)}&path=${encodeURIComponent(path)}`, {
      method: 'GET',
      headers: { Accept: 'text/plain,text/markdown,*/*' },
    }).then(async (res) => {
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Failed to fetch file' }))
        throw new HttpError(json.error || 'Failed to fetch file', res.status, json.code, json.details)
      }
      return res.text()
    }),

  scan: (slug: string, version: string) =>
    apiGet<{ data: ClawHubLocalScanResult }>(`/api/clawhub/skills/${slug}/scan`, { version }),

  install: (slug: string, data: {
    version: string
    scope: 'global' | 'agent'
    agentSlugs?: string[]
    overwrite?: boolean
    typedConfirmText: string
  }) => apiFetch(`/api/clawhub/skills/${slug}/install`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    const json = await res.json().catch(() => ({ error: 'Install failed' }))
    if (!res.ok) {
      throw new HttpError(json.error || 'Install failed', res.status, json.code || json.error, {
        ...(json.details ? { ...json.details } : {}),
        ...(json.policy ? { policy: json.policy } : {}),
        ...(json.receiptId ? { receiptId: json.receiptId } : {}),
      })
    }
    return json as { data: unknown; receiptId: string }
  }),

  uninstall: (slug: string, data: {
    scope: 'global' | 'agent'
    agentSlugs?: string[]
    typedConfirmText: string
  }) => apiFetch(`/api/clawhub/skills/${slug}/uninstall`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    const json = await res.json().catch(() => ({ error: 'Uninstall failed' }))
    if (!res.ok) {
      throw new HttpError(json.error || 'Uninstall failed', res.status, json.code || json.error, {
        ...(json.details ? { ...json.details } : {}),
        ...(json.policy ? { policy: json.policy } : {}),
        ...(json.receiptId ? { receiptId: json.receiptId } : {}),
      })
    }
    return json as { success: boolean; receiptId: string }
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

// Plugin capabilities (from OpenClaw probe)
export interface PluginCapabilities {
  supported: boolean
  listJson: boolean
  infoJson: boolean
  doctor: boolean
  install: boolean
  enable: boolean
  disable: boolean
  uninstall: boolean
  setConfig: boolean
}

export interface PluginResponseMeta {
  source: 'openclaw_cli' | 'openclaw_status' | 'cache' | 'unsupported'
  capabilities: PluginCapabilities
  degraded: boolean
  message?: string
}

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
  }) => apiGet<{ data: PluginSummary[]; meta: PluginResponseMeta }>('/api/plugins', filters as Record<string, string | number | boolean | undefined>),

  get: (id: string) => apiGet<{ data: PluginWithConfig; meta: PluginResponseMeta }>(`/api/plugins/${id}`),

  getCapabilities: (options?: { refresh?: boolean }) => apiGet<{
    data: {
      version: string | null
      available: boolean
      plugins: PluginCapabilities
      sources: { cli: boolean; http: boolean }
      probedAt: string
      degradedReason?: string
    }
    meta: { cacheHit: boolean; cacheTtlMs: number; refreshed?: boolean }
  }>('/api/openclaw/capabilities', options?.refresh ? { refresh: 1 } : undefined),

  update: (id: string, data: {
    enabled?: boolean
    typedConfirmText: string
  }) => apiFetch(`/api/plugins/${id}`, {
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

  doctor: (id: string, typedConfirmText?: string) => apiFetch(`/api/plugins/${id}/doctor`, {
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
  }) => apiFetch('/api/plugins', {
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

  uninstall: (id: string, typedConfirmText: string) => apiFetch(`/api/plugins/${id}`, {
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
  }) => apiFetch(`/api/plugins/${id}/config`, {
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

  restart: (typedConfirmText: string) => apiFetch('/api/plugins/restart', {
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
  localOnly?: {
    clawcontrol: {
      expectedHost: string
      enforced: boolean
    }
    openclawDashboard: {
      bind: string | null
      port: number | null
      ok: boolean
    }
  }
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
  pollIntervalMs?: number
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

export interface GreenfieldResetResult {
  teamsDeleted: number
  agentsDeleted: number
  workflowsDeleted: number
  selectionOverlayDeleted: boolean
  agentWorkspaceEntriesDeleted: number
  workOrdersDeleted: number
  operationsDeleted: number
  operationStoriesDeleted: number
  approvalsDeleted: number
  receiptsDeleted: number
  messagesDeleted: number
  activitiesDeleted: number
  artifactsDeleted: number
}

export interface MaintenanceErrorSuggestedAction {
  id: string
  label: string
  description: string
  kind: 'maintenance' | 'cli' | 'manual'
  maintenanceAction?: string
  command?: string
}

export interface MaintenanceErrorClassification {
  title: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  detectability: 'deterministic' | 'heuristic' | 'unknown'
  confidence: number
  actionable: boolean
  explanation: string
  extractedCliCommand: string | null
  suggestedActions: MaintenanceErrorSuggestedAction[]
}

export interface MaintenanceErrorInsight {
  status: 'pending' | 'ready' | 'failed'
  diagnosisMd: string | null
  failureReason: string | null
  generatedAt: string | null
  sourceAgentId: string | null
  sourceAgentName: string | null
}

export interface MaintenanceErrorSignature {
  signatureHash: string
  signatureText: string
  count: string
  windowCount: string
  allTimeCount: string
  firstSeen: string
  lastSeen: string
  sample: string
  rawRedactedSample?: string
  classification: MaintenanceErrorClassification
  insight: MaintenanceErrorInsight | null
}

export interface MaintenanceErrorSummary {
  generatedAt: string
  from: string
  to: string
  trend: Array<{ day: string; count: string }>
  totals: {
    totalErrors: string
    uniqueSignatures: number
    windowUniqueSignatures: number
  }
  topSignatures: MaintenanceErrorSignature[]
  spike: {
    detected: boolean
    yesterdayCount: number
    baseline: number
  }
}

export interface MaintenanceErrorSignaturesResult {
  generatedAt: string
  from: string
  to: string
  days: number
  signatures: MaintenanceErrorSignature[]
  meta: {
    limit: number
    includeRaw: boolean
    windowUniqueSignatures: number
  }
}

export const maintenanceApi = {
  getStatus: () => apiGet<{ data: MaintenanceStatus }>('/api/maintenance'),

  runAction: (action: string, typedConfirmText?: string) => apiFetch(`/api/maintenance/${action}`, {
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

  recover: (typedConfirmText: string) => apiFetch('/api/maintenance/recover', {
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

  greenfieldReset: (typedConfirmText: string) => apiFetch('/api/maintenance/greenfield-reset', {
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
        { policy: errorData.policy, details: errorData.details }
      )
    }
    return res.json() as Promise<{ data: GreenfieldResetResult; receiptId: string }>
  }),

  getErrorSummary: (days = 14) =>
    apiGet<{ data: MaintenanceErrorSummary }>(
      '/api/openclaw/errors/summary',
      { days }
    ),

  listErrorSignatures: (params?: {
    days?: number
    limit?: number
    includeRaw?: boolean
  }) =>
    apiGet<{ data: MaintenanceErrorSignaturesResult }>(
      '/api/openclaw/errors/signatures',
      params
    ),

  remediateError: (
    signatureHash: string,
    body: { mode: 'create' | 'create_and_start' }
  ) =>
    apiPost<{
      data: {
        workOrderId: string
        code: string
        mode: 'create' | 'create_and_start'
        started: boolean
        operationId: string | null
        workflowId: string | null
        startError: string | null
      }
    }>(
      `/api/openclaw/errors/signatures/${encodeURIComponent(signatureHash)}/remediate`,
      body
    ),
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
  hasHeartbeat: boolean
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

export interface TemplateImportTemplatePayload {
  templateId: string
  name: string
  version: string
  exportedAt?: string
  files: Record<string, string>
}

export interface TemplateImportValidation {
  templateId?: string
  valid: boolean
  errors: Array<{ path: string; message: string; code: string }>
  warnings: Array<{ path: string; message: string; code: string }>
}

export interface TemplateImportResult {
  data: TemplateSummary
  importedTemplates: Array<{
    id: string
    name: string
    version: string
    isValid: boolean
    fileCount: number
  }>
  importSummary: {
    templateCount: number
    templateIds: string[]
    source: 'json-body' | 'json-file' | 'zip-file'
    layout: 'single' | 'bundle'
  }
  validation: TemplateImportValidation
  validations: TemplateImportValidation[]
  receiptId: string
}

function parseTemplateImportResponse(res: Response): Promise<TemplateImportResult> {
  return res.json() as Promise<TemplateImportResult>
}

async function throwTemplateImportError(res: Response): Promise<never> {
  const errorData = await res.json()
  throw new HttpError(
    errorData.error,
    res.status,
    errorData.error,
    {
      policy: errorData.policy,
      validationErrors: errorData.validationErrors,
      existingTemplateIds: errorData.existingTemplateIds,
    }
  )
}

const importJsonTemplate = (data: {
  template: TemplateImportTemplatePayload
  typedConfirmText: string
}) => apiFetch('/api/agent-templates/import', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify(data),
}).then(async (res) => {
  if (!res.ok) {
    return throwTemplateImportError(res)
  }
  return parseTemplateImportResponse(res)
})

const importFileTemplate = (data: {
  file: File
  typedConfirmText: string
}) => {
  const formData = new FormData()
  formData.set('file', data.file)
  formData.set('typedConfirmText', data.typedConfirmText)

  return apiFetch('/api/agent-templates/import', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  }).then(async (res) => {
    if (!res.ok) {
      return throwTemplateImportError(res)
    }
    return parseTemplateImportResponse(res)
  })
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
  }) => apiFetch('/api/agent-templates', {
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

  delete: (id: string, typedConfirmText: string) => apiFetch(`/api/agent-templates/${id}`, {
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
    apiFetch(`/api/agent-templates/${id}/export`, {
      method: 'GET',
      headers: {
        Accept: 'application/zip,application/octet-stream',
      },
    }).then((res) => {
      if (!res.ok) {
        throw new HttpError('Export failed', res.status)
      }
      return res.blob()
    }),

  importJson: importJsonTemplate,

  importFile: importFileTemplate,

  // Backward-compatible alias for existing callers.
  import: importJsonTemplate,
}

// ============================================================================
// WORKFLOWS / TEAMS / PACKAGES API
// ============================================================================

export interface WorkflowListItem {
  id: string
  description: string
  source: 'built_in' | 'custom'
  editable: boolean
  sourcePath: string
  stages: number
  loops: number
  inUse: number
  updatedAt: string
}

export interface WorkflowDetail {
  id: string
  source: 'built_in' | 'custom'
  editable: boolean
  sourcePath: string
  updatedAt: string
  stages: number
  loops: number
  usage: {
    totalWorkOrders: number
    activeWorkOrders: number
  }
  workflow: {
    id: string
    description: string
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
}

export interface WorkflowSelectionState {
  source: 'built_in' | 'custom'
  selection: {
    defaultWorkflowId: string
    rules: Array<{
      id: string
      workflowId: string
      priority?: string[]
      tagsAny?: string[]
      titleKeywordsAny?: string[]
      goalKeywordsAny?: string[]
      precedes?: string[]
    }>
  }
}

export interface AgentTeamMember {
  id: string
  displayName: string
  slug: string
  templateId: string | null
  role: string
  station: string
  status: string
}

export interface TeamCapabilityConfig {
  canDelegate?: boolean
  canSendMessages?: boolean
  canExecuteCode?: boolean
  canModifyFiles?: boolean
  canWebSearch?: boolean
}

export interface TeamHierarchyMemberConfig {
  reportsTo: string | null
  delegatesTo: string[]
  receivesFrom: string[]
  canMessage: string[]
  capabilities: TeamCapabilityConfig
}

export interface TeamHierarchyConfig {
  version: 1
  members: Record<string, TeamHierarchyMemberConfig>
}

export interface TeamHierarchyValidationIssue {
  code: string
  message: string
  path: string
}

export interface TeamHierarchyValidationErrorDetails {
  issues: TeamHierarchyValidationIssue[]
}

export interface AgentTeamSummary {
  id: string
  slug: string
  name: string
  description: string | null
  source: 'builtin' | 'custom' | 'imported'
  workflowIds: string[]
  templateIds: string[]
  hierarchy: TeamHierarchyConfig
  healthStatus: 'healthy' | 'warning' | 'degraded' | 'unknown'
  memberCount: number
  members: AgentTeamMember[]
  createdAt: string
  updatedAt: string
}

export interface TeamInstantiateAgentsOutcome {
  templateId: string
  status: 'created' | 'existing' | 'reconciled'
  agentId: string
  agentSlug: string
  capabilitiesChanged: boolean
  filesWritten: string[]
  filesSkipped: string[]
}

export interface TeamInstantiateAgentsResult {
  teamId: string
  createdAgents: Array<{ id: string; slug: string; displayName: string }>
  existingAgents: Array<{ id: string; slug: string; displayName: string }>
  reconciledAgents: Array<{ id: string; slug: string; displayName: string }>
  changedCapabilities: number
  outcomes: TeamInstantiateAgentsOutcome[]
  filesWritten: string[]
  filesSkipped: string[]
  receiptId: string
}

export type ClawPackageKind = 'agent_template' | 'agent_team' | 'workflow' | 'team_with_workflows'

export interface PackageImportAnalysis {
  packageId: string
  fileName: string
  sha256: string
  manifest: {
    id: string
    name: string
    version: string
    kind: ClawPackageKind
    description?: string
    createdAt?: string
    createdBy?: string
  }
  scan: {
    outcome: 'pass' | 'warn' | 'block'
    blocked: boolean
    summaryCounts: { info: number; warning: number; danger: number }
    findings: Array<{
      code: string
      severity: 'info' | 'warning' | 'danger'
      category: string
      title: string
      message: string
      path?: string
      evidenceHash?: string
      recommendation?: string
    }>
    scannerVersion: string
  }
  blockedByScan: boolean
  alertWorkOrderId: string | null
  summary: {
    templates: number
    workflows: number
    teams: number
    hasSelection: boolean
  }
  conflicts: {
    templates: string[]
    workflows: string[]
    teams: string[]
  }
  installDoc?: { path: string; preview: string } | null
  stagedUntil: string
}

export interface PackageDeployResult {
  packageId: string
  deployed: {
    templates: string[]
    workflows: string[]
    teams: string[]
    selectionApplied: boolean
  }
}

export const workflowsApi = {
  list: () => apiGet<{ data: WorkflowListItem[] }>('/api/workflows'),

  get: (id: string) => apiGet<{ data: WorkflowDetail }>(`/api/workflows/${id}`),

  create: (data: { workflow: WorkflowDetail['workflow']; typedConfirmText?: string }) =>
    apiPost<{ data: WorkflowDetail['workflow'] }, { workflow: WorkflowDetail['workflow']; typedConfirmText?: string }>(
      '/api/workflows',
      data
    ),

  update: (id: string, data: { workflow: WorkflowDetail['workflow']; typedConfirmText?: string }) =>
    apiPatch<{ data: WorkflowDetail['workflow'] }, { workflow: WorkflowDetail['workflow']; typedConfirmText?: string }>(
      `/api/workflows/${id}`,
      data
    ),

  delete: (id: string, data: { typedConfirmText?: string }) =>
    apiDeleteJson<{ success: true }, { typedConfirmText?: string }>(`/api/workflows/${id}`, data),

  clone: (id: string, data?: { cloneId?: string; descriptionSuffix?: string; typedConfirmText?: string }) =>
    apiPost<{ data: WorkflowDetail['workflow'] }, { cloneId?: string; descriptionSuffix?: string; typedConfirmText?: string }>(
      `/api/workflows/${id}/clone`,
      data ?? {}
    ),

  import: (data: { workflows?: unknown[]; workflow?: unknown; yaml?: string; typedConfirmText?: string }) =>
    apiPost<{
      data: {
        imported: WorkflowDetail['workflow'][]
        importedIds: string[]
        count: number
      }
    }, { workflows?: unknown[]; workflow?: unknown; yaml?: string; typedConfirmText?: string }>(
      '/api/workflows/import',
      data
    ),

  importFile: (data: { file: File; typedConfirmText?: string }) => {
    const formData = new FormData()
    formData.set('file', data.file)
    if (data.typedConfirmText) formData.set('typedConfirmText', data.typedConfirmText)

    return apiFetch('/api/workflows/import', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) {
        throw new HttpError(json.error || 'Workflow import failed', res.status, json.code, json.details)
      }
      return json as {
        data: {
          imported: WorkflowDetail['workflow'][]
          importedIds: string[]
          count: number
        }
      }
    })
  },

  export: (id: string, confirm?: string) => {
    const query = confirm ? `?confirm=${encodeURIComponent(confirm)}` : ''
    return apiFetch(`/api/workflows/${id}/export${query}`, {
      method: 'GET',
      headers: { Accept: 'application/x-yaml,application/octet-stream' },
    }).then(async (res) => {
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Workflow export failed' }))
        throw new HttpError(json.error || 'Workflow export failed', res.status, json.code, json.details)
      }
      return res.blob()
    })
  },

  getSelection: () => apiGet<{ data: WorkflowSelectionState }>('/api/workflows/selection'),

  updateSelection: (data: { selection: WorkflowSelectionState['selection']; typedConfirmText?: string }) =>
    apiFetch('/api/workflows/selection', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(data),
    }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) {
        throw new HttpError(json.error || 'Failed to update workflow selection', res.status, json.code, json.details)
      }
      return json as { data: WorkflowSelectionState }
    }),
}

export const agentTeamsApi = {
  list: () => apiGet<{ data: AgentTeamSummary[] }>('/api/agent-teams'),

  get: (id: string) => apiGet<{ data: AgentTeamSummary }>(`/api/agent-teams/${id}`),

  create: (data: {
    name: string
    slug?: string
    description?: string | null
    source?: 'builtin' | 'custom' | 'imported'
    workflowIds?: string[]
    templateIds?: string[]
    hierarchy?: TeamHierarchyConfig
    healthStatus?: 'healthy' | 'warning' | 'degraded' | 'unknown'
    memberAgentIds?: string[]
    typedConfirmText?: string
  }) => apiPost<{ data: AgentTeamSummary }>('/api/agent-teams', data),

  update: (id: string, data: {
    name?: string
    description?: string | null
    workflowIds?: string[]
    templateIds?: string[]
    hierarchy?: TeamHierarchyConfig
    regenerateHierarchyFromDefaults?: boolean
    healthStatus?: 'healthy' | 'warning' | 'degraded' | 'unknown'
    memberAgentIds?: string[]
    typedConfirmText?: string
  }) => apiPatch<{ data: AgentTeamSummary }>(`/api/agent-teams/${id}`, data),

  delete: (id: string, data: { typedConfirmText?: string }) =>
    apiDeleteJson<{ success: true }, { typedConfirmText?: string }>(`/api/agent-teams/${id}`, data),

  instantiateAgents: (id: string, data: { typedConfirmText?: string }) =>
    apiPost<{ data: TeamInstantiateAgentsResult }, { typedConfirmText?: string }>(
      `/api/agent-teams/${id}/instantiate`,
      data
    ),

  export: (id: string, confirm?: string) => {
    const query = confirm ? `?confirm=${encodeURIComponent(confirm)}` : ''
    return apiFetch(`/api/agent-teams/${id}/export${query}`, {
      method: 'GET',
      headers: { Accept: 'application/x-yaml,application/octet-stream' },
    }).then(async (res) => {
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Team export failed' }))
        throw new HttpError(json.error || 'Team export failed', res.status, json.code, json.details)
      }
      return res.blob()
    })
  },
}

export const packagesApi = {
  import: (data: { file: File; typedConfirmText?: string }) => {
    const formData = new FormData()
    formData.set('file', data.file)
    if (data.typedConfirmText) formData.set('typedConfirmText', data.typedConfirmText)

    return apiFetch('/api/packages/import', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    }).then(async (res) => {
      const json = await res.json().catch(() => ({ error: 'Package import failed' }))
      if (!res.ok) {
        throw new HttpError(json.error || 'Package import failed', res.status, json.code, json.details)
      }
      return json as { data: PackageImportAnalysis }
    })
  },

  deploy: (data: { packageId: string; options?: {
    applyTemplates?: boolean
    applyWorkflows?: boolean
    applyTeams?: boolean
    applySelection?: boolean
    overwriteTemplates?: boolean
    overwriteWorkflows?: boolean
    overwriteTeams?: boolean
  }; typedConfirmText?: string; overrideScanBlock?: boolean }) =>
    apiPost<{ data: PackageDeployResult }, {
      packageId: string
      options?: {
        applyTemplates?: boolean
        applyWorkflows?: boolean
        applyTeams?: boolean
        applySelection?: boolean
        overwriteTemplates?: boolean
        overwriteWorkflows?: boolean
        overwriteTeams?: boolean
      }
      typedConfirmText?: string
      overrideScanBlock?: boolean
    }>('/api/packages/deploy', data),

  export: (id: string, kind: ClawPackageKind, confirm?: string) => {
    const params = new URLSearchParams({ kind })
    if (confirm) params.set('confirm', confirm)

    return apiFetch(`/api/packages/${id}/export?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/zip,application/octet-stream' },
    }).then(async (res) => {
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Package export failed' }))
        throw new HttpError(json.error || 'Package export failed', res.status, json.code, json.details)
      }
      return res.blob()
    })
  },
}

// ============================================================================
// CONFIGURATION API
// ============================================================================

export type RemoteAccessMode = 'local_only' | 'tailscale_tunnel'

export interface SettingsConfig {
  remoteAccessMode: RemoteAccessMode
  gatewayHttpUrl: string | null
  gatewayWsUrl: string | null
  gatewayToken: string | null
  workspacePath: string | null
  setupCompleted: boolean
  updatedAt: string
}

export interface SettingsResolvedConfig {
  gatewayHttpUrl: string
  gatewayWsUrl: string | null
  gatewayTokenSource: 'settings' | 'env' | 'openclaw' | 'none'
  workspacePath: string | null
  source: 'openclaw.json' | 'moltbot.json' | 'clawdbot.json' | 'config.yaml' | 'filesystem'
  configPath: string
  configPaths: string[]
  gatewayUrlSource: 'settings' | 'env' | 'openclaw'
  gatewayWsUrlSource: 'settings' | 'env' | 'openclaw'
  workspaceSource: 'settings' | 'env' | 'openclaw' | 'none'
}

export interface WorkspaceValidationIssue {
  level: 'error' | 'warning'
  code: string
  message: string
}

export interface SettingsConfigResponse {
  settings: SettingsConfig
  resolved: SettingsResolvedConfig | null
  settingsPath: string
  legacyEnvPath: string | null
  migratedFromEnv: boolean
  workspaceValidation: {
    ok: boolean
    path: string | null
    exists: boolean
    issues: WorkspaceValidationIssue[]
  }
  workspaceBootstrap?: {
    path: string | null
    ensured: boolean
    createdDirectories: string[]
    createdFiles: string[]
  }
  runtime: {
    cli: {
      cliAvailable: boolean
      cliVersion: string | null
      cliError?: string
      belowMinVersion?: boolean
      resolvedCliBin: string
      checkedAt: string | null
      cacheTtlMs: number
    }
  }
}

export interface GatewayTestResponse {
  gatewayUrl: string
  tokenProvided: boolean
  reachable: boolean
  state: 'reachable' | 'auth_required' | 'unreachable'
  probe?: {
    ok: boolean
    state: 'reachable' | 'auth_required' | 'unreachable'
    url: string
    latencyMs: number
    statusCode?: number
    error?: string
  }
  attempts?: number
}

export interface TailscaleReadinessCheck {
  id: string
  title: string
  state: 'ok' | 'warning' | 'error' | 'unknown'
  message: string
  detail?: string
}

export interface TailscaleReadinessResponse {
  generatedAt: string
  summary: {
    state: 'ok' | 'warning' | 'error'
    ok: number
    warning: number
    error: number
    unknown: number
  }
  checks: TailscaleReadinessCheck[]
  context: {
    remoteAccessMode: RemoteAccessMode
    gatewayUrl: string
    suggestedHost: string
  }
  commands: {
    clawcontrolTunnel: string
    gatewayTunnel: string
  }
}

export interface InitStatusResponse {
  ready: boolean
  requiresSetup: boolean
  setupCompleted: boolean
  access: {
    mode: RemoteAccessMode
    loopbackEnforced: boolean
  }
  checks: {
    database: {
      state: 'ok' | 'error'
      code: string | null
      message: string
      databasePath: string | null
    }
    openclaw: {
      state: 'ok' | 'warning'
      installed: boolean
      version?: string
      message: string
    }
    gateway: {
      state: 'ok' | 'warning' | 'error'
      reachable: boolean
      mode: 'reachable' | 'auth_required' | 'unreachable'
      attempts: number
      gatewayUrl: string
      message: string
      probe: unknown
    }
    workspace: {
      state: 'ok' | 'error'
      path: string | null
      message: string
      issues: WorkspaceValidationIssue[]
      bootstrap?: {
        ensured: boolean
        createdDirectories: number
        createdFiles: number
      }
    }
  }
  timestamp: string
}

export const configApi = {
  getSettings: () => apiGet<{ data: SettingsConfigResponse }>('/api/config/settings'),
  updateSettings: (data: Partial<{
    remoteAccessMode: RemoteAccessMode
    gatewayHttpUrl: string | null
    gatewayWsUrl: string | null
    gatewayToken: string | null
    workspacePath: string | null
    setupCompleted: boolean
  }>) => apiFetch('/api/config/settings', {
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
        errorData.error
      )
    }
    return res.json() as Promise<{ data: SettingsConfigResponse; message?: string }>
  }),
  testGateway: (data?: {
    gatewayHttpUrl?: string | null
    gatewayToken?: string | null
    withRetry?: boolean
  }) => apiPost<{ data: GatewayTestResponse }, {
    gatewayHttpUrl?: string | null
    gatewayToken?: string | null
    withRetry?: boolean
  }>('/api/openclaw/gateway/test', data),
  getTailscaleReadiness: () =>
    apiGet<{ data: TailscaleReadinessResponse }>('/api/system/tailscale-readiness'),
  getInitStatus: () => apiGet<{ data: InitStatusResponse }>('/api/system/init-status'),
}

// ============================================================================
// SECURITY AUDIT API
// ============================================================================

export interface AuditFinding {
  checkId: string
  severity: 'critical' | 'warn' | 'info'
  title: string
  detail: string
}

export interface AuditReport {
  ts: number
  summary: { critical: number; warn: number; info: number }
  findings: AuditFinding[]
  deep?: {
    gateway: {
      attempted: boolean
      url: string
      ok: boolean
      error: string | null
      close: string | null
    }
  }
}

export interface FixAction {
  kind: 'chmod'
  path: string
  mode: number
  ok: boolean
  skipped?: 'already' | 'missing'
}

export interface FixResult {
  ok: boolean
  stateDir: string
  configPath: string
  configWritten: boolean
  changes: string[]
  actions: FixAction[]
  errors: string[]
}

export type AuditType = 'basic' | 'deep' | 'fix'

export const securityApi = {
  runAudit: (type: AuditType, typedConfirmText?: string) =>
    apiFetch('/api/security/audit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ type, typedConfirmText }),
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
        data: { report: AuditReport; fix?: FixResult }
        receiptId: string
      }>
    }),
}

// ============================================================================
// MODELS API
// ============================================================================

export interface ModelListItem {
  key: string
  name: string
  input: string
  contextWindow: number
  local: boolean
  available: boolean
  tags: string[]
  missing: boolean
}

export interface ModelListResponse {
  count: number
  models: ModelListItem[]
}

export interface AuthProfile {
  profileId: string
  provider: string
  type: 'oauth' | 'token' | 'apiKey'
  status: 'ok' | 'expiring' | 'expired' | 'missing' | 'static'
  expiresAt?: number
  remainingMs?: number
  source: string
  label: string
}

export interface ProviderAuth {
  provider: string
  status: 'ok' | 'expiring' | 'expired' | 'missing'
  profiles: AuthProfile[]
  expiresAt?: number
  remainingMs?: number
}

export interface ModelStatusResponse {
  configPath: string
  agentDir: string
  defaultModel: string
  resolvedDefault: string
  fallbacks: string[]
  imageModel: string | null
  imageFallbacks: string[]
  aliases: Record<string, string>
  allowed: string[]
  auth: {
    storePath: string
    shellEnvFallback: {
      enabled: boolean
      appliedKeys: string[]
    }
    providersWithOAuth: string[]
    missingProvidersInUse: string[]
    providers: {
      provider: string
      effective: {
        kind: string
        detail: string
      }
      profiles: {
        count: number
        oauth: number
        token: number
        apiKey: number
        labels: string[]
      }
    }[]
    unusableProfiles: string[]
    oauth: {
      warnAfterMs: number
      profiles: AuthProfile[]
      providers: ProviderAuth[]
    }
  }
}

export type ModelAction = 'list' | 'list-all' | 'status' | 'probe'

export const modelsApi = {
  getStatus: () => apiGet<{ data: { status: ModelStatusResponse } }>('/api/models'),

  runAction: (action: ModelAction) =>
    apiPost<{ data: ModelListResponse | ModelStatusResponse }>('/api/models', { action }),
}

// ============================================================================
// OPENCLAW MODELS PROVISIONING
// ============================================================================

export type ModelAuthMethod = 'apiKey' | 'oauth'

export interface AvailableModelProvider {
  id: string
  label: string
  supported: boolean
  authStatus: 'ok' | 'expiring' | 'expired' | 'missing'
  auth: {
    apiKey: boolean
    oauth: boolean
    oauthRequiresTty: boolean
  }
}

export interface RemoveConfiguredModelResult {
  mode: 'model'
  modelKey: string
  provider: string | null
  removedActions: number
}

export interface RemoveProviderModelsResult {
  mode: 'provider'
  provider: string
  removedModels: number
  removedActions: number
}

export const openclawModelsApi = {
  getAvailable: () =>
    apiGet<{ data: { providers: AvailableModelProvider[] } }>('/api/openclaw/models/available'),

  add: (body: { provider: string; authMethod: ModelAuthMethod; apiKey?: string }) =>
    apiPost<{ data: { provider: string } }, typeof body>('/api/openclaw/models/add', body),

  removeModel: (body: { modelKey: string }) =>
    apiPost<{ data: RemoveConfiguredModelResult }, { mode: 'model'; modelKey: string }>(
      '/api/openclaw/models/remove',
      { mode: 'model', modelKey: body.modelKey }
    ),

  removeProviderModels: (body: { provider: string }) =>
    apiPost<{ data: RemoveProviderModelsResult }, { mode: 'provider'; provider: string }>(
      '/api/openclaw/models/remove',
      { mode: 'provider', provider: body.provider }
    ),
}
