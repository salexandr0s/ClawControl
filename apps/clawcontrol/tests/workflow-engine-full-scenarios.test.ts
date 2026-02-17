import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowConfig } from '@clawcontrol/core'

type StageResultStatus = 'approved' | 'rejected' | 'vetoed' | 'completed'

type StageResultInput = {
  status: StageResultStatus
  output: unknown
  feedback?: string
  artifacts?: string[]
}

type WorkOrderRow = {
  id: string
  code: string
  title: string
  goalMd: string
  state: string
  workflowId: string | null
  currentStage: number
  priority: string
  tags: string
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
  shippedAt: Date | null
}

type OperationRow = {
  id: string
  workOrderId: string
  station: string
  title: string
  notes: string | null
  status: string
  workflowId: string | null
  workflowStageIndex: number
  iterationCount: number
  loopTargetOpId: string | null
  executionType: string
  loopConfigJson: string | null
  currentStoryId: string | null
  retryCount: number
  maxRetries: number
  timeoutCount: number
  assigneeAgentIds: string
  blockedReason: string | null
  escalationReason: string | null
  escalatedAt: Date | null
  claimedBy: string | null
  claimExpiresAt: Date | null
  lastClaimedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type OperationStoryRow = {
  id: string
  operationId: string
  workOrderId: string
  storyIndex: number
  storyKey: string
  title: string
  description: string
  acceptanceCriteriaJson: string
  status: string
  outputJson: string | null
  retryCount: number
  maxRetries: number
  createdAt: Date
  updatedAt: Date
}

type ActivityRow = {
  id: string
  ts: Date
  type: string
  actor: string
  actorType: string
  actorAgentId: string | null
  entityType: string
  entityId: string
  summary: string
  payloadJson: string
}

type AgentRow = {
  id: string
  name: string
  displayName: string
  runtimeAgentId: string
  slug: string
  station: string
  teamId: string | null
  templateId: string | null
  status: string
  model: string | null
  sessionKey: string
  lastSeenAt: Date | null
}

type VerifyMetadata = {
  kind: 'story_verify'
  parentOperationId: string
  storyId: string
  loopStageIndex: number
}

type StageAgent = {
  id: string
  displayName: string
  station: string
  runtimeAgentId: string
  teamId: string | null
  templateId: string | null
}

type InMemoryState = {
  workOrders: Map<string, WorkOrderRow>
  operations: Map<string, OperationRow>
  stories: Map<string, OperationStoryRow>
  activities: ActivityRow[]
  approvals: Array<Record<string, unknown>>
  receipts: Array<Record<string, unknown>>
  artifacts: Array<Record<string, unknown>>
  agents: Map<string, AgentRow>
  completionTokens: Set<string>
}

type InMemoryPrisma = {
  __state: InMemoryState
  workOrder: {
    findUnique: (...args: any[]) => Promise<any>
    update: (...args: any[]) => Promise<any>
    findMany: (...args: any[]) => Promise<any>
  }
  operation: {
    count: (...args: any[]) => Promise<any>
    findUnique: (...args: any[]) => Promise<any>
    findFirst: (...args: any[]) => Promise<any>
    findMany: (...args: any[]) => Promise<any>
    create: (...args: any[]) => Promise<any>
    update: (...args: any[]) => Promise<any>
    updateMany: (...args: any[]) => Promise<any>
  }
  operationStory: {
    findUnique: (...args: any[]) => Promise<any>
    findFirst: (...args: any[]) => Promise<any>
    findMany: (...args: any[]) => Promise<any>
    create: (...args: any[]) => Promise<any>
    update: (...args: any[]) => Promise<any>
    deleteMany: (...args: any[]) => Promise<any>
  }
  operationCompletionToken: {
    create: (...args: any[]) => Promise<any>
  }
  activity: {
    create: (...args: any[]) => Promise<any>
    findFirst: (...args: any[]) => Promise<any>
  }
  approval: {
    create: (...args: any[]) => Promise<any>
  }
  receipt: {
    create: (...args: any[]) => Promise<any>
  }
  artifact: {
    create: (...args: any[]) => Promise<any>
  }
  agent: {
    findUnique: (...args: any[]) => Promise<any>
    update: (...args: any[]) => Promise<any>
  }
  agentSession: {
    findFirst: (...args: any[]) => Promise<any>
  }
  $transaction: <T>(fn: (tx: {
    workOrder: InMemoryPrisma['workOrder']
    operation: InMemoryPrisma['operation']
    operationStory: InMemoryPrisma['operationStory']
    activity: InMemoryPrisma['activity']
    approval: InMemoryPrisma['approval']
    receipt: InMemoryPrisma['receipt']
    artifact: InMemoryPrisma['artifact']
    agent: InMemoryPrisma['agent']
  }) => Promise<T>) => Promise<T>
}

type ScenarioHarness = {
  prisma: InMemoryPrisma
  createWorkOrder: (overrides?: Partial<WorkOrderRow>) => string
  getWorkOrder: (workOrderId: string) => WorkOrderRow
  getInProgressOperation: (workOrderId: string) => OperationRow | null
  listOperations: (workOrderId: string) => OperationRow[]
  listStories: (workOrderId: string) => OperationStoryRow[]
  listActivities: (workOrderId: string) => ActivityRow[]
  stageRefFor: (workflowId: string, operation: OperationRow) => string
}

const mocks = vi.hoisted(() => ({
  prisma: null as unknown as InMemoryPrisma,
  workflows: new Map<string, WorkflowConfig>(),
  agentsByRef: new Map<string, StageAgent>(),
  dispatchCalls: [] as Array<{ agentId: string; workOrderId: string; operationId: string; context: Record<string, unknown> }>,
  sentMessages: [] as Array<{ sessionKey: string; message: string }>,
  getWorkflowConfig: vi.fn(),
  selectWorkflowForWorkOrder: vi.fn(),
  resolveWorkflowStageAgent: vi.fn(),
  resolveCeoSessionKey: vi.fn(),
  dispatchToAgent: vi.fn(),
  mapAgentToStation: vi.fn(),
  sendToSession: vi.fn(),
  withIngestionLease: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/workflows/registry', () => ({
  getWorkflowConfig: mocks.getWorkflowConfig,
  selectWorkflowForWorkOrder: mocks.selectWorkflowForWorkOrder,
}))

vi.mock('@/lib/services/agent-resolution', () => ({
  resolveWorkflowStageAgent: mocks.resolveWorkflowStageAgent,
  resolveCeoSessionKey: mocks.resolveCeoSessionKey,
}))

vi.mock('@/lib/workflows/executor', () => ({
  dispatchToAgent: mocks.dispatchToAgent,
  mapAgentToStation: mocks.mapAgentToStation,
}))

vi.mock('@/lib/openclaw/sessions', () => ({
  sendToSession: mocks.sendToSession,
}))

vi.mock('@/lib/openclaw/ingestion-lease', () => ({
  withIngestionLease: mocks.withIngestionLease,
}))

function clone<T>(value: T): T {
  return structuredClone(value)
}

function parseVerifyMetadata(loopConfigJson: string | null): VerifyMetadata | null {
  if (!loopConfigJson) return null
  try {
    const parsed = JSON.parse(loopConfigJson) as Record<string, unknown>
    if (parsed.kind !== 'story_verify') return null
    if (typeof parsed.parentOperationId !== 'string') return null
    if (typeof parsed.storyId !== 'string') return null
    if (typeof parsed.loopStageIndex !== 'number') return null
    return {
      kind: 'story_verify',
      parentOperationId: parsed.parentOperationId,
      storyId: parsed.storyId,
      loopStageIndex: parsed.loopStageIndex,
    }
  } catch {
    return null
  }
}

function titleCase(input: string): string {
  return input
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function stationForAgentRef(agentRef: string): string {
  if (agentRef.includes('review')) return 'qa'
  if (agentRef === 'plan' || agentRef === 'research') return 'spec'
  if (agentRef === 'security') return 'security'
  if (agentRef === 'ops') return 'ops'
  if (agentRef === 'build') return 'build'
  if (agentRef === 'ui') return 'ui'
  return agentRef
}

function loadStarterPackWorkflows(): Map<string, WorkflowConfig> {
  const workflowsDir = join(
    process.cwd(),
    '..',
    '..',
    'starter-packs',
    'clawcontrol-starter-pack',
    'input',
    'workflows'
  )

  const files = readdirSync(workflowsDir)
    .filter((file) => /^cc_.*\.ya?ml$/i.test(file))
    .sort((left, right) => left.localeCompare(right))

  const map = new Map<string, WorkflowConfig>()
  for (const file of files) {
    const raw = readFileSync(join(workflowsDir, file), 'utf8')
    const parsed = yaml.load(raw) as WorkflowConfig
    map.set(parsed.id, parsed)
  }

  return map
}

function buildStageAgents(workflows: Map<string, WorkflowConfig>): Map<string, StageAgent> {
  const refs = new Set<string>()
  for (const workflow of workflows.values()) {
    for (const stage of workflow.stages) {
      refs.add(stage.agent)
    }
  }

  const agents = new Map<string, StageAgent>()
  for (const ref of refs) {
    const station = stationForAgentRef(ref)
    const id = `agent_${ref}`
    agents.set(ref, {
      id,
      displayName: `${titleCase(ref)} Agent`,
      station,
      runtimeAgentId: ref,
      teamId: null,
      templateId: null,
    })
  }

  return agents
}

function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
): T[] {
  if (!orderBy) return rows
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy]
  const toComparable = (value: unknown): number | string => {
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'number') return value
    if (typeof value === 'string') return value
    if (typeof value === 'boolean') return value ? 1 : 0
    if (value === null || value === undefined) return ''
    return JSON.stringify(value)
  }

  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      const [field, dir] = Object.entries(clause)[0]
      const leftValue = left[field]
      const rightValue = right[field]
      if (leftValue === rightValue) continue
      const base = toComparable(leftValue) < toComparable(rightValue) ? -1 : 1
      return dir === 'desc' ? -base : base
    }
    return 0
  })
}

