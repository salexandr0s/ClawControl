/**
 * Agents Repository
 *
 * Provides data access for agents with both DB and mock implementations.
 */

import { prisma } from '../db'
import { mockAgents } from '@savorg/core'
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

      const row = await prisma.agent.update({
        where: { id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: updateData as any,
      })

      return toDTO(row as unknown as PrismaAgentRow)
    },
  }
}

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

export function createMockAgentsRepo(): AgentsRepo {
  return {
    async list(filters?: AgentFilters): Promise<AgentDTO[]> {
      let result = [...mockAgents]
      if (filters?.status) {
        const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
        result = result.filter((a) => statuses.includes(a.status))
      }
      if (filters?.station) {
        const stations = Array.isArray(filters.station) ? filters.station : [filters.station]
        result = result.filter((a) => stations.includes(a.station))
      }
      return result.map(mockToDTO)
    },

    async getById(id: string): Promise<AgentDTO | null> {
      const agent = mockAgents.find((a) => a.id === id)
      return agent ? mockToDTO(agent) : null
    },

    async getByName(name: string): Promise<AgentDTO | null> {
      const agent = mockAgents.find((a) => a.name === name)
      return agent ? mockToDTO(agent) : null
    },

    async getBySessionKey(sessionKey: string): Promise<AgentDTO | null> {
      const agent = mockAgents.find((a) => a.sessionKey === sessionKey)
      return agent ? mockToDTO(agent) : null
    },

    async countByStatus(): Promise<Record<string, number>> {
      const counts: Record<string, number> = {}
      for (const a of mockAgents) {
        counts[a.status] = (counts[a.status] || 0) + 1
      }
      return counts
    },

    async create(input: CreateAgentInput): Promise<AgentDTO> {
      const now = new Date()
      const id = `agent_${(mockAgents.length + 1).toString().padStart(2, '0')}`

      const newAgent = {
        id,
        name: input.name,
        role: input.role,
        station: input.station as 'spec' | 'build' | 'qa' | 'ops' | 'update' | 'ship' | 'compound',
        status: 'idle' as const,
        sessionKey: input.sessionKey,
        capabilities: input.capabilities,
        wipLimit: input.wipLimit ?? 2,
        lastSeenAt: null,
        lastHeartbeatAt: null,
        createdAt: now,
        updatedAt: now,
      }

      // Add to mock array (in real implementation this would be persistent)
      mockAgents.push(newAgent)

      return mockToDTO(newAgent)
    },

    async update(id: string, input: UpdateAgentInput): Promise<AgentDTO | null> {
      const agent = mockAgents.find((a) => a.id === id)
      if (!agent) return null

      // In mock mode, we don't actually mutate - just return updated DTO
      return {
        ...mockToDTO(agent),
        ...(input.status !== undefined && { status: input.status as AgentDTO['status'] }),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      }
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
    lastSeenAt: row.lastSeenAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mockToDTO(agent: typeof mockAgents[number]): AgentDTO {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    station: agent.station,
    status: agent.status as AgentDTO['status'],
    sessionKey: agent.sessionKey,
    capabilities: agent.capabilities,
    wipLimit: agent.wipLimit,
    avatarPath: null, // Mock agents don't have custom avatars
    model: 'claude-sonnet-4-20250514', // Default model for mock agents
    lastSeenAt: agent.lastSeenAt,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  }
}
