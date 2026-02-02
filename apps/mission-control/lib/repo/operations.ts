/**
 * Operations Repository
 *
 * Provides data access for operations with both DB and mock implementations.
 */

import { prisma } from '../db'
import { mockOperations } from '@savorgos/core'
import type { OperationDTO, OperationFilters } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateOperationInput {
  workOrderId: string
  station: string
  title: string
  notes?: string | null
  dependsOnOperationIds?: string[]
  wipClass?: string
}

export interface UpdateOperationInput {
  status?: string
  notes?: string | null
  blockedReason?: string | null
}

export interface StatusTransitionResult {
  operation: OperationDTO
  previousStatus: string
  activityId: string
}

export interface OperationsRepo {
  list(filters?: OperationFilters): Promise<OperationDTO[]>
  getById(id: string): Promise<OperationDTO | null>
  listForWorkOrder(workOrderId: string): Promise<OperationDTO[]>
  countByStatus(): Promise<Record<string, number>>
  create(input: CreateOperationInput): Promise<OperationDTO>
  update(id: string, input: UpdateOperationInput): Promise<OperationDTO | null>
  /** Atomically update status and write activity record in a transaction */
  updateStatusWithActivity(
    id: string,
    newStatus: string,
    actor: string
  ): Promise<StatusTransitionResult | null>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbOperationsRepo(): OperationsRepo {
  return {
    async list(filters?: OperationFilters): Promise<OperationDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.operation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      })
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<OperationDTO | null> {
      const row = await prisma.operation.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async listForWorkOrder(workOrderId: string): Promise<OperationDTO[]> {
      const rows = await prisma.operation.findMany({
        where: { workOrderId },
        orderBy: { createdAt: 'asc' },
      })
      return rows.map(toDTO)
    },

    async countByStatus(): Promise<Record<string, number>> {
      const groups = await prisma.operation.groupBy({
        by: ['status'],
        _count: { id: true },
      })
      return Object.fromEntries(
        groups.map((g) => [g.status, g._count.id])
      )
    },

    async create(input: CreateOperationInput): Promise<OperationDTO> {
      const row = await prisma.operation.create({
        data: {
          workOrderId: input.workOrderId,
          station: input.station,
          title: input.title,
          notes: input.notes ?? null,
          status: 'todo',
          assigneeAgentIds: '[]',
          dependsOnOperationIds: JSON.stringify(input.dependsOnOperationIds ?? []),
          wipClass: input.wipClass ?? 'implementation',
        },
      })
      return toDTO(row)
    },

    async update(id: string, input: UpdateOperationInput): Promise<OperationDTO | null> {
      const existing = await prisma.operation.findUnique({ where: { id } })
      if (!existing) return null

      const row = await prisma.operation.update({
        where: { id },
        data: {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.notes !== undefined && { notes: input.notes }),
          ...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
        },
      })

      return toDTO(row)
    },

    async updateStatusWithActivity(
      id: string,
      newStatus: string,
      actor: string
    ): Promise<StatusTransitionResult | null> {
      return prisma.$transaction(async (tx) => {
        // Get current operation
        const existing = await tx.operation.findUnique({ where: { id } })
        if (!existing) return null

        const previousStatus = existing.status

        // Update operation
        const row = await tx.operation.update({
          where: { id },
          data: { status: newStatus },
        })

        // Create activity record
        const activityId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await tx.activity.create({
          data: {
            id: activityId,
            ts: new Date(),
            type: 'operation.status_changed',
            actor,
            entityType: 'operation',
            entityId: id,
            summary: `Operation transitioned to ${newStatus}`,
            payloadJson: JSON.stringify({
              workOrderId: existing.workOrderId,
              previousStatus,
              newStatus,
            }),
          },
        })

        return {
          operation: toDTO(row),
          previousStatus,
          activityId,
        }
      })
    },
  }
}

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