function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown> | undefined
): boolean {
  if (!where) return true

  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR') {
      const conditions = Array.isArray(value) ? value : []
      if (!conditions.some((condition) => matchesWhere(row, condition as Record<string, unknown>))) {
        return false
      }
      continue
    }

    const rowValue = row[key]

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const condition = value as Record<string, unknown>

      if ('in' in condition) {
        const values = condition.in as unknown[]
        if (!values.includes(rowValue)) return false
        continue
      }

      if ('notIn' in condition) {
        const values = condition.notIn as unknown[]
        if (values.includes(rowValue)) return false
        continue
      }

      if ('lt' in condition) {
        if (!(rowValue instanceof Date) && typeof rowValue !== 'number') return false
        if (!(rowValue < (condition.lt as Date | number))) return false
        continue
      }

      if ('lte' in condition) {
        if (!(rowValue instanceof Date) && typeof rowValue !== 'number') return false
        if (!(rowValue <= (condition.lte as Date | number))) return false
        continue
      }

      if ('gt' in condition) {
        if (!(rowValue instanceof Date) && typeof rowValue !== 'number') return false
        if (!(rowValue > (condition.gt as Date | number))) return false
        continue
      }

      if ('gte' in condition) {
        if (!(rowValue instanceof Date) && typeof rowValue !== 'number') return false
        if (!(rowValue >= (condition.gte as Date | number))) return false
        continue
      }
    }

    if (rowValue !== value) return false
  }

  return true
}

function applyPatch<T extends Record<string, unknown>>(target: T, data: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    ;(target as Record<string, unknown>)[key] = value
  }
  if ('updatedAt' in target) {
    ;(target as Record<string, unknown>).updatedAt = new Date()
  }
  return target
}

