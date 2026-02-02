/**
 * Work Orders Repository
 *
 * Provides data access for work orders with both DB and mock implementations.
 */

import { prisma } from '../db'
import { indexWorkOrder } from '../db/fts'
import { mockWorkOrders, mockOperations } from '@savorg/core'
import type {
  WorkOrderDTO,
  WorkOrderWithOpsDTO,
  WorkOrderFilters,
} from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateWorkOrderInput {
  title: string
  goalMd: string
  priority?: string
  owner?: string
  routingTemplate?: string
}

export interface UpdateWorkOrderInput {
  title?: string
  goalMd?: string
  state?: string
  priority?: string
  owner?: string
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
    actor: string
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
      return rows.map(toDTO)
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
      return rows.map((row) => ({
        ...toDTO(row),
        operations: row.operations.map((op) => ({
          id: op.id,
          status: op.status,
        })),
      }))
    },

    async getById(id: string): Promise<WorkOrderDTO | null> {
      const row = await prisma.workOrder.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async getByCode(code: string): Promise<WorkOrderDTO | null> {
      const row = await prisma.workOrder.findUnique({ where: { code } })
      return row ? toDTO(row) : null
    },

    async countByState(): Promise<Record<string, number>> {
      const groups = await prisma.workOrder.groupBy({
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
      return {
        ...toDTO(row),
        operations: row.operations.map((op) => ({
          id: op.id,
          status: op.status,
        })),
      }
    },

    async create(input: CreateWorkOrderInput): Promise<WorkOrderDTO> {
      // Generate next code
      const lastWo = await prisma.workOrder.findFirst({
        orderBy: { code: 'desc' },
        select: { code: true },
      })
      const lastNum = lastWo ? parseInt(lastWo.code.replace('WO-', ''), 10) : 0
      const code = `WO-${String(lastNum + 1).padStart(3, '0')}`

      const row = await prisma.workOrder.create({
        data: {
          code,
          title: input.title,
          goalMd: input.goalMd,
          state: 'planned',
          priority: input.priority || 'P2',
          owner: input.owner || 'user',
          routingTemplate: input.routingTemplate || 'default_routing',
        },
      })

      // Index for search
      await indexWorkOrder(row.id, row.code, row.title, row.goalMd)

      return toDTO(row)
    },

    async update(id: string, input: UpdateWorkOrderInput): Promise<WorkOrderDTO | null> {
      const existing = await prisma.workOrder.findUnique({ where: { id } })
      if (!existing) return null

      const row = await prisma.workOrder.update({
        where: { id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.goalMd !== undefined && { goalMd: input.goalMd }),
          ...(input.state !== undefined && { state: input.state }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.owner !== undefined && { owner: input.owner }),
          ...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
          ...(input.state === 'shipped' && { shippedAt: new Date() }),
        },
      })

      // Re-index for search if title or goal changed
      if (input.title !== undefined || input.goalMd !== undefined) {
        await indexWorkOrder(row.id, row.code, row.title, row.goalMd)
      }

      return toDTO(row)
    },

    async updateStateWithActivity(
      id: string,
      newState: string,
      actor: string
    ): Promise<StateTransitionResult | null> {
      return prisma.$transaction(async (tx) => {
        // Get current state
        const existing = await tx.workOrder.findUnique({ where: { id } })
        if (!existing) return null

        const previousState = existing.state

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
            actor,
            entityType: 'work_order',
            entityId: id,
            summary: `Work order transitioned to ${newState}`,
            payloadJson: JSON.stringify({
              previousState,
              newState,
            }),
          },
        })

        return {
          workOrder: toDTO(row),
          previousState,
          activityId,
        }
      })
    },
  }
}

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