export function createMockOperationsRepo(): OperationsRepo {
  return {
    async list(filters?: OperationFilters): Promise<OperationDTO[]> {
      let result = [...mockOperations]
      if (filters?.workOrderId) {
        result = result.filter((op) => op.workOrderId === filters.workOrderId)
      }
      if (filters?.status) {
        const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
        result = result.filter((op) => statuses.includes(op.status))
      }
      if (filters?.station) {
        const stations = Array.isArray(filters.station) ? filters.station : [filters.station]
        result = result.filter((op) => stations.includes(op.station))
      }
      return result.map(mockToDTO)
    },

    async getById(id: string): Promise<OperationDTO | null> {
      const op = mockOperations.find((o) => o.id === id)
      return op ? mockToDTO(op) : null
    },

    async listForWorkOrder(workOrderId: string): Promise<OperationDTO[]> {
      return mockOperations
        .filter((op) => op.workOrderId === workOrderId)
        .map(mockToDTO)
    },

    async countByStatus(): Promise<Record<string, number>> {
      const counts: Record<string, number> = {}
      for (const op of mockOperations) {
        counts[op.status] = (counts[op.status] || 0) + 1
      }
      return counts
    },

    async create(input: CreateOperationInput): Promise<OperationDTO> {
      const id = `op_mock_${Date.now()}`
      const now = new Date()
      return {
        id,
        workOrderId: input.workOrderId,
        station: input.station,
        title: input.title,
        notes: input.notes ?? null,
        status: 'todo',
        assigneeAgentIds: [],
        dependsOnOperationIds: input.dependsOnOperationIds ?? [],
        wipClass: input.wipClass ?? 'implementation',
        blockedReason: null,
        createdAt: now,
        updatedAt: now,
      }
    },

    async update(id: string, input: UpdateOperationInput): Promise<OperationDTO | null> {
      const op = mockOperations.find((o) => o.id === id)
      if (!op) return null

      // In mock mode, we don't actually mutate - just return updated DTO
      return {
        ...mockToDTO(op),
        ...(input.status !== undefined && { status: input.status as OperationDTO['status'] }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
        updatedAt: new Date(),
      }
    },

    async updateStatusWithActivity(
      id: string,
      newStatus: string,
      _actor: string
    ): Promise<StatusTransitionResult | null> {
      const op = mockOperations.find((o) => o.id === id)
      if (!op) return null

      const previousStatus = op.status
      const activityId = `act_mock_${Date.now()}`

      return {
        operation: {
          ...mockToDTO(op),
          status: newStatus as OperationDTO['status'],
          updatedAt: new Date(),
        },
        previousStatus,
        activityId,
      }
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: OperationFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.workOrderId) {
    where.workOrderId = filters.workOrderId
  }
  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status
  }
  if (filters.station) {
    where.station = Array.isArray(filters.station) ? { in: filters.station } : filters.station
  }
  return where
}

function toDTO(row: {
  id: string
  workOrderId: string
  station: string
  title: string
  notes: string | null
  status: string
  assigneeAgentIds: string
  dependsOnOperationIds: string
  wipClass: string
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
}): OperationDTO {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    station: row.station,
    title: row.title,
    notes: row.notes,
    status: row.status as OperationDTO['status'],
    assigneeAgentIds: JSON.parse(row.assigneeAgentIds),
    dependsOnOperationIds: JSON.parse(row.dependsOnOperationIds),
    wipClass: row.wipClass,
    blockedReason: row.blockedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mockToDTO(op: typeof mockOperations[number]): OperationDTO {
  return {
    id: op.id,
    workOrderId: op.workOrderId,
    station: op.station,
    title: op.title,
    notes: op.notes ?? null,
    status: op.status as OperationDTO['status'],
    assigneeAgentIds: op.assigneeAgentIds,
    dependsOnOperationIds: op.dependsOnOperationIds,
    wipClass: op.wipClass,
    blockedReason: op.blockedReason,
    createdAt: op.createdAt,
    updatedAt: op.updatedAt,
  }
}