function populateAgentRows(
  state: InMemoryState,
  agentsByRef: Map<string, StageAgent>
): void {
  state.agents.clear()

  for (const agent of agentsByRef.values()) {
    state.agents.set(agent.id, {
      id: agent.id,
      name: agent.displayName,
      displayName: agent.displayName,
      runtimeAgentId: agent.runtimeAgentId,
      slug: agent.runtimeAgentId,
      station: agent.station,
      teamId: null,
      templateId: null,
      status: 'idle',
      model: null,
      sessionKey: `agent:${agent.runtimeAgentId}`,
      lastSeenAt: null,
    })
  }
}

function createInMemoryPrisma(agentsByRef: Map<string, StageAgent>): InMemoryPrisma {
  const state: InMemoryState = {
    workOrders: new Map<string, WorkOrderRow>(),
    operations: new Map<string, OperationRow>(),
    stories: new Map<string, OperationStoryRow>(),
    activities: [],
    approvals: [],
    receipts: [],
    artifacts: [],
    agents: new Map<string, AgentRow>(),
    completionTokens: new Set<string>(),
  }

  populateAgentRows(state, agentsByRef)

  let operationSeq = 1
  let storySeq = 1
  let activitySeq = 1
  let approvalSeq = 1
  let receiptSeq = 1
  let artifactSeq = 1

  const nextOperationId = () => `op_${operationSeq++}`
  const nextStoryId = () => `story_${storySeq++}`
  const nextActivityId = () => `act_${activitySeq++}`
  const nextApprovalId = () => `approval_${approvalSeq++}`
  const nextReceiptId = () => `receipt_${receiptSeq++}`
  const nextArtifactId = () => `artifact_${artifactSeq++}`

  const selectWorkOrder = (
    row: WorkOrderRow | null,
    args?: { select?: Record<string, unknown> }
  ): Record<string, unknown> | null => {
    if (!row) return null
    if (!args?.select) return clone(row)

    const out: Record<string, unknown> = {}
    for (const [key, enabled] of Object.entries(args.select)) {
      if (enabled === true) out[key] = clone((row as Record<string, unknown>)[key])
    }
    return out
  }

  const selectOperation = (
    row: OperationRow | null,
    args?: {
      select?: Record<string, unknown>
      include?: Record<string, unknown>
    }
  ): Record<string, unknown> | null => {
    if (!row) return null

    if (args?.select) {
      const out: Record<string, unknown> = {}
      for (const [key, selector] of Object.entries(args.select)) {
        if (selector === true) {
          out[key] = clone((row as Record<string, unknown>)[key])
          continue
        }

        if (key === 'workOrder' && selector && typeof selector === 'object') {
          const nested = selector as { select?: Record<string, unknown> }
          const workOrder = state.workOrders.get(row.workOrderId) ?? null
          out.workOrder = selectWorkOrder(workOrder, { select: nested.select ?? {} })
        }
      }
      return out
    }

    const out: Record<string, unknown> = clone(row)
    if (args?.include?.workOrder) {
      out.workOrder = clone(state.workOrders.get(row.workOrderId) ?? null)
    }
    return out
  }

  const selectStory = (
    row: OperationStoryRow | null,
    args?: { select?: Record<string, unknown> }
  ): Record<string, unknown> | null => {
    if (!row) return null
    if (!args?.select) return clone(row)
    const out: Record<string, unknown> = {}
    for (const [key, enabled] of Object.entries(args.select)) {
      if (enabled === true) out[key] = clone((row as Record<string, unknown>)[key])
    }
    return out
  }

  const selectAgent = (
    row: AgentRow | null,
    args?: { select?: Record<string, unknown> }
  ): Record<string, unknown> | null => {
    if (!row) return null
    if (!args?.select) return clone(row)
    const out: Record<string, unknown> = {}
    for (const [key, enabled] of Object.entries(args.select)) {
      if (enabled === true) out[key] = clone((row as Record<string, unknown>)[key])
    }
    return out
  }

  const prisma: InMemoryPrisma = {
    __state: state,
    workOrder: {
      findUnique: async (args: {
        where: { id: string }
        select?: Record<string, unknown>
      }) => {
        const row = state.workOrders.get(args.where.id) ?? null
        return selectWorkOrder(row, { select: args.select })
      },
      update: async (args: {
        where: { id: string }
        data: Record<string, unknown>
      }) => {
        const row = state.workOrders.get(args.where.id)
        if (!row) throw new Error(`workOrder not found: ${args.where.id}`)
        applyPatch(row as unknown as Record<string, unknown>, args.data)
        return clone(row)
      },
      findMany: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
        take?: number
        select?: Record<string, unknown>
      }) => {
        let rows = [...state.workOrders.values()].filter((row) => matchesWhere(row, args.where))
        rows = sortRows(rows, args.orderBy)
        if (typeof args.take === 'number') rows = rows.slice(0, args.take)
        return rows.map((row) => selectWorkOrder(row, { select: args.select }))
      },
    },
    operation: {
      count: async (args: { where?: Record<string, unknown> }) => {
        const rows = [...state.operations.values()].filter((row) => matchesWhere(row, args.where))
        return rows.length
      },
      findUnique: async (args: {
        where: { id: string }
        select?: Record<string, unknown>
        include?: Record<string, unknown>
      }) => {
        const row = state.operations.get(args.where.id) ?? null
        return selectOperation(row, { select: args.select, include: args.include })
      },
      findFirst: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
      }) => {
        const rows = sortRows(
          [...state.operations.values()].filter((row) => matchesWhere(row, args.where)),
          args.orderBy
        )
        return rows.length > 0 ? clone(rows[0]) : null
      },
      findMany: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
        take?: number
      }) => {
        let rows = sortRows(
          [...state.operations.values()].filter((row) => matchesWhere(row, args.where)),
          args.orderBy
        )
        if (typeof args.take === 'number') rows = rows.slice(0, args.take)
        return rows.map((row) => clone(row))
      },
      create: async (args: {
        data: Partial<OperationRow> & {
          workOrderId: string
          station: string
          title: string
          status: string
          workflowId: string
          workflowStageIndex: number
          iterationCount: number
          assigneeAgentIds: string
          executionType: string
          retryCount: number
          maxRetries: number
        }
      }) => {
        const id = args.data.id ?? nextOperationId()
        const now = new Date()
        const row: OperationRow = {
          id,
          workOrderId: args.data.workOrderId,
          station: args.data.station,
          title: args.data.title,
          notes: args.data.notes ?? null,
          status: args.data.status,
          workflowId: args.data.workflowId,
          workflowStageIndex: args.data.workflowStageIndex,
          iterationCount: args.data.iterationCount,
          loopTargetOpId: args.data.loopTargetOpId ?? null,
          executionType: args.data.executionType,
          loopConfigJson: args.data.loopConfigJson ?? null,
          currentStoryId: args.data.currentStoryId ?? null,
          retryCount: args.data.retryCount,
          maxRetries: args.data.maxRetries,
          timeoutCount: args.data.timeoutCount ?? 0,
          assigneeAgentIds: args.data.assigneeAgentIds,
          blockedReason: args.data.blockedReason ?? null,
          escalationReason: args.data.escalationReason ?? null,
          escalatedAt: args.data.escalatedAt ?? null,
          claimedBy: args.data.claimedBy ?? null,
          claimExpiresAt: args.data.claimExpiresAt ?? null,
          lastClaimedAt: args.data.lastClaimedAt ?? null,
          createdAt: now,
          updatedAt: now,
        }
        state.operations.set(id, row)
        return clone(row)
      },
      update: async (args: {
        where: { id: string }
        data: Record<string, unknown>
      }) => {
        const row = state.operations.get(args.where.id)
        if (!row) throw new Error(`operation not found: ${args.where.id}`)
        applyPatch(row as unknown as Record<string, unknown>, args.data)
        return clone(row)
      },
      updateMany: async (args: {
        where?: Record<string, unknown>
        data: Record<string, unknown>
      }) => {
        let count = 0
        for (const row of state.operations.values()) {
          if (!matchesWhere(row, args.where)) continue
          applyPatch(row as unknown as Record<string, unknown>, args.data)
          count += 1
        }
        return { count }
      },
    },
    operationStory: {
      findUnique: async (args: {
        where: { id: string }
        select?: Record<string, unknown>
      }) => {
        const row = state.stories.get(args.where.id) ?? null
        return selectStory(row, { select: args.select })
      },
      findFirst: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
      }) => {
        const rows = sortRows(
          [...state.stories.values()].filter((row) => matchesWhere(row, args.where)),
          args.orderBy
        )
        return rows.length > 0 ? clone(rows[0]) : null
      },
      findMany: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
        select?: Record<string, unknown>
      }) => {
        const rows = sortRows(
          [...state.stories.values()].filter((row) => matchesWhere(row, args.where)),
          args.orderBy
        )
        return rows.map((row) => selectStory(row, { select: args.select }))
      },
      create: async (args: {
        data: Partial<OperationStoryRow> & {
          operationId: string
          workOrderId: string
          storyIndex: number
          storyKey: string
          title: string
          description: string
          acceptanceCriteriaJson: string
          status: string
          retryCount: number
          maxRetries: number
        }
      }) => {
        const id = args.data.id ?? nextStoryId()
        const now = new Date()
        const row: OperationStoryRow = {
          id,
          operationId: args.data.operationId,
          workOrderId: args.data.workOrderId,
          storyIndex: args.data.storyIndex,
          storyKey: args.data.storyKey,
          title: args.data.title,
          description: args.data.description,
          acceptanceCriteriaJson: args.data.acceptanceCriteriaJson,
          status: args.data.status,
          outputJson: args.data.outputJson ?? null,
          retryCount: args.data.retryCount,
          maxRetries: args.data.maxRetries,
          createdAt: now,
          updatedAt: now,
        }
        state.stories.set(id, row)
        return clone(row)
      },
      update: async (args: {
        where: { id: string }
        data: Record<string, unknown>
      }) => {
        const row = state.stories.get(args.where.id)
        if (!row) throw new Error(`story not found: ${args.where.id}`)
        applyPatch(row as unknown as Record<string, unknown>, args.data)
        return clone(row)
      },
      deleteMany: async (args: {
        where?: Record<string, unknown>
      }) => {
        let count = 0
        for (const [storyId, row] of state.stories.entries()) {
          if (!matchesWhere(row, args.where)) continue
          state.stories.delete(storyId)
          count += 1
        }
        return { count }
      },
    },
    operationCompletionToken: {
      create: async (args: {
        data: { token: string; operationId: string }
      }) => {
        const key = `${args.data.operationId}:${args.data.token}`
        if (state.completionTokens.has(key)) {
          const duplicateError = new Error('Duplicate token') as Error & { code?: string }
          duplicateError.code = 'P2002'
          throw duplicateError
        }
        state.completionTokens.add(key)
        return clone(args.data)
      },
    },
    activity: {
      create: async (args: {
        data: Omit<ActivityRow, 'id' | 'ts'> & { ts?: Date }
      }) => {
        const row: ActivityRow = {
          id: nextActivityId(),
          ts: args.data.ts ?? new Date(),
          type: args.data.type,
          actor: args.data.actor,
          actorType: args.data.actorType,
          actorAgentId: args.data.actorAgentId,
          entityType: args.data.entityType,
          entityId: args.data.entityId,
          summary: args.data.summary,
          payloadJson: args.data.payloadJson,
        }
        state.activities.push(row)
        return clone(row)
      },
      findFirst: async (args: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        const rows = sortRows(
          state.activities.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args.where)),
          args.orderBy
        )
        return rows.length > 0 ? clone(rows[0]) : null
      },
    },
    approval: {
      create: async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: nextApprovalId(),
          ...clone(args.data),
        }
        state.approvals.push(row)
        return clone(row)
      },
    },
    receipt: {
      create: async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: nextReceiptId(),
          ...clone(args.data),
        }
        state.receipts.push(row)
        return clone(row)
      },
    },
    artifact: {
      create: async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: nextArtifactId(),
          ...clone(args.data),
        }
        state.artifacts.push(row)
        return clone(row)
      },
    },
    agent: {
      findUnique: async (args: {
        where: { id: string }
        select?: Record<string, unknown>
      }) => {
        const row = state.agents.get(args.where.id) ?? null
        return selectAgent(row, { select: args.select })
      },
      update: async (args: {
        where: { id: string }
        data: Record<string, unknown>
      }) => {
        const row = state.agents.get(args.where.id)
        if (!row) throw new Error(`agent not found: ${args.where.id}`)
        applyPatch(row as unknown as Record<string, unknown>, args.data)
        return clone(row)
      },
    },
    agentSession: {
      findFirst: async () => null,
    },
    $transaction: async <T>(fn: (tx: {
      workOrder: InMemoryPrisma['workOrder']
      operation: InMemoryPrisma['operation']
      operationStory: InMemoryPrisma['operationStory']
      activity: InMemoryPrisma['activity']
      approval: InMemoryPrisma['approval']
      receipt: InMemoryPrisma['receipt']
      artifact: InMemoryPrisma['artifact']
      agent: InMemoryPrisma['agent']
    }) => Promise<T>) => {
      return fn({
        workOrder: prisma.workOrder,
        operation: prisma.operation,
        operationStory: prisma.operationStory,
        activity: prisma.activity,
        approval: prisma.approval,
        receipt: prisma.receipt,
        artifact: prisma.artifact,
        agent: prisma.agent,
      })
    },
  }

  return prisma
}

