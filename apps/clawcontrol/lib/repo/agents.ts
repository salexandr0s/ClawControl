/**
 * Agents Repository
 *
 * Provides data access for agents.
 */

import { prisma } from '../db'
import type { AgentDTO, AgentFilters } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface UpdateAgentInput {
  status?: string
  currentWorkOrderId?: string | null

  // Admin-editable fields
  name?: string
  role?: string
  station?: string
  capabilities?: Record<string, boolean>
  wipLimit?: number
  sessionKey?: string
  avatarPath?: string | null
  model?: string | null
  fallbacks?: string | null
}

export interface CreateAgentInput {
  name: string
  role: string
  station: string
  sessionKey: string
  capabilities: Record<string, boolean>
  wipLimit?: number
}

export interface AgentsRepo {
  list(filters?: AgentFilters): Promise<AgentDTO[]>
  getById(id: string): Promise<AgentDTO | null>
  getByName(name: string): Promise<AgentDTO | null>
  getBySessionKey(sessionKey: string): Promise<AgentDTO | null>
  countByStatus(): Promise<Record<string, number>>
  create(input: CreateAgentInput): Promise<AgentDTO>
  update(id: string, input: UpdateAgentInput): Promise<AgentDTO | null>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbAgentsRepo(): AgentsRepo {
  return {
    async list(filters?: AgentFilters): Promise<AgentDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.agent.findMany({
        where,
        orderBy: { name: 'asc' },
      })
      return rows.map((row) => toDTO(row as unknown as PrismaAgentRow))
    },

    async getById(id: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findUnique({ where: { id } })
      return row ? toDTO(row as unknown as PrismaAgentRow) : null
    },

    async getByName(name: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findUnique({ where: { name } })
      return row ? toDTO(row as unknown as PrismaAgentRow) : null
    },

    async getBySessionKey(sessionKey: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findUnique({ where: { sessionKey } })
      return row ? toDTO(row as unknown as PrismaAgentRow) : null
    },

    async countByStatus(): Promise<Record<string, number>> {
      const groups = await prisma.agent.groupBy({
        by: ['status'],
        _count: { id: true },
      })
      return Object.fromEntries(
        groups.map((g) => [g.status, g._count.id])
      )
    },

    async create(input: CreateAgentInput): Promise<AgentDTO> {
      const row = await prisma.agent.create({
        data: {
          name: input.name,
          role: input.role,
          station: input.station,
          status: 'idle',
          sessionKey: input.sessionKey,
          capabilities: JSON.stringify(input.capabilities),
          wipLimit: input.wipLimit ?? 2,
        },
      })
      return toDTO(row as unknown as PrismaAgentRow)
    },

    async update(id: string, input: UpdateAgentInput): Promise<AgentDTO | null> {
      const existing = await prisma.agent.findUnique({ where: { id } })
      if (!existing) return null

      // Build update data, casting to any to handle fields not in generated client
      const updateData: Record<string, unknown> = {
        lastSeenAt: new Date(),
      }
      if (input.status !== undefined) updateData.status = input.status
      if (input.name !== undefined) updateData.name = input.name
      if (input.role !== undefined) updateData.role = input.role
      if (input.station !== undefined) updateData.station = input.station
      if (input.capabilities !== undefined) updateData.capabilities = JSON.stringify(input.capabilities)
      if (input.wipLimit !== undefined) updateData.wipLimit = input.wipLimit
      if (input.sessionKey !== undefined) updateData.sessionKey = input.sessionKey
      if (input.avatarPath !== undefined) updateData.avatarPath = input.avatarPath
      if (input.model !== undefined) updateData.model = input.model
      if (input.fallbacks !== undefined) updateData.fallbacks = input.fallbacks

      const row = await prisma.agent.update({
        where: { id },
        data: updateData as Record<string, unknown>,
      })

      return toDTO(row as unknown as PrismaAgentRow)
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: AgentFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status
  }
  if (filters.station) {
    where.station = Array.isArray(filters.station) ? { in: filters.station } : filters.station
  }
  return where
}

// Extended type to handle new fields that may not be in generated Prisma client
interface PrismaAgentRow {
  id: string
  name: string
  role: string
  station: string
  status: string
  sessionKey: string
  capabilities: string
  wipLimit: number
  avatarPath?: string | null
  fallbacks?: string | null
  model?: string | null
  lastSeenAt: Date | null
  lastHeartbeatAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toDTO(row: PrismaAgentRow): AgentDTO {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    station: row.station,
    status: row.status as AgentDTO['status'],
    sessionKey: row.sessionKey,
    capabilities: JSON.parse(row.capabilities),
    wipLimit: row.wipLimit,
    avatarPath: row.avatarPath ?? null,
    model: row.model ?? null,
    fallbacks: JSON.parse(row.fallbacks ?? "[]"),
    lastSeenAt: row.lastSeenAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