export function createMockWorkOrdersRepo(): WorkOrdersRepo {
  return {
    async list(filters?: WorkOrderFilters): Promise<WorkOrderDTO[]> {
      let result = [...mockWorkOrders]
      if (filters?.state) {
        const states = Array.isArray(filters.state) ? filters.state : [filters.state]
        result = result.filter((wo) => states.includes(wo.state))
      }
      if (filters?.priority) {
        const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority]
        result = result.filter((wo) => priorities.includes(wo.priority))
      }
      if (filters?.owner) {
        result = result.filter((wo) => wo.owner === filters.owner)
      }
      return result.map(mockToDTO)
    },

    async listWithOps(filters?: WorkOrderFilters): Promise<WorkOrderWithOpsDTO[]> {
      const workOrders = await this.list(filters)
      return workOrders.map((wo) => ({
        ...wo,
        operations: mockOperations
          .filter((op) => op.workOrderId === wo.id)
          .map((op) => ({ id: op.id, status: op.status })),
      }))
    },

    async getById(id: string): Promise<WorkOrderDTO | null> {
      const wo = mockWorkOrders.find((w) => w.id === id)
      return wo ? mockToDTO(wo) : null
    },

    async getByCode(code: string): Promise<WorkOrderDTO | null> {
      const wo = mockWorkOrders.find((w) => w.code === code)
      return wo ? mockToDTO(wo) : null
    },

    async countByState(): Promise<Record<string, number>> {
      const counts: Record<string, number> = {}
      for (const wo of mockWorkOrders) {
        counts[wo.state] = (counts[wo.state] || 0) + 1
      }
      return counts
    },

    async countShippedToday(): Promise<number> {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      return mockWorkOrders.filter(
        (wo) => wo.state === 'shipped' && wo.shippedAt && wo.shippedAt >= today
      ).length
    },

    async getByIdWithOps(id: string): Promise<WorkOrderWithOpsDTO | null> {
      const wo = mockWorkOrders.find((w) => w.id === id)
      if (!wo) return null
      return {
        ...mockToDTO(wo),
        operations: mockOperations
          .filter((op) => op.workOrderId === id)
          .map((op) => ({ id: op.id, status: op.status })),
      }
    },

    async create(input: CreateWorkOrderInput): Promise<WorkOrderDTO> {
      // Generate mock ID and code
      const id = `wo_mock_${Date.now()}`
      const code = `WO-${String(mockWorkOrders.length + 1).padStart(3, '0')}`
      const now = new Date()

      const newWo = {
        id,
        code,
        title: input.title,
        goalMd: input.goalMd,
        state: 'planned' as const,
        priority: (input.priority || 'P2') as 'P0' | 'P1' | 'P2' | 'P3',
        owner: (input.owner || 'user') as 'user' | 'savorgceo',
        routingTemplate: input.routingTemplate || 'default_routing',
        blockedReason: null,
        createdAt: now,
        updatedAt: now,
        shippedAt: null,
      }

      // In mock mode, we don't persist - just return the DTO
      return mockToDTO(newWo)
    },

    async update(id: string, input: UpdateWorkOrderInput): Promise<WorkOrderDTO | null> {
      const wo = mockWorkOrders.find((w) => w.id === id)
      if (!wo) return null

      // In mock mode, we don't actually mutate - just return updated DTO
      return {
        ...mockToDTO(wo),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.goalMd !== undefined && { goalMd: input.goalMd }),
        ...(input.state !== undefined && { state: input.state as WorkOrderDTO['state'] }),
        ...(input.priority !== undefined && { priority: input.priority as WorkOrderDTO['priority'] }),
        ...(input.owner !== undefined && { owner: input.owner as WorkOrderDTO['owner'] }),
        ...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
        updatedAt: new Date(),
      }
    },

    async updateStateWithActivity(
      id: string,
      newState: string,
      _actor: string
    ): Promise<StateTransitionResult | null> {
      const wo = mockWorkOrders.find((w) => w.id === id)
      if (!wo) return null

      const previousState = wo.state
      const activityId = `act_mock_${Date.now()}`

      return {
        workOrder: {
          ...mockToDTO(wo),
          state: newState as WorkOrderDTO['state'],
          updatedAt: new Date(),
          ...(newState === 'shipped' && { shippedAt: new Date() }),
        },
        previousState,
        activityId,
      }
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: WorkOrderFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.state) {
    where.state = Array.isArray(filters.state) ? { in: filters.state } : filters.state
  }
  if (filters.priority) {
    where.priority = Array.isArray(filters.priority) ? { in: filters.priority } : filters.priority
  }
  if (filters.owner) {
    where.owner = filters.owner
  }
  return where
}

function toDTO(row: {
  id: string
  code: string
  title: string
  goalMd: string
  state: string
  priority: string
  owner: string
  routingTemplate: string
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
  shippedAt: Date | null
}): WorkOrderDTO {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    goalMd: row.goalMd,
    state: row.state as WorkOrderDTO['state'],
    priority: row.priority as WorkOrderDTO['priority'],
    owner: row.owner as WorkOrderDTO['owner'],
    routingTemplate: row.routingTemplate,
    blockedReason: row.blockedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    shippedAt: row.shippedAt,
  }
}

function mockToDTO(wo: typeof mockWorkOrders[number]): WorkOrderDTO {
  return {
    id: wo.id,
    code: wo.code,
    title: wo.title,
    goalMd: wo.goalMd,
    state: wo.state as WorkOrderDTO['state'],
    priority: wo.priority as WorkOrderDTO['priority'],
    owner: wo.owner as WorkOrderDTO['owner'],
    routingTemplate: wo.routingTemplate,
    blockedReason: wo.blockedReason,
    createdAt: wo.createdAt,
    updatedAt: wo.updatedAt,
    shippedAt: wo.shippedAt,
  }
}
