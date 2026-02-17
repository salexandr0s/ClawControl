/**
 * Work Orders Repository
 *
 * Provides data access for work orders.
 */

import { prisma, RESERVED_WORK_ORDER_IDS } from '../db'
import { indexWorkOrder } from '../db/fts'
import { formatOwnerLabel, normalizeActorRef, normalizeOwnerRef, type ActorType, type OwnerType } from '../agent-identity'
import type { WorkOrderState } from '@clawcontrol/core'
import type {
  WorkOrderDTO,
  WorkOrderWithOpsDTO,
  WorkOrderFilters,
} from './types'

const VALID_WORK_ORDER_STATES = new Set<WorkOrderState>([
  'planned',
  'active',
  'blocked',
  'review',
  'shipped',
  'archived',
  'cancelled',
])

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateWorkOrderInput {
  title: string
  goalMd: string
  priority?: string
  owner?: string
  ownerType?: OwnerType
  ownerAgentId?: string | null
  tags?: string[]
  workflowId?: string | null
}

export interface UpdateWorkOrderInput {
  title?: string
  goalMd?: string
  state?: string
  priority?: string
  owner?: string
  ownerType?: OwnerType
  ownerAgentId?: string | null
  tags?: string[]
  blockedReason?: string | null
}

export interface StateTransitionResult {
  workOrder: WorkOrderDTO
  previousState: string
  activityId: string
}

