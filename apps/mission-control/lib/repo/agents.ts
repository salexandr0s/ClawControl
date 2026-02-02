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
  role?: string
  station?: string
  capabilities?: Record<string, boolean>
  wipLimit?: number
  sessionKey?: string
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
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async getByName(name: string): Promise<AgentDTO | null> {
      const row = await prisma.agent.findUnique({ where: { name } })
      return row ? toDTO(row) : null
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
      return toDTO(row)
    },

    async update(id: string, input: UpdateAgentInput): Promise<AgentDTO | null> {
      const existing = await prisma.agent.findUnique({ where: { id } })
      if (!existing) return null

      const row = await prisma.agent.update({
        where: { id },
        data: {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.station !== undefined && { station: input.station }),
          ...(input.capabilities !== undefined && { capabilities: JSON.stringify(input.capabilities) }),
          ...(input.wipLimit !== undefined && { wipLimit: input.wipLimit }),
          ...(input.sessionKey !== undefined && { sessionKey: input.sessionKey }),
          lastSeenAt: new Date(),
        },
      })

      return toDTO(row)
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

function toDTO(row: {
  id: string
  name: string
  role: string
  station: string
  status: string
  sessionKey: string
  capabilities: string
  wipLimit: number
  lastSeenAt: Date | null
  lastHeartbeatAt: Date | null
  createdAt: Date
  updatedAt: Date
}): AgentDTO {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    station: row.station,
    status: row.status as AgentDTO['status'],
    sessionKey: row.sessionKey,
    capabilities: JSON.parse(row.capabilities),
    wipLimit: row.wipLimit,
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
    lastSeenAt: agent.lastSeenAt,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  }
}
