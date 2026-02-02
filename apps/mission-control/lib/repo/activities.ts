/**
 * Activities Repository
 *
 * Provides data access for activities with both DB and mock implementations.
 * Publishes activities to the pub/sub system for SSE streaming.
 */

import { prisma } from '../db'
import { mockActivities } from '@savorgos/core'
import { publishActivity } from '../pubsub'
import type { ActivityDTO, ActivityFilters, PaginationOptions } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateActivityInput {
  type: string
  actor: string
  entityType: string
  entityId: string
  summary: string
  payloadJson?: Record<string, unknown>
}

export interface ActivitiesRepo {
  list(filters?: ActivityFilters, pagination?: PaginationOptions): Promise<ActivityDTO[]>
  getById(id: string): Promise<ActivityDTO | null>
  listRecent(limit?: number): Promise<ActivityDTO[]>
  listForEntity(entityType: string, entityId: string): Promise<ActivityDTO[]>
  create(input: CreateActivityInput): Promise<ActivityDTO>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbActivitiesRepo(): ActivitiesRepo {
  return {
    async list(filters?: ActivityFilters, pagination?: PaginationOptions): Promise<ActivityDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.activity.findMany({
        where,
        orderBy: { ts: 'desc' },
        take: pagination?.limit ?? 50,
        skip: pagination?.offset ?? 0,
      })
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<ActivityDTO | null> {
      const row = await prisma.activity.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async listRecent(limit = 20): Promise<ActivityDTO[]> {
      const rows = await prisma.activity.findMany({
        orderBy: { ts: 'desc' },
        take: limit,
      })
      return rows.map(toDTO)
    },

    async listForEntity(entityType: string, entityId: string): Promise<ActivityDTO[]> {
      const rows = await prisma.activity.findMany({
        where: { entityType, entityId },
        orderBy: { ts: 'desc' },
      })
      return rows.map(toDTO)
    },

    async create(input: CreateActivityInput): Promise<ActivityDTO> {
      const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const row = await prisma.activity.create({
        data: {
          id,
          ts: new Date(),
          type: input.type,
          actor: input.actor,
          entityType: input.entityType,
          entityId: input.entityId,
          summary: input.summary,
          payloadJson: JSON.stringify(input.payloadJson ?? {}),
        },
      })
      const dto = toDTO(row)

      // Publish to SSE stream
      publishActivity(dto)

      return dto
    },
  }
}

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

export function createMockActivitiesRepo(): ActivitiesRepo {
  return {
    async list(filters?: ActivityFilters, pagination?: PaginationOptions): Promise<ActivityDTO[]> {
      let result = [...mockActivities]
      if (filters?.entityType) {
        result = result.filter((a) => a.entityType === filters.entityType)
      }
      if (filters?.entityId) {
        result = result.filter((a) => a.entityId === filters.entityId)
      }
      if (filters?.type) {
        result = result.filter((a) => a.type === filters.type)
      }
      // Sort by timestamp descending
      result.sort((a, b) => b.ts.getTime() - a.ts.getTime())
      // Apply pagination
      const offset = pagination?.offset ?? 0
      const limit = pagination?.limit ?? 50
      return result.slice(offset, offset + limit).map(mockToDTO)
    },

    async getById(id: string): Promise<ActivityDTO | null> {
      const activity = mockActivities.find((a) => a.id === id)
      return activity ? mockToDTO(activity) : null
    },

    async listRecent(limit = 20): Promise<ActivityDTO[]> {
      return [...mockActivities]
        .sort((a, b) => b.ts.getTime() - a.ts.getTime())
        .slice(0, limit)
        .map(mockToDTO)
    },

    async listForEntity(entityType: string, entityId: string): Promise<ActivityDTO[]> {
      return mockActivities
        .filter((a) => a.entityType === entityType && a.entityId === entityId)
        .map(mockToDTO)
    },

    async create(input: CreateActivityInput): Promise<ActivityDTO> {
      // Mock implementation just returns the created activity without persisting
      const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const dto: ActivityDTO = {
        id,
        ts: new Date(),
        type: input.type,
        actor: input.actor,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        payloadJson: input.payloadJson ?? {},
      }

      // Publish to SSE stream
      publishActivity(dto)

      return dto
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: ActivityFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.entityType) {
    where.entityType = filters.entityType
  }
  if (filters.entityId) {
    where.entityId = filters.entityId
  }
  if (filters.type) {
    where.type = filters.type
  }
  return where
}

function toDTO(row: {
  id: string
  ts: Date
  type: string
  actor: string
  entityType: string
  entityId: string
  summary: string
  payloadJson: string
}): ActivityDTO {
  return {
    id: row.id,
    ts: row.ts,
    type: row.type,
    actor: row.actor,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    payloadJson: JSON.parse(row.payloadJson),
  }
}

function mockToDTO(activity: typeof mockActivities[number]): ActivityDTO {
  return {
    id: activity.id,
    ts: activity.ts,
    type: activity.type,
    actor: activity.actor,
    entityType: activity.entityType,
    entityId: activity.entityId,
    summary: activity.summary,
    payloadJson: activity.payloadJson as Record<string, unknown>,
  }
}