function resetInMemoryPrisma(
  prisma: InMemoryPrisma,
  agentsByRef: Map<string, StageAgent>
): void {
  const state = prisma.__state
  state.workOrders.clear()
  state.operations.clear()
  state.stories.clear()
  state.activities.length = 0
  state.approvals.length = 0
  state.receipts.length = 0
  state.artifacts.length = 0
  state.completionTokens.clear()
  populateAgentRows(state, agentsByRef)
}

function buildHarness(workflows: Map<string, WorkflowConfig>): ScenarioHarness {
  let workOrderSeq = 1

  const createWorkOrder = (overrides: Partial<WorkOrderRow> = {}): string => {
    const index = workOrderSeq++
    const id = overrides.id ?? `wo_${index}`
    const now = new Date()

    const row: WorkOrderRow = {
      id,
      code: overrides.code ?? `WO-${String(index).padStart(4, '0')}`,
      title: overrides.title ?? `Scenario ${index}`,
      goalMd: overrides.goalMd ?? `Goal for ${id}`,
      state: overrides.state ?? 'planned',
      workflowId: overrides.workflowId ?? null,
      currentStage: overrides.currentStage ?? 0,
      priority: overrides.priority ?? 'P1',
      tags: overrides.tags ?? '[]',
      blockedReason: overrides.blockedReason ?? null,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
      shippedAt: overrides.shippedAt ?? null,
    }

    mocks.prisma.__state.workOrders.set(id, row)
    return id
  }

  const getWorkOrder = (workOrderId: string): WorkOrderRow => {
    const row = mocks.prisma.__state.workOrders.get(workOrderId)
    if (!row) throw new Error(`Missing work order: ${workOrderId}`)
    return row
  }

  const getInProgressOperation = (workOrderId: string): OperationRow | null => {
    const rows = [...mocks.prisma.__state.operations.values()]
      .filter((row) => row.workOrderId === workOrderId && row.status === 'in_progress')
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    return rows[0] ?? null
  }

  const listOperations = (workOrderId: string): OperationRow[] => {
    return [...mocks.prisma.__state.operations.values()]
      .filter((row) => row.workOrderId === workOrderId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
  }

  const listStories = (workOrderId: string): OperationStoryRow[] => {
    return [...mocks.prisma.__state.stories.values()]
      .filter((row) => row.workOrderId === workOrderId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
  }

  const listActivities = (workOrderId: string): ActivityRow[] => {
    return mocks.prisma.__state.activities
      .filter((row: ActivityRow) => row.entityType === 'work_order' && row.entityId === workOrderId)
  }

  const stageRefFor = (workflowId: string, operation: OperationRow): string => {
    const workflow = workflows.get(workflowId)
    if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`)
    const stage = workflow.stages[operation.workflowStageIndex]
    if (!stage) throw new Error(`Stage index out of range: ${workflowId}#${operation.workflowStageIndex}`)
    return stage.ref
  }

  return {
    prisma: mocks.prisma,
    createWorkOrder,
    getWorkOrder,
    getInProgressOperation,
    listOperations,
    listStories,
    listActivities,
    stageRefFor,
  }
}

function storyBatch(prefix: string, count: number): Array<{
  storyKey: string
  title: string
  description: string
  acceptanceCriteria: string[]
}> {
  const stories: Array<{
    storyKey: string
    title: string
    description: string
    acceptanceCriteria: string[]
  }> = []

  for (let index = 1; index <= count; index++) {
    stories.push({
      storyKey: `${prefix}_${index}`,
      title: `${titleCase(prefix)} story ${index}`,
      description: `Deliver ${prefix} story ${index}`,
      acceptanceCriteria: ['done', 'verified'],
    })
  }

  return stories
}

function completed(output: unknown, feedback?: string): StageResultInput {
  return {
    status: 'completed',
    output,
    feedback,
  }
}

function approved(feedback?: string): StageResultInput {
  return {
    status: 'approved',
    output: { ok: true },
    feedback,
  }
}

function rejected(feedback: string): StageResultInput {
  return {
    status: 'rejected',
    output: { ok: false },
    feedback,
  }
}

async function runWorkflowScenario(input: {
  engine: {
    startWorkOrder: (
      workOrderId: string,
      options: {
        context: Record<string, unknown>
        workflowIdOverride: string
      }
    ) => Promise<unknown>
    advanceOnCompletion: (operationId: string, result: StageResultInput) => Promise<unknown>
  }
  harness: ScenarioHarness
  workflowId: string
  workOrderId: string
  context: Record<string, unknown>
  decide: (ctx: {
    operation: OperationRow
    stageRef: string
    verifyMetadata: VerifyMetadata | null
    step: number
  }) => StageResultInput
  maxSteps?: number
}): Promise<'shipped' | 'blocked' | 'cancelled'> {
  await input.engine.startWorkOrder(input.workOrderId, {
    workflowIdOverride: input.workflowId,
    context: input.context,
  })

  const maxSteps = input.maxSteps ?? 120

  for (let step = 0; step < maxSteps; step++) {
    const workOrder = input.harness.getWorkOrder(input.workOrderId)
    if (workOrder.state === 'shipped' || workOrder.state === 'blocked' || workOrder.state === 'cancelled') {
      return workOrder.state as 'shipped' | 'blocked' | 'cancelled'
    }

    const operation = input.harness.getInProgressOperation(input.workOrderId)
    if (!operation) {
      throw new Error(`No in-progress operation at step ${step} for ${input.workOrderId}`)
    }

    const stageRef = input.harness.stageRefFor(input.workflowId, operation)
    const verifyMetadata = parseVerifyMetadata(operation.loopConfigJson)
    const result = input.decide({ operation, stageRef, verifyMetadata, step })

    await input.engine.advanceOnCompletion(operation.id, result)
  }

  throw new Error(`Scenario exceeded ${maxSteps} steps (${input.workflowId})`)
}

beforeEach(() => {
  vi.resetModules()

  mocks.dispatchCalls.length = 0
  mocks.sentMessages.length = 0

  mocks.getWorkflowConfig.mockReset()
  mocks.selectWorkflowForWorkOrder.mockReset()
  mocks.resolveWorkflowStageAgent.mockReset()
  mocks.resolveCeoSessionKey.mockReset()
  mocks.dispatchToAgent.mockReset()
  mocks.mapAgentToStation.mockReset()
  mocks.sendToSession.mockReset()
  mocks.withIngestionLease.mockReset()

  const workflows = loadStarterPackWorkflows()
  const agentsByRef = buildStageAgents(workflows)

  if (!mocks.prisma || typeof mocks.prisma !== 'object' || !('__state' in mocks.prisma)) {
    mocks.prisma = createInMemoryPrisma(agentsByRef)
  } else {
    resetInMemoryPrisma(mocks.prisma, agentsByRef)
  }

  mocks.workflows = workflows
  mocks.agentsByRef = agentsByRef

  mocks.getWorkflowConfig.mockImplementation(async (workflowId: string) => {
    return mocks.workflows.get(workflowId) ?? null
  })

  mocks.selectWorkflowForWorkOrder.mockImplementation(async (input: {
    requestedWorkflowId?: string | null
  }) => {
    const requested = (input.requestedWorkflowId ?? '').trim()
    if (requested) {
      if (!mocks.workflows.has(requested)) {
        throw new Error(`Unknown requested workflow: ${requested}`)
      }
      return {
        workflowId: requested,
        reason: 'explicit',
        matchedRuleId: null,
      }
    }

    return {
      workflowId: 'cc_greenfield_project',
      reason: 'default',
      matchedRuleId: null,
    }
  })

  mocks.resolveWorkflowStageAgent.mockImplementation(async (_tx: unknown, agentRef: string) => {
    return mocks.agentsByRef.get(agentRef) ?? null
  })

  mocks.resolveCeoSessionKey.mockResolvedValue('agent:main')

  mocks.mapAgentToStation.mockImplementation((input: { station?: string | null } | string) => {
    if (typeof input === 'string') return input.trim().toLowerCase() || 'build'
    return (input.station ?? '').trim().toLowerCase() || 'build'
  })

  mocks.dispatchToAgent.mockImplementation(async (input: {
    agentId: string
    workOrderId: string
    operationId: string
    context: Record<string, unknown>
  }) => {
    mocks.dispatchCalls.push({
      agentId: input.agentId,
      workOrderId: input.workOrderId,
      operationId: input.operationId,
      context: clone(input.context),
    })

    return {
      sessionKey: `agent:${input.agentId}:wo:${input.workOrderId}:op:${input.operationId}`,
      sessionId: `sess_${input.operationId}`,
    }
  })

  mocks.sendToSession.mockImplementation(async (sessionKey: string, message: string) => {
    mocks.sentMessages.push({ sessionKey, message })
  })

  mocks.withIngestionLease.mockImplementation(async (_leaseName: string, fn: () => Promise<unknown>) => {
    const value = await fn()
    return {
      lockAcquired: true,
      value,
    }
  })
})

describe('workflow engine full scenarios', () => {
  it('runs cc_bug_fix with review loopbacks and per-story verification retries', async () => {
    const engine = await import('@/lib/services/workflow-engine')
    const harness = buildHarness(mocks.workflows)

    const workOrderId = harness.createWorkOrder({
      title: 'Critical regression in auth middleware',
      goalMd: 'Fix regression, test edge cases, and harden rollout.',
      tags: JSON.stringify(['bug', 'security']),
      priority: 'P0',
    })

    const counters = {
      planReviewRejects: 0,
      storyVerifyRejects: 0,
      buildReviewRejects: 0,
      buildInitRuns: 0,
    }

    const terminal = await runWorkflowScenario({
      engine,
      harness,
      workflowId: 'cc_bug_fix',
      workOrderId,
      context: {
        hasUnknowns: true,
        touchesSecurity: true,
        maxStoriesByStage: {
          build_stories: 2,
        },
      },
      decide: ({ operation, stageRef, verifyMetadata }) => {
        switch (stageRef) {
          case 'research':
            return completed({ notes: 'research done' }, 'Research complete')

          case 'plan':
            return completed({ plan: 'triage + fix + validation' }, 'Plan drafted')

          case 'plan_review':
            if (counters.planReviewRejects < 1) {
              counters.planReviewRejects += 1
              return rejected('Plan misses rollback criteria')
            }
            return approved('Plan approved')

          case 'build_stories':
            if (!operation.currentStoryId) {
              counters.buildInitRuns += 1
              if (counters.buildInitRuns === 1) {
                return completed({ stories: storyBatch('bugfix', 2) }, 'Stories initialized')
              }
              return completed({ stories: storyBatch('hardening', 1) }, 'Rework story initialized')
            }
            return completed({ patch: 'implemented' }, 'Story implementation complete')

          case 'build_review':
            if (verifyMetadata) {
              if (counters.storyVerifyRejects < 1) {
                counters.storyVerifyRejects += 1
                return rejected('Missing edge-case assertion for token expiry')
              }
              return approved('Story verified')
            }

            if (counters.buildReviewRejects < 1) {
              counters.buildReviewRejects += 1
              return rejected('Need additional hardening before final review')
            }
            return approved('Build review complete')

          case 'security':
            return approved('Security checks passed')

          default:
            throw new Error(`Unhandled stage for bug fix scenario: ${stageRef}`)
        }
      },
    })

    expect(terminal).toBe('shipped')
    expect(counters.planReviewRejects).toBe(1)
    expect(counters.storyVerifyRejects).toBe(1)
    expect(counters.buildReviewRejects).toBe(1)

    const operations = harness.listOperations(workOrderId)
    const stageRefs = operations.map((operation) => harness.stageRefFor('cc_bug_fix', operation))

    expect(stageRefs).toContain('security')
    expect(operations.some((operation) => operation.iterationCount > 0)).toBe(true)
    expect(operations.some((operation) => operation.status === 'rework')).toBe(true)

    const stories = harness.listStories(workOrderId)
    expect(stories.length).toBeGreaterThan(0)
    expect(stories.some((story) => story.retryCount > 0)).toBe(true)

    expect(mocks.dispatchCalls.length).toBeGreaterThan(8)
    expect(mocks.sentMessages.some((message) => message.message.includes('Work Order Complete'))).toBe(true)
  })

  it('runs cc_content_creation with editorial review loops and story retries', async () => {
    const engine = await import('@/lib/services/workflow-engine')
    const harness = buildHarness(mocks.workflows)

    const workOrderId = harness.createWorkOrder({
      title: 'Launch guide and blog post for release',
      goalMd: 'Ship docs + article with editorial QA loop.',
      tags: JSON.stringify(['content', 'docs']),
      priority: 'P1',
    })

    const counters = {
      planReviewRejects: 0,
      storyVerifyRejects: 0,
      contentReviewRejects: 0,
      contentInitRuns: 0,
    }

    const terminal = await runWorkflowScenario({
      engine,
      harness,
      workflowId: 'cc_content_creation',
      workOrderId,
      context: {
        hasUnknowns: true,
        touchesSecurity: true,
        maxStoriesByStage: {
          content_stories: 2,
        },
      },
      decide: ({ operation, stageRef, verifyMetadata }) => {
        switch (stageRef) {
          case 'research':
            return completed({ notes: 'audience + positioning' }, 'Research complete')

          case 'plan':
            return completed({ brief: 'content strategy' }, 'Plan drafted')

          case 'plan_review':
            if (counters.planReviewRejects < 1) {
              counters.planReviewRejects += 1
              return rejected('Plan lacks distribution checklist')
            }
            return approved('Plan approved')

          case 'content_stories':
            if (!operation.currentStoryId) {
              counters.contentInitRuns += 1
              if (counters.contentInitRuns === 1) {
                return completed({ stories: storyBatch('content', 2) }, 'Story batch prepared')
              }
              return completed({ stories: storyBatch('content_rework', 1) }, 'Rework story prepared')
            }
            return completed({ draft: 'story draft shipped' }, 'Story draft complete')

          case 'content_review':
            if (verifyMetadata) {
              if (counters.storyVerifyRejects < 1) {
                counters.storyVerifyRejects += 1
                return rejected('Tone mismatch against style guide')
              }
              return approved('Story edit approved')
            }

            if (counters.contentReviewRejects < 1) {
              counters.contentReviewRejects += 1
              return rejected('Need stronger narrative arc')
            }
            return approved('Editorial review complete')

          case 'security':
            return approved('Policy review complete')

          default:
            throw new Error(`Unhandled stage for content scenario: ${stageRef}`)
        }
      },
    })

    expect(terminal).toBe('shipped')
    expect(counters.planReviewRejects).toBe(1)
    expect(counters.storyVerifyRejects).toBe(1)
    expect(counters.contentReviewRejects).toBe(1)

    const operations = harness.listOperations(workOrderId)
    expect(operations.some((operation) => operation.status === 'rework')).toBe(true)
    expect(operations.some((operation) => operation.iterationCount > 0)).toBe(true)

    const stories = harness.listStories(workOrderId)
    expect(stories.some((story) => story.retryCount > 0)).toBe(true)

    expect(mocks.dispatchCalls.length).toBeGreaterThan(8)
    expect(mocks.sentMessages.some((message) => message.message.includes(workOrderId))).toBe(true)
  })

  it('runs cc_greenfield_project through optional stages and looped rework', async () => {
    const engine = await import('@/lib/services/workflow-engine')
    const harness = buildHarness(mocks.workflows)

    const workOrderId = harness.createWorkOrder({
      title: 'Greenfield internal platform module',
      goalMd: 'Design, build, secure, and prepare deployment.',
      tags: JSON.stringify(['feature', 'platform']),
      priority: 'P1',
    })

    const counters = {
      planReviewRejects: 0,
      storyVerifyRejects: 0,
      buildReviewRejects: 0,
      buildInitRuns: 0,
    }

    const terminal = await runWorkflowScenario({
      engine,
      harness,
      workflowId: 'cc_greenfield_project',
      workOrderId,
      context: {
        hasUnknowns: true,
        touchesSecurity: true,
        needsDeployment: true,
        maxStoriesByStage: {
          build_stories: 2,
        },
      },
      decide: ({ operation, stageRef, verifyMetadata }) => {
        switch (stageRef) {
          case 'research':
            return completed({ findings: 'validated constraints' }, 'Research done')

          case 'plan':
            return completed({ architecture: 'v1 blueprint' }, 'Plan drafted')

          case 'plan_review':
            if (counters.planReviewRejects < 1) {
              counters.planReviewRejects += 1
              return rejected('Missing migration fallback')
            }
            return approved('Plan approved')

          case 'build_stories':
            if (!operation.currentStoryId) {
              counters.buildInitRuns += 1
              if (counters.buildInitRuns === 1) {
                return completed({ stories: storyBatch('greenfield', 2) }, 'Story batch prepared')
              }
              return completed({ stories: storyBatch('greenfield_rework', 1) }, 'Rework story prepared')
            }
            return completed({ implementation: 'done' }, 'Story implementation complete')

          case 'build_review':
            if (verifyMetadata) {
              if (counters.storyVerifyRejects < 1) {
                counters.storyVerifyRejects += 1
                return rejected('Coverage misses recovery path')
              }
              return approved('Story verification passed')
            }

            if (counters.buildReviewRejects < 1) {
              counters.buildReviewRejects += 1
              return rejected('Need one more hardening pass')
            }
            return approved('Build review complete')

          case 'security':
            return approved('Security stage approved')

          case 'ops':
            return completed({ deploy: 'staging rollout complete' }, 'Ops stage complete')

          default:
            throw new Error(`Unhandled stage for greenfield scenario: ${stageRef}`)
        }
      },
    })

    expect(terminal).toBe('shipped')
    expect(counters.planReviewRejects).toBe(1)
    expect(counters.storyVerifyRejects).toBe(1)
    expect(counters.buildReviewRejects).toBe(1)

    const operations = harness.listOperations(workOrderId)
    const stageRefs = operations.map((operation) => harness.stageRefFor('cc_greenfield_project', operation))

    expect(stageRefs).toContain('research')
    expect(stageRefs).toContain('security')
    expect(stageRefs).toContain('ops')
    expect(operations.some((operation) => operation.status === 'rework')).toBe(true)

    expect(mocks.dispatchCalls.length).toBeGreaterThan(10)
    expect(mocks.sentMessages.some((message) => message.message.includes('Work Order Complete'))).toBe(true)
  })

  it('runs cc_ops_change with story-level security verify and security gate loopback', async () => {
    const engine = await import('@/lib/services/workflow-engine')
    const harness = buildHarness(mocks.workflows)

    const workOrderId = harness.createWorkOrder({
      title: 'Infra migration + deploy hardening',
      goalMd: 'Execute migration with security checks and finalization.',
      tags: JSON.stringify(['ops', 'infra']),
      priority: 'P0',
    })

    const counters = {
      storyVerifyRejects: 0,
      securityGateRejects: 0,
      opsInitRuns: 0,
    }

    const terminal = await runWorkflowScenario({
      engine,
      harness,
      workflowId: 'cc_ops_change',
      workOrderId,
      context: {
        maxStoriesByStage: {
          ops_stories: 2,
        },
      },
      decide: ({ operation, stageRef, verifyMetadata }) => {
        switch (stageRef) {
          case 'plan':
            return completed({ runbook: 'migration sequence' }, 'Plan drafted')

          case 'plan_review':
            return approved('Plan approved')

          case 'ops_stories':
            if (!operation.currentStoryId) {
              counters.opsInitRuns += 1
              if (counters.opsInitRuns === 1) {
                return completed({ stories: storyBatch('ops', 2) }, 'Ops stories initialized')
              }
              return completed({ stories: storyBatch('ops_rework', 1) }, 'Ops rework story initialized')
            }
            return completed({ change: 'applied' }, 'Ops story implementation complete')

          case 'security':
            if (verifyMetadata) {
              if (counters.storyVerifyRejects < 1) {
                counters.storyVerifyRejects += 1
                return rejected('Hardening checklist incomplete')
              }
              return approved('Story-level security verification passed')
            }

            if (counters.securityGateRejects < 1) {
              counters.securityGateRejects += 1
              return rejected('Final security gate requests one more pass')
            }
            return approved('Final security gate passed')

          case 'ops_finalize':
            return completed({ release: 'finalized' }, 'Ops finalize complete')

          default:
            throw new Error(`Unhandled stage for ops change scenario: ${stageRef}`)
        }
      },
    })

    expect(terminal).toBe('shipped')
    expect(counters.storyVerifyRejects).toBe(1)
    expect(counters.securityGateRejects).toBe(1)

    const operations = harness.listOperations(workOrderId)
    const securityOps = operations.filter((operation) => harness.stageRefFor('cc_ops_change', operation) === 'security')

    expect(securityOps.length).toBeGreaterThan(1)
    expect(securityOps.some((operation) => parseVerifyMetadata(operation.loopConfigJson) !== null)).toBe(true)
    expect(securityOps.some((operation) => parseVerifyMetadata(operation.loopConfigJson) === null)).toBe(true)
    expect(operations.some((operation) => operation.status === 'rework')).toBe(true)

    expect(mocks.dispatchCalls.length).toBeGreaterThan(8)
    expect(mocks.sentMessages.some((message) => message.message.includes('Work Order Complete'))).toBe(true)
  })

  it('runs cc_security_audit with optional code-review stage enabled', async () => {
    const engine = await import('@/lib/services/workflow-engine')
    const harness = buildHarness(mocks.workflows)

    const workOrderId = harness.createWorkOrder({
      title: 'Security audit and report',
      goalMd: 'Audit system and include targeted code review.',
      tags: JSON.stringify(['security', 'audit']),
      priority: 'P0',
    })

    const terminal = await runWorkflowScenario({
      engine,
      harness,
      workflowId: 'cc_security_audit',
      workOrderId,
      context: {
        hasCodeChanges: true,
      },
      decide: ({ stageRef }) => {
        switch (stageRef) {
          case 'security':
            return approved('Security audit completed')
          case 'build_review':
            return approved('Code review completed')
          default:
            throw new Error(`Unhandled stage for security audit scenario: ${stageRef}`)
        }
      },
      maxSteps: 20,
    })

    expect(terminal).toBe('shipped')

    const operations = harness.listOperations(workOrderId)
    const stageRefs = operations.map((operation) => harness.stageRefFor('cc_security_audit', operation))

    expect(stageRefs).toEqual(['security', 'build_review'])
    expect(mocks.dispatchCalls.length).toBe(2)
    expect(mocks.sentMessages.some((message) => message.message.includes('Work Order Complete'))).toBe(true)
  })
})
