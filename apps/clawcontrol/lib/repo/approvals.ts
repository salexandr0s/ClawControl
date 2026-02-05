/**
 * Approvals Repository
 *
 * Provides data access for approvals.
 */

import { prisma } from '../db'
import type { ApprovalDTO, ApprovalFilters } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateApprovalInput {
  workOrderId: string
  operationId?: string | null
  type: 'ship_gate' | 'risky_action' | 'scope_change' | 'cron_change' | 'external_side_effect'
  questionMd: string
}

export interface UpdateApprovalInput {
  status: 'approved' | 'rejected'
  resolvedBy?: string
}

export interface ApprovalsRepo {
  list(filters?: ApprovalFilters): Promise<ApprovalDTO[]>
  getById(id: string): Promise<ApprovalDTO | null>
  listPending(): Promise<ApprovalDTO[]>
  countPending(): Promise<number>
  create(input: CreateApprovalInput): Promise<ApprovalDTO>
  update(id: string, input: UpdateApprovalInput): Promise<ApprovalDTO | null>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbApprovalsRepo(): ApprovalsRepo {
  return {
    async list(filters?: ApprovalFilters): Promise<ApprovalDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.approval.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      })
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<ApprovalDTO | null> {
      const row = await prisma.approval.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async listPending(): Promise<ApprovalDTO[]> {
      const rows = await prisma.approval.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'desc' },
      })
      return rows.map(toDTO)
    },

    async countPending(): Promise<number> {
      return prisma.approval.count({ where: { status: 'pending' } })
    },

    async create(input: CreateApprovalInput): Promise<ApprovalDTO> {
      const row = await prisma.approval.create({
        data: {
          workOrderId: input.workOrderId,
          operationId: input.operationId ?? null,
          type: input.type,
          questionMd: input.questionMd,
          status: 'pending',
        },
      })
      return toDTO(row)
    },

    async update(id: string, input: UpdateApprovalInput): Promise<ApprovalDTO | null> {
      const existing = await prisma.approval.findUnique({ where: { id } })
      if (!existing) return null

      const row = await prisma.approval.update({
        where: { id },
        data: {
          status: input.status,
          resolvedBy: input.resolvedBy || 'user',
          resolvedAt: new Date(),
        },
      })

      return toDTO(row)
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: ApprovalFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status
  }
  if (filters.type) {
    where.type = Array.isArray(filters.type) ? { in: filters.type } : filters.type
  }
  if (filters.workOrderId) {
    where.workOrderId = filters.workOrderId
  }
  return where
}

function toDTO(row: {
  id: string
  workOrderId: string
  operationId: string | null
  type: string
  questionMd: string
  status: string
  resolvedBy: string | null
  createdAt: Date
  resolvedAt: Date | null
}): ApprovalDTO {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    operationId: row.operationId,
    type: row.type as ApprovalDTO['type'],
    questionMd: row.questionMd,
    status: row.status as ApprovalDTO['status'],
    resolvedBy: row.resolvedBy,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  }
}