export interface WorkOrdersRepo {
  list(filters?: WorkOrderFilters): Promise<WorkOrderDTO[]>
  listWithOps(filters?: WorkOrderFilters): Promise<WorkOrderWithOpsDTO[]>
  getById(id: string): Promise<WorkOrderDTO | null>
  getByIdWithOps(id: string): Promise<WorkOrderWithOpsDTO | null>
  getByCode(code: string): Promise<WorkOrderDTO | null>
  countByState(): Promise<Record<string, number>>
  /** Count work orders shipped since start of today (local time) */
  countShippedToday(): Promise<number>
  create(input: CreateWorkOrderInput): Promise<WorkOrderDTO>
  update(id: string, input: UpdateWorkOrderInput): Promise<WorkOrderDTO | null>
  /** Atomically update state and write activity record in a transaction */
  updateStateWithActivity(
    id: string,
    newState: string,
    actor: string,
    actorType?: ActorType,
    actorAgentId?: string | null
  ): Promise<StateTransitionResult | null>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbWorkOrdersRepo(): WorkOrdersRepo {
  return {
    async list(filters?: WorkOrderFilters): Promise<WorkOrderDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.workOrder.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      })
      const ownerLabels = await resolveOwnerLabels(rows.map((row) => row.ownerAgentId).filter((v): v is string => Boolean(v)))
      return rows.map((row) => toDTO(row as unknown as PrismaWorkOrderRow, ownerLabels.get(row.ownerAgentId ?? '')))
    },

    async listWithOps(filters?: WorkOrderFilters): Promise<WorkOrderWithOpsDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.workOrder.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: {
          operations: {
            select: { id: true, status: true },
          },
        },
      })
      const ownerLabels = await resolveOwnerLabels(rows.map((row) => row.ownerAgentId).filter((v): v is string => Boolean(v)))
      return rows.map((row) => ({
        ...toDTO(row as unknown as PrismaWorkOrderRow, ownerLabels.get(row.ownerAgentId ?? '')),
        operations: row.operations.map((op) => ({
          id: op.id,
          status: op.status,
        })),
      }))
    },

    async getById(id: string): Promise<WorkOrderDTO | null> {
      const row = await prisma.workOrder.findUnique({ where: { id } })
      if (!row) return null

      const ownerLabel = row.ownerAgentId
        ? await resolveOwnerLabel(row.ownerAgentId)
        : undefined

      return toDTO(row as unknown as PrismaWorkOrderRow, ownerLabel)
    },

    async getByCode(code: string): Promise<WorkOrderDTO | null> {
      const row = await prisma.workOrder.findUnique({ where: { code } })
      if (!row) return null

      const ownerLabel = row.ownerAgentId
        ? await resolveOwnerLabel(row.ownerAgentId)
        : undefined

      return toDTO(row as unknown as PrismaWorkOrderRow, ownerLabel)
    },

    async countByState(): Promise<Record<string, number>> {
      const groups = await prisma.workOrder.groupBy({
        where: buildWhere(),
        by: ['state'],
        _count: { id: true },
      })
      return Object.fromEntries(
        groups.map((g) => [g.state, g._count.id])
      )
    },

    async countShippedToday(): Promise<number> {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      return prisma.workOrder.count({
        where: {
          id: { notIn: RESERVED_WORK_ORDER_IDS },
          state: 'shipped',
          shippedAt: { gte: today },
        },
      })
    },

    async getByIdWithOps(id: string): Promise<WorkOrderWithOpsDTO | null> {
      const row = await prisma.workOrder.findUnique({
        where: { id },
        include: {
          operations: {
            select: { id: true, status: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
      if (!row) return null

      const ownerLabel = row.ownerAgentId
        ? await resolveOwnerLabel(row.ownerAgentId)
        : undefined

      return {
        ...toDTO(row as unknown as PrismaWorkOrderRow, ownerLabel),
        operations: row.operations.map((op) => ({
          id: op.id,
          status: op.status,
        })),
      }
    },

    async create(input: CreateWorkOrderInput): Promise<WorkOrderDTO> {
      const ownerRef = normalizeOwnerRef({
        owner: input.owner,
        ownerType: input.ownerType,
        ownerAgentId: input.ownerAgentId,
      })

      const row = await prisma.$transaction(async (tx) => {
        await tx.workOrderSequence.upsert({
          where: { id: 1 },
          create: { id: 1, nextValue: 1 },
          update: {},
        })

        const sequenceRows = await tx.$queryRaw<Array<{ allocated: number }>>`
          UPDATE work_order_sequences
          SET next_value = next_value + 1
          WHERE id = 1
          RETURNING next_value - 1 AS allocated
        `

        const allocated = Number(sequenceRows[0]?.allocated ?? 0)
        if (!Number.isFinite(allocated) || allocated <= 0) {
          throw new Error('Failed to allocate work order code sequence')
        }

        const code = `WO-${String(allocated).padStart(3, '0')}`

        return tx.workOrder.create({
          data: {
            code,
            title: input.title,
            goalMd: input.goalMd,
            state: 'planned',
            priority: input.priority || 'P2',
            owner: ownerRef.owner,
            ownerType: ownerRef.ownerType,
            ownerAgentId: ownerRef.ownerAgentId,
            tags: serializeTags(input.tags),
            workflowId: input.workflowId ?? null,
            currentStage: 0,
          },
        })
      })

      // Index for search
      await indexWorkOrder(row.id, row.code, row.title, row.goalMd)

      const ownerLabel = ownerRef.ownerAgentId
        ? await resolveOwnerLabel(ownerRef.ownerAgentId)
        : undefined

      return toDTO(row as unknown as PrismaWorkOrderRow, ownerLabel)
    },

    async update(id: string, input: UpdateWorkOrderInput): Promise<WorkOrderDTO | null> {
      const existing = await prisma.workOrder.findUnique({ where: { id } })
      if (!existing) return null
      if (input.state !== undefined && !VALID_WORK_ORDER_STATES.has(input.state as WorkOrderState)) {
        throw new Error(`INVALID_WORK_ORDER_STATE: ${input.state}`)
      }

      const ownerRef = normalizeOwnerRef({
        owner: input.owner !== undefined ? input.owner : existing.owner,
        ownerType: input.ownerType !== undefined ? input.ownerType : existing.ownerType,
        ownerAgentId: input.ownerAgentId !== undefined ? input.ownerAgentId : existing.ownerAgentId,
      })

      const row = await prisma.workOrder.update({
        where: { id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.goalMd !== undefined && { goalMd: input.goalMd }),
          ...(input.state !== undefined && { state: input.state }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.owner !== undefined || input.ownerType !== undefined || input.ownerAgentId !== undefined
            ? {
                owner: ownerRef.owner,
                ownerType: ownerRef.ownerType,
                ownerAgentId: ownerRef.ownerAgentId,
              }
            : {}),
          ...(input.tags !== undefined && { tags: serializeTags(input.tags) }),
          ...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
          ...(input.state === 'shipped' && { shippedAt: new Date() }),
        },
      })

      // Re-index for search if title or goal changed
      if (input.title !== undefined || input.goalMd !== undefined) {
        await indexWorkOrder(row.id, row.code, row.title, row.goalMd)
      }

      const ownerLabel = ownerRef.ownerAgentId
        ? await resolveOwnerLabel(ownerRef.ownerAgentId)
        : undefined

      return toDTO(row as unknown as PrismaWorkOrderRow, ownerLabel)
    },

    async updateStateWithActivity(
      id: string,
      newState: string,
      actor: string,
      actorType?: ActorType,
      actorAgentId?: string | null
    ): Promise<StateTransitionResult | null> {
      if (!VALID_WORK_ORDER_STATES.has(newState as WorkOrderState)) {
        throw new Error(`INVALID_WORK_ORDER_STATE: ${newState}`)
      }
      return prisma.$transaction(async (tx) => {
        // Get current state
        const existing = await tx.workOrder.findUnique({ where: { id } })
        if (!existing) return null

        const previousState = existing.state
        const normalizedActor = normalizeActorRef({
          actor,
          actorType,
          actorAgentId,
        })

        // Update work order
        const row = await tx.workOrder.update({
          where: { id },
          data: {
            state: newState,
            ...(newState === 'shipped' && { shippedAt: new Date() }),
          },
        })

        // Create activity record
        const activityId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await tx.activity.create({
          data: {
            id: activityId,
            ts: new Date(),
            type: 'work_order.state_changed',
            actor: normalizedActor.actor,
            actorType: normalizedActor.actorType,
            actorAgentId: normalizedActor.actorAgentId,
            entityType: 'work_order',
            entityId: id,
            summary: `Work order transitioned to ${newState}`,
            payloadJson: JSON.stringify({
              previousState,
              newState,
            }),
          },
        })

        const ownerLabel = row.ownerAgentId
          ? await resolveOwnerLabel(row.ownerAgentId)
          : undefined

        return {
          workOrder: toDTO(row as unknown as PrismaWorkOrderRow, ownerLabel),
          previousState,
          activityId,
        }
      })
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: WorkOrderFilters) {
  const where: Record<string, unknown> = {}

  // Reserved/system work orders exist to satisfy FK constraints and internal
  // receipts. They should not appear in user-facing lists or stats.
  where.id = { notIn: RESERVED_WORK_ORDER_IDS }

  if (!filters) return where
  if (filters.state) {
    where.state = Array.isArray(filters.state) ? { in: filters.state } : filters.state
  }
  if (filters.priority) {
    where.priority = Array.isArray(filters.priority) ? { in: filters.priority } : filters.priority
  }
  if (filters.ownerType) {
    where.ownerType = filters.ownerType
  }
  if (filters.ownerAgentId) {
    where.ownerAgentId = filters.ownerAgentId
  }
  if (filters.owner) {
    const owner = filters.owner.trim()
    if (owner.toLowerCase() === 'user' || owner.toLowerCase() === 'system') {
      where.ownerType = owner.toLowerCase()
    } else if (owner.toLowerCase().startsWith('agent:')) {
      where.ownerAgentId = owner.slice('agent:'.length)
    } else {
      where.OR = [
        { owner: owner },
        { ownerAgentId: owner },
      ]
    }
  }
  return where
}

interface PrismaWorkOrderRow {
  id: string
  code: string
  title: string
  goalMd: string
  state: string
  priority: string
  owner: string
  ownerType?: string | null
  ownerAgentId?: string | null
  tags: string
  workflowId: string | null
  currentStage: number
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
  shippedAt: Date | null
}

function toDTO(row: PrismaWorkOrderRow, resolvedOwnerLabel?: string): WorkOrderDTO {
  const ownerType = normalizeOwnerType(row.ownerType, row.owner)
  const ownerAgentId = row.ownerAgentId ?? parseOwnerAgentId(row.owner)
  const ownerLabel = formatOwnerLabel(row.owner, ownerType, resolvedOwnerLabel)

  return {
    id: row.id,
    code: row.code,
    title: row.title,
    goalMd: row.goalMd,
    state: row.state as WorkOrderDTO['state'],
    priority: row.priority as WorkOrderDTO['priority'],
    owner: row.owner,
    ownerType,
    ownerAgentId,
    ownerLabel,
    tags: parseTags(row.tags),
    workflowId: row.workflowId,
    currentStage: row.currentStage,
    blockedReason: row.blockedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    shippedAt: row.shippedAt,
  }
}

function parseOwnerAgentId(owner: string): string | null {
  if (!owner.toLowerCase().startsWith('agent:')) return null
  const id = owner.slice('agent:'.length).trim()
  return id || null
}

function normalizeOwnerType(ownerType: string | null | undefined, owner: string): OwnerType {
  const normalizedType = (ownerType ?? '').trim().toLowerCase()
  if (normalizedType === 'agent' || normalizedType === 'system' || normalizedType === 'user') {
    return normalizedType
  }

  const normalizedOwner = owner.trim().toLowerCase()
  if (normalizedOwner === 'system') return 'system'
  if (normalizedOwner === 'user' || normalizedOwner === '') return 'user'
  return normalizedOwner.startsWith('agent:') ? 'agent' : 'agent'
}

async function resolveOwnerLabels(ownerAgentIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(ownerAgentIds))
  if (uniqueIds.length === 0) return new Map()

  const agents = await prisma.agent.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, displayName: true, name: true },
  })

  return new Map(
    agents.map((agent) => [agent.id, agent.displayName?.trim() || agent.name])
  )
}

async function resolveOwnerLabel(ownerAgentId: string): Promise<string | undefined> {
  const ownerLabels = await resolveOwnerLabels([ownerAgentId])
  return ownerLabels.get(ownerAgentId)
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20)
  } catch {
    return []
  }
}

function serializeTags(tags?: string[] | null): string {
  if (!Array.isArray(tags) || tags.length === 0) return '[]'
  const normalized = tags
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
  return JSON.stringify(Array.from(new Set(normalized)).slice(0, 20))
}
